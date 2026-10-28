#!/usr/bin/env bash
# Installs or updates WOS on an Ubuntu server: Docker container behind nginx, HTTPS from Let's Encrypt.
# Run as root on the server:  bash setup.sh <email for Let's Encrypt expiry notices>
# Running it again updates the code and rebuilds; the data volume (wos-data) is kept.
set -euo pipefail

DOMAIN=wos.techz.web.id
EMAIL=${1:?"usage: bash setup.sh <email for Lets Encrypt>"}
REPO=https://github.com/gawlzie/Work-Order-System.git
BRANCH=web-responsive
DIR=/opt/wos

echo "== 1. Packages (git, certbot, Docker)"
apt-get update -q
apt-get install -y -q git curl ca-certificates certbot python3-certbot-nginx
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "== 2. Code ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi

echo "== 3. WOS container"
docker compose -f "$DIR/deploy/docker-compose.yml" up -d --build
for i in $(seq 1 30); do curl -fs -o /dev/null http://127.0.0.1:3000/login && break; sleep 2; done
curl -fs -o /dev/null http://127.0.0.1:3000/login || { echo "WOS did not start:"; docker logs --tail 50 wos; exit 1; }

echo "== 4. nginx -> WOS"
cp "$DIR/deploy/nginx-wos.conf" /etc/nginx/sites-available/wos
ln -sf /etc/nginx/sites-available/wos /etc/nginx/sites-enabled/wos
# The "Welcome to nginx" site (the file stays in sites-available).
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== 5. HTTPS"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full'; fi
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot install --nginx --cert-name "$DOMAIN" -n --redirect
else
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n
fi
systemctl reload nginx

echo "== Done: https://$DOMAIN"
curl -s -o /dev/null -w "https check: %{http_code}\n" "https://$DOMAIN/login" || true
