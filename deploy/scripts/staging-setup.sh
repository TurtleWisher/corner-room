#!/usr/bin/env bash
# One-time setup of the private staging copy, staging.cornerroom.live (owner, 2026-10-30).
#   sudo deploy/scripts/staging-setup.sh         run from the production clone on the server
# Needs the DNS record first: "staging" pointing at this server, like "www" (see the runbook).
#
# What it does:
#   1. a second clone next to production (<production clone>-staging), owned by the same user
#   2. its .env.production from production's, with its own project name, ports and address, NEW
#      secrets (never production's), no email (SMTP_HOST empty), no off-site backups, no Google
#      sign-in, APP_ENV=staging
#   3. an HTTPS certificate and the nginx site with a password (deploy/nginx/staging.conf)
#   4. the first staging deploy
# Afterwards deploy any commit to staging from GitHub: Actions > Server jobs > deploy-staging.
# Safe to run again: it keeps an existing clone and settings and only fills in what is missing.
set -euo pipefail

DOMAIN="staging.cornerroom.live"
say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run it with sudo: sudo deploy/scripts/staging-setup.sh"
PROD="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STAGING="$PROD-staging"
OWNER="$(stat -c %U "$PROD")"
[ -f "$PROD/.env.production" ] || die "$PROD/.env.production is missing; run this from the production clone."
getent hosts "$DOMAIN" >/dev/null || die "$DOMAIN does not resolve yet. Add the DNS record first (runbook: Staging), wait a minute, run again."

hex() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Replace KEY's line in an env file, or add it.
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^$key=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$file" > "$file.tmp" && cat "$file.tmp" > "$file" && rm -f "$file.tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

say "1. Staging clone at $STAGING"
if [ ! -d "$STAGING/.git" ]; then
  sudo -u "$OWNER" git clone "$(git -C "$PROD" remote get-url origin)" "$STAGING"
else
  echo "already there"
fi

say "2. Staging settings"
ENV="$STAGING/.env.production"
if [ ! -f "$ENV" ]; then
  install -o "$OWNER" -m 600 "$PROD/.env.production" "$ENV"
  # New secrets: a staging leak must never open production.
  for key in $(grep -oE '^[A-Z_]*(SECRET|PASSWORD)=' "$ENV" | tr -d '='); do set_env "$ENV" "$key" "$(hex)"; done
  set_env "$ENV" COMPOSE_PROJECT_NAME cornerroom-staging
  set_env "$ENV" EDGE_API_PORT 8100
  set_env "$ENV" EDGE_WEB_PORT 3100
  set_env "$ENV" APP_ENV staging
  set_env "$ENV" WEB_BASE_URL "https://$DOMAIN"
  set_env "$ENV" CORS_ORIGINS "https://$DOMAIN"
  set_env "$ENV" ALLOWED_HOSTS "$DOMAIN,127.0.0.1,localhost"
  # No email to real people, no backups mixed with production's, no Google sign-in (its
  # callback address is production's), smaller footprint.
  set_env "$ENV" SMTP_HOST ""
  set_env "$ENV" PAYMENT_ALERT_EMAIL ""
  set_env "$ENV" R2_REMOTE ""
  set_env "$ENV" GOOGLE_CLIENT_ID ""
  set_env "$ENV" GOOGLE_CLIENT_SECRET ""
  set_env "$ENV" GOOGLE_REDIRECT_URI "https://$DOMAIN/api/v1/auth/google/callback"
  set_env "$ENV" WEB_CONCURRENCY 1
  set_env "$ENV" WORKER_CPUS 1.0
  chown "$OWNER" "$ENV"; chmod 600 "$ENV"
  echo "written (new secrets, no email, no off-site backups)"
else
  echo "already there; left as it is"
fi
install -d -o "$OWNER" -m 700 /var/backups/cornerroom-staging

say "3. HTTPS certificate and nginx site"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
fi
PASSWORD_FILE=/etc/nginx/cornerroom-staging.htpasswd
NEW_PASSWORD=""
if [ ! -f "$PASSWORD_FILE" ]; then
  NEW_PASSWORD="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf 'staging:%s\n' "$(openssl passwd -apr1 "$NEW_PASSWORD")" > "$PASSWORD_FILE"
  chown root:www-data "$PASSWORD_FILE"; chmod 640 "$PASSWORD_FILE"
fi
cp "$STAGING/deploy/nginx/staging.conf" /etc/nginx/sites-available/cornerroom-staging
ln -sf /etc/nginx/sites-available/cornerroom-staging /etc/nginx/sites-enabled/cornerroom-staging
nginx -t
systemctl reload nginx

say "4. First staging deploy"
sudo -u "$OWNER" bash -c "cd '$STAGING' && deploy/scripts/deploy.sh"

say "Staging is ready: https://$DOMAIN"
if [ -n "$NEW_PASSWORD" ]; then
  echo "Site password (shown once, keep it in your password manager):"
  echo "  user:     staging"
  echo "  password: $NEW_PASSWORD"
fi
echo "Staff sign-in on staging: BOOTSTRAP_ADMIN_EMAIL with the BOOTSTRAP_ADMIN_PASSWORD in $ENV"
