#!/usr/bin/env bash
# Run every few minutes by cliphive-update.timer (installed by update.sh): when GitHub's main
# has moved past what's deployed, deploy it. Logs: sudo journalctl -u cliphive-update
set -euo pipefail
APP_DIR=/opt/cliphive

sudo -u cliphive git -C "$APP_DIR" fetch --quiet origin main
deployed="$(sudo -u cliphive git -C "$APP_DIR" rev-parse HEAD)"
latest="$(sudo -u cliphive git -C "$APP_DIR" rev-parse FETCH_HEAD)"
if [ "$deployed" != "$latest" ]; then
  echo "Deploying ${latest:0:7} (was ${deployed:0:7})"
  exec bash "$APP_DIR/deploy/oracle/update.sh"
fi
