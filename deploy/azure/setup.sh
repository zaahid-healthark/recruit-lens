#!/usr/bin/env bash
#
# Provision an Ubuntu VM to run the RecruitLens API behind nginx + Let's Encrypt.
#
#   sudo ./setup.sh api.yourdomain.com you@yourdomain.com
#
# Safe to re-run: every step checks before acting, so this doubles as the
# "apply config changes" script, not just a one-shot installer.
#
# What it does NOT do: write secrets. It creates /etc/recruitlens/api.env from a
# template on first run and stops, so DATABASE_URL / API_KEY / OPENAI_API_KEY
# are only ever typed on the machine and never pass through this repo.

set -euo pipefail

API_DOMAIN="${1:-}"
LETSENCRYPT_EMAIL="${2:-}"
APP_USER="recruitlens"
APP_DIR="/opt/recruitlens"
DATA_DIR="/var/lib/recruitlens"
ENV_FILE="/etc/recruitlens/api.env"
REPO_URL="git@github.com:zaahid-healthark/recruit-lens.git"
BRANCH="chore/deploy-render-eas"
API_PORT=8100

if [[ -z "$API_DOMAIN" || -z "$LETSENCRYPT_EMAIL" ]]; then
  echo "usage: sudo $0 <api-domain> <letsencrypt-email>" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "run with sudo" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git nginx ufw

# Node 22 — matches .node-version (22.14.0); engines requires >= 20.19.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22.* ]]; then
  say "Installing Node.js 22"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
node -v

# certbot via snap is the version upstream actually supports.
if ! command -v certbot >/dev/null 2>&1; then
  say "Installing certbot"
  apt-get install -y -qq snapd
  snap install core && snap refresh core
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi

say "Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
# Audio lives here, on the VM's persistent disk — NOT in /tmp. This is the whole
# reason the "audio unavailable after redeploy" problem disappears on a VM.
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$DATA_DIR" "$DATA_DIR/uploads"
install -d -m 0755 /var/www/certbot
install -d -m 0750 /etc/recruitlens

if [[ ! -f "$ENV_FILE" ]]; then
  say "Writing $ENV_FILE template — FILL IT IN, then re-run this script"
  cat > "$ENV_FILE" <<'ENVEOF'
# RecruitLens API configuration. Root-only; never committed.
NODE_ENV=production
PORT=4000

# Neon connection string, exactly as copied from the Neon dashboard
# (keep ?sslmode=require).
DATABASE_URL=

# Shared secret the mobile app sends as x-api-key. Must match
# EXPO_PUBLIC_API_KEY in mobile/eas.json.
API_KEY=

# OpenAI key — server-side only, never ships in the APK.
OPENAI_API_KEY=

MOCK_AI=false
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
OPENAI_EVAL_MODEL=gpt-5.4
BULK_CONCURRENCY=1

# Persistent disk, unlike the ephemeral /tmp used on free hosting.
STORAGE_DIR=/var/lib/recruitlens/uploads
ENVEOF
  chmod 0600 "$ENV_FILE"
  echo
  echo "  Edit it now:  sudo nano $ENV_FILE"
  echo "  Then re-run:  sudo $0 $API_DOMAIN $LETSENCRYPT_EMAIL"
  exit 0
fi

# Refuse to continue on a half-filled env file rather than failing later with a
# confusing Prisma or OpenAI error.
for key in DATABASE_URL API_KEY OPENAI_API_KEY; do
  if ! grep -qE "^${key}=.+" "$ENV_FILE"; then
    echo "ERROR: $key is empty in $ENV_FILE" >&2
    exit 1
  fi
done

say "Fetching application code ($BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_DIR"
  sudo -u "$APP_USER" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

say "Installing dependencies (server + shared workspaces only)"
# The React Native tree is irrelevant to the backend and heavy to install.
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --include-workspace-root -w shared -w server

say "Applying database migrations to Neon"
set -a; . "$ENV_FILE"; set +a
sudo -u "$APP_USER" --preserve-env=DATABASE_URL npm run migrate:deploy -w server

say "Installing systemd unit"
install -m 0644 "$APP_DIR/deploy/azure/recruitlens.service" /etc/systemd/system/recruitlens.service
systemctl daemon-reload
systemctl enable recruitlens
systemctl restart recruitlens

say "Configuring firewall"
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null   # Let's Encrypt HTTP-01 only
ufw allow ${API_PORT}/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered

# Certificates first, with a plain HTTP site, because the TLS server block
# cannot load before the cert files it references exist.
if [[ ! -d "/etc/letsencrypt/live/$API_DOMAIN" ]]; then
  say "Requesting certificate for $API_DOMAIN"
  cat > /etc/nginx/sites-available/recruitlens <<BOOTEOF
server {
    listen 80;
    server_name $API_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
BOOTEOF
  ln -sf /etc/nginx/sites-available/recruitlens /etc/nginx/sites-enabled/recruitlens
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/certbot \
    -d "$API_DOMAIN" --email "$LETSENCRYPT_EMAIL" \
    --agree-tos --no-eff-email --non-interactive
fi

say "Installing nginx site (TLS on :$API_PORT)"
sed "s/__API_DOMAIN__/$API_DOMAIN/g" \
  "$APP_DIR/deploy/azure/nginx-recruitlens.conf" \
  > /etc/nginx/sites-available/recruitlens
ln -sf /etc/nginx/sites-available/recruitlens /etc/nginx/sites-enabled/recruitlens
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# certbot's snap installs its own renewal timer; make sure nginx picks up the
# new cert without a manual reload every 60 days.
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOKEOF'
#!/bin/sh
systemctl reload nginx
HOOKEOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

say "Done"
systemctl --no-pager --lines=5 status recruitlens || true
echo
echo "  Health check:  curl https://$API_DOMAIN:$API_PORT/health"
echo "  Logs:          sudo journalctl -u recruitlens -f"
echo "  Redeploy:      sudo $0 $API_DOMAIN $LETSENCRYPT_EMAIL"
