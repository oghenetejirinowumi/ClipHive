#!/usr/bin/env bash
# Deploy the latest main to the server: sudo bash /opt/cliphive/deploy/oracle/update.sh
set -euo pipefail
APP_DIR=/opt/cliphive
sudo -u cliphive git -C "$APP_DIR" pull --ff-only
sudo -u cliphive "$APP_DIR/backend/.venv/bin/pip" install --timeout 120 --retries 5 -r "$APP_DIR/backend/requirements.txt"
sudo systemctl restart cliphive
sleep 3
curl -fsS http://127.0.0.1:8000/health && printf '\nUpdated and running.\n'
