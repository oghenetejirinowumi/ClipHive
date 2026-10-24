#!/usr/bin/env bash
# One-time setup of the ClipHive API on a fresh Ubuntu 24.04 server
# (AWS EC2, Oracle Cloud "Always Free", or any ARM/x86 VM).
#
#   curl -fsSL https://raw.githubusercontent.com/oghenetejirinowumi/ClipHive/main/deploy/oracle/setup.sh \
#     | bash -s -- <api-domain> <frontend-url>
#   e.g. ... | bash -s -- cliphive-api.duckdns.org https://cliphive.vercel.app
#
# Installs Python, ffmpeg and Caddy (automatic HTTPS), opens ports 80/443 in the server's
# firewall, installs the app in /opt/cliphive with data in /var/lib/cliphive, and runs it as a
# systemd service that restarts on failure and on boot. Safe to re-run.
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <api-domain> <frontend-url>}"
FRONTEND="${2:?usage: setup.sh <api-domain> <frontend-url>}"
FRONTEND="${FRONTEND%/}"
REPO="https://github.com/oghenetejirinowumi/ClipHive.git"
APP_DIR=/opt/cliphive
DATA_DIR=/var/lib/cliphive
ENV_FILE=/etc/cliphive/cliphive.env

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

FREE_GB=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
if [ "$FREE_GB" -lt 12 ]; then
  printf '
[1;31mOnly %s GB free on this server'"'"'s disk; ClipHive needs at least 12 GB.[0m
' "$FREE_GB"
  printf 'Grow the disk to 30 GB (EC2 > Volumes > Modify volume), then run:
'
  printf '  sudo growpart /dev/nvme0n1 1 && sudo resize2fs "$(findmnt -no SOURCE /)"
'
  exit 1
fi

if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 4000000 ]; then
  say "Adding 2 GB of swap (small server: keeps installs and video encodes from running out of memory)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Installing system packages (Python, ffmpeg, Caddy)"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git python3-venv python3-dev build-essential ffmpeg caddy iptables-persistent curl openssl

say "Opening ports 80 and 443 in the server firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything but SSH.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
sudo netfilter-persistent save

say "Creating the cliphive user and folders"
id cliphive >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin cliphive
sudo mkdir -p "$DATA_DIR/storage" "$DATA_DIR/cache" /etc/cliphive
sudo chown -R cliphive:cliphive "$DATA_DIR"

say "Downloading ClipHive"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u cliphive git -C "$APP_DIR" pull --ff-only
else
  sudo mkdir -p "$APP_DIR" && sudo chown cliphive:cliphive "$APP_DIR"
  sudo -u cliphive git clone --depth 1 "$REPO" "$APP_DIR"
fi

say "Installing Python packages (a few minutes)"
sudo -u cliphive python3 -m venv "$APP_DIR/backend/.venv"
sudo -u cliphive "$APP_DIR/backend/.venv/bin/pip" install --upgrade pip
sudo -u cliphive "$APP_DIR/backend/.venv/bin/pip" install --timeout 120 --retries 5 -r "$APP_DIR/backend/requirements.txt"

say "Writing settings ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  sudo tee "$ENV_FILE" >/dev/null <<EOF
# ClipHive API settings. Edit, then: sudo systemctl restart cliphive
DATABASE_URL=sqlite:///$DATA_DIR/cliphive.db
STORAGE_DIR=$DATA_DIR/storage
HF_HOME=$DATA_DIR/cache/huggingface
XDG_CACHE_HOME=$DATA_DIR/cache
DENO_DIR=$DATA_DIR/cache/deno
JWT_SECRET=$(openssl rand -hex 32)
DEMO_LOGIN_ENABLED=false
ALLOW_ANONYMOUS_OWNER=false
CORS_ORIGINS=$FRONTEND
IMPORT_WORKERS=2
# Optional
GOOGLE_CLIENT_ID=
OPENAI_API_KEY=
GROQ_API_KEY=
YTDLP_COOKIES_FILE=
EOF
else
  # Keep existing secrets; just make sure the frontend is allowed.
  sudo sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=$FRONTEND#" "$ENV_FILE"
fi
sudo chown root:cliphive "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"

say "Creating the cliphive service"
sudo tee /etc/systemd/system/cliphive.service >/dev/null <<EOF
[Unit]
Description=ClipHive API
After=network-online.target
Wants=network-online.target

[Service]
User=cliphive
Group=cliphive
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now cliphive
sudo systemctl restart cliphive

say "Configuring HTTPS for $DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8000
}
EOF
sudo systemctl enable caddy
sudo systemctl reload caddy || sudo systemctl restart caddy

say "Checking the API"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
if curl -fsS http://127.0.0.1:8000/health; then
  printf '\n\n\033[1;32mClipHive API is running.\033[0m Public URL: https://%s  (HTTPS can take a minute on first start)\n' "$DOMAIN"
  printf 'Logs: sudo journalctl -u cliphive -f    Settings: sudo nano %s\n' "$ENV_FILE"
else
  printf '\n\033[1;31mThe API did not start.\033[0m See: sudo journalctl -u cliphive -n 80\n'
  exit 1
fi
