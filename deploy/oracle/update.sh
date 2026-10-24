#!/usr/bin/env bash
# Deploy the latest main on the server:
#   sudo bash /opt/cliphive/deploy/oracle/update.sh
#
# Also installs anything newer features need (only what's missing), and turns on automatic
# updates: cliphive-update.timer checks GitHub every 3 minutes and deploys main when it moves,
# so the API stays in step with the Vercel frontend.
set -euo pipefail

APP_DIR=/opt/cliphive

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

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

install_auto_update() {
  [ -f /etc/systemd/system/cliphive-update.timer ] && return 0
  say "Turning on automatic updates (deploys main within ~3 minutes of a push)"
  tee /etc/systemd/system/cliphive-update.service >/dev/null <<EOF
[Unit]
Description=Deploy the latest ClipHive main if it changed
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

  say "Getting the latest code"
  sudo -u cliphive git -C "$APP_DIR" pull --ff-only --quiet origin main
  echo "   Now at $(sudo -u cliphive git -C "$APP_DIR" log -1 --format='%h %s')"

  say "Checking system packages"
  ensure_packages

  say "Installing Python packages"
  sudo -u cliphive "$APP_DIR/backend/.venv/bin/pip" install --quiet --timeout 120 --retries 5 -r "$APP_DIR/backend/requirements.txt"

  install_auto_update

  say "Restarting ClipHive"
  systemctl restart cliphive
  for _ in $(seq 1 45); do
    curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && break
    sleep 2
  done
  if curl -fsS http://127.0.0.1:8000/health; then
    printf '\n\033[1;32mUpdated and running.\033[0m\n'
  else
    printf '\n\033[1;31mClipHive did not come back up.\033[0m See: sudo journalctl -u cliphive -n 80\n'
    exit 1
  fi
}

# Everything runs from main(), so bash has read the whole file before `git pull` replaces it.
main "$@"
