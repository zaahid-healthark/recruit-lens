#!/usr/bin/env bash
#
# Provision a Linux VM to run the RecruitLens API.
#
# Two modes:
#
#   behind-proxy  — an nginx site with TLS already exists on this machine and
#                   will proxy a path (e.g. /interview/api) to this backend.
#                   No certificate, no DNS record, no extra port.
#                     sudo ./setup.sh behind-proxy
#
#   standalone    — this app owns the domain; obtain a Let's Encrypt cert and
#                   serve TLS on port 8100.
#                     sudo ./setup.sh standalone api.yourdomain.com you@you.com
#
# Safe to re-run in either mode: every step checks before acting, so this is
# also the deploy command, not just a first-time installer.
#
# It never contains secrets. On first run it writes a root-only env template
# and stops, so credentials are only ever typed on the machine.

set -euo pipefail

MODE="${1:-}"
APP_USER="recruitlens"
APP_DIR="/opt/recruitlens"
DATA_DIR="/var/lib/recruitlens"
ENV_FILE="/etc/recruitlens/api.env"
REPO_URL="git@github.com:zaahid-healthark/recruit-lens.git"
BRANCH="chore/deploy-render-eas"
# Deliberately not 4000: on a shared VM that port is very often already taken
# by whatever else is running there.
DEFAULT_PORT=4100
TLS_PORT=8100

case "$MODE" in
  behind-proxy) API_DOMAIN=""; LETSENCRYPT_EMAIL="" ;;
  standalone)
    API_DOMAIN="${2:-}"; LETSENCRYPT_EMAIL="${3:-}"
    if [[ -z "$API_DOMAIN" || -z "$LETSENCRYPT_EMAIL" ]]; then
      echo "usage: sudo $0 standalone <api-domain> <letsencrypt-email>" >&2
      exit 1
    fi ;;
  *)
    echo "usage: sudo $0 behind-proxy" >&2
    echo "       sudo $0 standalone <api-domain> <letsencrypt-email>" >&2
    exit 1 ;;
esac

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git

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

say "Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
# Audio lives on the VM's persistent disk, NOT in /tmp — this is why the
# "audio unavailable after redeploy" problem does not exist here.
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$DATA_DIR" "$DATA_DIR/uploads"
install -d -m 0750 /etc/recruitlens

if [[ ! -f "$ENV_FILE" ]]; then
  say "Writing $ENV_FILE template — FILL IT IN, then re-run this script"
  sed "s/__PORT__/$DEFAULT_PORT/" > "$ENV_FILE" <<'ENVEOF'
# RecruitLens API configuration. Root-only; never committed.
NODE_ENV=production

# Must be free on this machine — check with: sudo ss -ltnp | grep __PORT__
# and keep it matching the proxy_pass port in your nginx config.
PORT=__PORT__

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
  echo "  Then re-run:  sudo $0 $*"
  exit 0
fi

# Fail here rather than later inside Prisma or the OpenAI client, where the
# error message would not point at the real cause.
for key in DATABASE_URL API_KEY OPENAI_API_KEY; do
  grep -qE "^${key}=.+" "$ENV_FILE" || { echo "ERROR: $key is empty in $ENV_FILE" >&2; exit 1; }
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
sleep 2

if [[ "$MODE" == "behind-proxy" ]]; then
  say "Done — running on 127.0.0.1:${PORT:-$DEFAULT_PORT}, not exposed to the internet"
  systemctl --no-pager --lines=5 status recruitlens || true
  cat <<DONEEOF

  Next: add the location blocks from
    $APP_DIR/deploy/azure/nginx-path-prefix.conf
  into the existing 443 server block for your domain, then:

    sudo nginx -t && sudo systemctl reload nginx

  Confirm the backend is up locally first:
    curl http://127.0.0.1:${PORT:-$DEFAULT_PORT}/health

  Then through the proxy:
    curl https://yourdomain.com/interview/api/health

DONEEOF
  exit 0
fi

# ── standalone only, from here down ──
say "Installing nginx and certbot"
apt-get install -y -qq nginx ufw
if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y -qq snapd
  snap install core && snap refresh core
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi
install -d -m 0755 /var/www/certbot

say "Configuring firewall"
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null   # Let's Encrypt HTTP-01 only
ufw allow ${TLS_PORT}/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered

# Certificates first, behind a plain HTTP site: the TLS server block cannot
# load until the cert files it references exist.
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

say "Installing nginx site (TLS on :$TLS_PORT)"
sed "s/__API_DOMAIN__/$API_DOMAIN/g" \
  "$APP_DIR/deploy/azure/nginx-recruitlens.conf" \
  > /etc/nginx/sites-available/recruitlens
ln -sf /etc/nginx/sites-available/recruitlens /etc/nginx/sites-enabled/recruitlens
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOKEOF'
#!/bin/sh
systemctl reload nginx
HOOKEOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

say "Done"
systemctl --no-pager --lines=5 status recruitlens || true
echo
echo "  Health check:  curl https://$API_DOMAIN:$TLS_PORT/health"
echo "  Logs:          sudo journalctl -u recruitlens -f"
echo "  Redeploy:      sudo $0 standalone $API_DOMAIN $LETSENCRYPT_EMAIL"
