#!/usr/bin/env bash
# Deploy the latest code on the server (the live API):
#   sudo bash /opt/cliphive/deploy/oracle/update.sh
#
# Safe by design, so a bad push never takes the site down:
#   1. back up the database (last 10 kept, plus a daily copy)
#   2. install packages and run the backend tests in a sandbox (own temp database and folders)
#      -> if anything fails, the deploy is BLOCKED and the current version keeps running
#   3. restart and wait for /health to report the new version
#      -> if it doesn't come up, ROLL BACK to the previous version automatically
# Blocked deploys show on https://<api>/health ("blocked") until a newer push fixes them.
#
# Also installs what newer features need (only what's missing) and turns on automatic updates:
# cliphive-update.timer runs auto-update.sh every 3 minutes, which calls this when the deploy
# branch has moved. The branch is `main` unless /etc/cliphive/deploy-branch names another.
set -euo pipefail

APP_DIR=/opt/cliphive
DATA_DIR=/var/lib/cliphive
ENV_FILE=/etc/cliphive/cliphive.env
STATUS_FILE="$DATA_DIR/deploy-status.json"
BACKUP_DIR="$DATA_DIR/backups"
PY="$APP_DIR/backend/.venv/bin/python"
BRANCH="$(cat /etc/cliphive/deploy-branch 2>/dev/null || echo main)"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;31m%s\033[0m\n' "$*"; }
git_c() { sudo -u cliphive git -C "$APP_DIR" "$@"; }
short() { git_c rev-parse --short=7 "$1"; }

status() {  # status <state> [commit] [reason]  -> read by /health
  printf '{"state":"%s","commit":"%s","reason":"%s","at":"%s"}\n' "$1" "${2:-}" "${3:-}" "$(date -u +%FT%TZ)" > "$STATUS_FILE"
  chown cliphive:cliphive "$STATUS_FILE"
}

backup_db() {  # backup_db <label>
  local db
  db="$(sed -n 's#^DATABASE_URL=sqlite:///##p' "$ENV_FILE" | head -1)"
  [ -n "$db" ] && [ -f "$db" ] || return 0
  install -d -o cliphive -g cliphive "$BACKUP_DIR"
  local out="$BACKUP_DIR/cliphive-$(date +%Y%m%d-%H%M%S)-$1.db"
  # SQLite's online backup: a consistent copy even while the API is writing.
  sudo -u cliphive "$PY" -c 'import sqlite3, sys; s = sqlite3.connect(sys.argv[1]); d = sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()' "$db" "$out"
  ls -1t "$BACKUP_DIR"/cliphive-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
  echo "   Database backed up: $out"
}

ensure_packages() {
  # Colour emoji for burned-in captions; the libraries headless Chrome needs for editor exports.
  local want=(fonts-noto-color-emoji fonts-liberation libnss3 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64
              libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2
              libasound2t64 libxshmfence1 libgtk-3-0t64)
  local missing=() p
  for p in "${want[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "   Installing: ${missing[*]}"
    apt-get update -qq
    for p in "${missing[@]}"; do
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$p" >/dev/null 2>&1 || echo "   (couldn't install $p, skipping)"
    done
  fi
  # Node.js 22+ runs the HyperFrames CLI that renders editor exports.
  local major=0
  command -v node >/dev/null 2>&1 && major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -lt 22 ]; then
    echo "   Installing Node.js 22 (video editor exports)"
    if ! { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 &&
           DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null 2>&1; }; then
      echo "   (couldn't install Node.js; editor exports stay off until it is)"
    fi
  fi
}

pip_install() {
  sudo -u cliphive "$APP_DIR/backend/.venv/bin/pip" install --quiet --timeout 120 --retries 5 -r "$APP_DIR/backend/requirements.txt"
}

run_tests() {
  # A sandbox: its own database and storage, never the live ones.
  local sandbox
  sandbox="$(sudo -u cliphive mktemp -d /tmp/cliphive-tests.XXXXXX)"
  local ok=0
  (cd "$APP_DIR/backend" && sudo -u cliphive env -i PATH="$PATH" HOME="$DATA_DIR" \
      DATABASE_URL="sqlite:///$sandbox/test.db" STORAGE_DIR="$sandbox/storage" \
      HF_HOME="$DATA_DIR/cache/huggingface" XDG_CACHE_HOME="$sandbox/cache" TMPDIR="$sandbox" \
      DEMO_LOGIN_ENABLED=false \
      timeout 900 "$PY" -m pytest -q -x --no-header -p no:cacheprovider tests) > "$sandbox/pytest.log" 2>&1 || ok=1
  tail -n 4 "$sandbox/pytest.log" | sed 's/^/   /'
  [ $ok -eq 0 ] || cp "$sandbox/pytest.log" "$DATA_DIR/last-failed-tests.log"
  rm -rf "$sandbox"
  return $ok
}

wait_healthy() {  # wait_healthy <expected short commit>
  local i
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8000/health 2>/dev/null | grep -q "\"version\":\"$1\""; then return 0; fi
    sleep 2
  done
  return 1
}

install_auto_update() {
  [ -f /etc/systemd/system/cliphive-update.timer ] && return 0
  say "Turning on automatic updates (checks every 3 minutes)"
  tee /etc/systemd/system/cliphive-update.service >/dev/null <<EOF
[Unit]
Description=Deploy the latest ClipHive code if it changed (tested first, rolled back on failure)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP_DIR/deploy/oracle/auto-update.sh
EOF
  tee /etc/systemd/system/cliphive-update.timer >/dev/null <<EOF
[Unit]
Description=Check GitHub for ClipHive updates

[Timer]
OnBootSec=2min
OnUnitActiveSec=3min

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now cliphive-update.timer
}

main() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run it with sudo: sudo bash $APP_DIR/deploy/oracle/update.sh"
    exit 1
  fi
  exec 9>/var/lock/cliphive-update.lock
  flock -n 9 || { echo "Another update is already running."; exit 0; }

  if [ "${1:-}" = "--backup-only" ]; then backup_db daily; exit 0; fi

  local prev new
  prev="$(git_c rev-parse HEAD)"

  say "Getting the latest code ($BRANCH)"
  git_c fetch --quiet origin "$BRANCH"
  if ! git_c merge --ff-only --quiet FETCH_HEAD; then
    status blocked "$(short FETCH_HEAD)" "the branch's history was rewritten (force-push); deploy it by hand"
    warn "Blocked: $BRANCH was force-pushed, so it can't be fast-forwarded. Still running $(short "$prev")."
    exit 1
  fi
  new="$(git_c rev-parse HEAD)"
  echo "   $(short "$prev") -> $(git_c log -1 --format='%h %s')"

  say "Checking system packages"
  ensure_packages

  say "Installing Python packages"
  if ! pip_install; then
    git_c reset --hard --quiet "$prev"; pip_install || true
    status blocked "$(short "$new")" "packages failed to install"
    warn "Blocked: the new code's packages didn't install. Still running $(short "$prev")."
    exit 1
  fi

  say "Testing the new code before it goes live"
  if ! run_tests; then
    git_c reset --hard --quiet "$prev"; pip_install || true
    status blocked "$(short "$new")" "tests failed (see $DATA_DIR/last-failed-tests.log)"
    warn "Blocked: tests failed on $(short "$new"). Still running $(short "$prev"). Details: $DATA_DIR/last-failed-tests.log"
    exit 1
  fi

  install_auto_update

  say "Backing up the database"
  backup_db "$(short "$prev")"

  say "Restarting ClipHive"
  systemctl restart cliphive
  if wait_healthy "$(short "$new")"; then
    status live "$(short "$new")" ""
    curl -fsS http://127.0.0.1:8000/health
    printf '\n\033[1;32mUpdated and running.\033[0m\n'
    return 0
  fi

  warn "The new version didn't come up. Rolling back to $(short "$prev")."
  git_c reset --hard --quiet "$prev"
  pip_install || true
  systemctl restart cliphive
  if wait_healthy "$(short "$prev")"; then
    status blocked "$(short "$new")" "didn't start; rolled back"
    warn "Rolled back: $(short "$prev") is running again. Logs: sudo journalctl -u cliphive -n 80"
  else
    status down "$(short "$prev")" "rollback didn't start either"
    warn "ClipHive is DOWN. Logs: sudo journalctl -u cliphive -n 80"
  fi
  exit 1
}

# Everything runs from main(), so bash has read the whole file before git replaces it.
main "$@"
