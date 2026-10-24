#!/usr/bin/env bash
# Run every 3 minutes by cliphive-update.timer (installed by update.sh). When the deploy branch
# has a commit that isn't live yet (and isn't one already blocked), deploy it through update.sh:
# tested first, rolled back if it doesn't start. Also takes a daily database backup.
# Logs: sudo journalctl -u cliphive-update
set -euo pipefail
APP_DIR=/opt/cliphive
DATA_DIR=/var/lib/cliphive
BRANCH="$(cat /etc/cliphive/deploy-branch 2>/dev/null || echo main)"

# Daily database backup (update.sh also backs up before every deploy).
if [ -z "$(find "$DATA_DIR/backups" -name 'cliphive-*.db' -mmin -1440 2>/dev/null | head -1)" ]; then
  bash "$APP_DIR/deploy/oracle/update.sh" --backup-only || true
fi

sudo -u cliphive git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
deployed="$(sudo -u cliphive git -C "$APP_DIR" rev-parse HEAD)"
latest="$(sudo -u cliphive git -C "$APP_DIR" rev-parse FETCH_HEAD)"
[ "$deployed" = "$latest" ] && exit 0

# Don't re-test a commit that was already blocked; wait for a newer push.
blocked="$(sed -n 's/.*"state":"blocked","commit":"\([0-9a-f]*\)".*/\1/p' "$DATA_DIR/deploy-status.json" 2>/dev/null || true)"
if [ -n "$blocked" ] && [ "${latest:0:7}" = "$blocked" ]; then
  exit 0
fi

echo "Deploying ${latest:0:7} (live: ${deployed:0:7})"
exec bash "$APP_DIR/deploy/oracle/update.sh"
