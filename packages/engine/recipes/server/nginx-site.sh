#!/usr/bin/env bash
# foundry-recipe: nginx-site
# title: nginx in front of the project, with HTTPS
# root: yes
# fixes: front
# param: DOMAIN | The domain visitors use (the public address's host) |
# param: APP_PORT | The port the project listens on, on this server | 3000
# param: SITE_NAME | The nginx site's name (one file under sites-available) | app
# param: SSL_MODE | files = the certificate and key below (a Cloudflare origin certificate, or your own); letsencrypt = a free certificate from Let's Encrypt through certbot (the domain must already point at this server, port 80 open); none = HTTP on port 80 only (Cloudflare in front, Flexible mode) | letsencrypt
# param: CERT_PEM | The certificate (PEM), for SSL_MODE=files | secret
# param: KEY_PEM | Its private key (PEM), for SSL_MODE=files | secret
# param: LETSENCRYPT_EMAIL | Where Let's Encrypt sends expiry notices, for SSL_MODE=letsencrypt |
# changes: installs the package nginx (and certbot with python3-certbot-nginx for SSL_MODE=letsencrypt)
# changes: writes /etc/nginx/sites-available/SITE_NAME and links it under sites-enabled (an existing file of that name is kept as .bak.foundry-<time>); the stock default site is left alone
# changes: for SSL_MODE=files, writes the certificate and key to /etc/nginx/ssl/DOMAIN.crt and .key (key readable by root only)
# changes: for SSL_MODE=letsencrypt, certbot obtains a certificate and edits the site for HTTPS with a redirect
# changes: allows "Nginx Full" (80 and 443) in ufw when ufw is active
# changes: tests the configuration and reloads nginx (never stops it)
#
# Modelled on an EC2 nginx + SSL setup script: proxy to localhost:APP_PORT with WebSocket support, TLS 1.2+1.3,
# security headers, a /health passthrough. Idempotent: run again to change the port or the certificate.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DOMAIN="${DOMAIN:?DOMAIN is required}"
APP_PORT="${APP_PORT:?APP_PORT is required}"
SITE_NAME="${SITE_NAME:-app}"
SSL_MODE="${SSL_MODE:-letsencrypt}"
CERT_PEM="${CERT_PEM:-}"
KEY_PEM="${KEY_PEM:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
STAMP="$(date +%Y%m%d%H%M%S)"
SITE="/etc/nginx/sites-available/${SITE_NAME}"

case "${SSL_MODE}" in
  files) [ -n "${CERT_PEM}" ] && [ -n "${KEY_PEM}" ] || { echo "SSL_MODE=files needs CERT_PEM and KEY_PEM" >&2; exit 1; } ;;
  letsencrypt) [ -n "${LETSENCRYPT_EMAIL}" ] || { echo "SSL_MODE=letsencrypt needs LETSENCRYPT_EMAIL" >&2; exit 1; } ;;
  none) ;;
  *) echo "SSL_MODE must be files, letsencrypt or none (got ${SSL_MODE})" >&2; exit 1 ;;
esac

if command -v nginx >/dev/null 2>&1; then echo "nginx is already installed: $(nginx -v 2>&1)"; else
  echo "Installing nginx..."; apt-get update -qq; apt-get install -y -qq nginx
fi
if [ "${SSL_MODE}" = "letsencrypt" ] && ! command -v certbot >/dev/null 2>&1; then
  echo "Installing certbot..."; apt-get install -y -qq certbot python3-certbot-nginx
fi

SSL_BLOCK=""
LISTEN_443=""
REDIRECT=""
if [ "${SSL_MODE}" = "files" ]; then
  install -m 0755 -d /etc/nginx/ssl
  printf '%s\n' "${CERT_PEM}" > "/etc/nginx/ssl/${DOMAIN}.crt"
  printf '%s\n' "${KEY_PEM}" > "/etc/nginx/ssl/${DOMAIN}.key"
  chmod 644 "/etc/nginx/ssl/${DOMAIN}.crt"; chmod 600 "/etc/nginx/ssl/${DOMAIN}.key"; chown root:root "/etc/nginx/ssl/${DOMAIN}.crt" "/etc/nginx/ssl/${DOMAIN}.key"
  echo "Wrote /etc/nginx/ssl/${DOMAIN}.crt and .key"
  SSL_BLOCK="    ssl_certificate /etc/nginx/ssl/${DOMAIN}.crt;
    ssl_certificate_key /etc/nginx/ssl/${DOMAIN}.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;
    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;"
  LISTEN_443="    listen 443 ssl http2;
    listen [::]:443 ssl http2;"
  REDIRECT="server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
"
fi

if [ -f "${SITE}" ]; then cp -a "${SITE}" "${SITE}.bak.foundry-${STAMP}"; echo "Kept the existing site as ${SITE}.bak.foundry-${STAMP}"; fi
cat > "${SITE}" <<NGINX
# ${SITE_NAME} — written by Foundry's nginx-site recipe (${STAMP}); run the recipe again to change it
${REDIRECT}server {
$( [ -n "${LISTEN_443}" ] && printf '%s\n' "${LISTEN_443}" || printf '    listen 80;\n    listen [::]:80;' )
    server_name ${DOMAIN};
${SSL_BLOCK}
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    access_log /var/log/nginx/${SITE_NAME}-access.log;
    error_log /var/log/nginx/${SITE_NAME}-error.log;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_cache_bypass \$http_upgrade;
    }
    location /health {
        proxy_pass http://127.0.0.1:${APP_PORT};
        access_log off;
    }
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
NGINX
ln -sf "${SITE}" "/etc/nginx/sites-enabled/${SITE_NAME}"
echo "Wrote ${SITE} (proxy to 127.0.0.1:${APP_PORT}, SSL_MODE=${SSL_MODE})"

nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi

if [ "${SSL_MODE}" = "letsencrypt" ]; then
  echo "Asking Let's Encrypt for a certificate for ${DOMAIN}..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect
  echo "Certificate installed; certbot renews it by itself."
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 && echo "ufw: allowed Nginx Full (80, 443)" || true
fi
case "${SSL_MODE}" in
  none) echo "Done: http://${DOMAIN} → 127.0.0.1:${APP_PORT} (HTTP only; put Cloudflare in front for https)";;
  *) echo "Done: https://${DOMAIN} → 127.0.0.1:${APP_PORT}";;
esac
