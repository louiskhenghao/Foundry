#!/usr/bin/env bash
# foundry-recipe: install-node-pm2
# title: Node.js, Yarn and PM2 for a server in PM2 mode
# root: yes
# fixes: runtime
# param: NODE_MAJOR | The Node.js major version from NodeSource | 24
# param: TARGET_USER | The user whose PM2 keeps the apps running (Foundry's ssh user) | deploy
# changes: adds NodeSource's apt repository and installs the package nodejs (NODE_MAJOR.x), unless node is already installed
# changes: installs yarn and pm2 globally with npm
# changes: registers PM2 as a systemd service for TARGET_USER (pm2 startup), so its apps come back after a reboot
#
# Modelled on an EC2 setup script. Idempotent: what is installed is reported, not reinstalled.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
NODE_MAJOR="${NODE_MAJOR:-24}"
TARGET_USER="${TARGET_USER:-root}"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
[ -n "${TARGET_HOME}" ] || { echo "No such user: ${TARGET_USER}" >&2; exit 1; }

if command -v node >/dev/null 2>&1; then echo "Node.js already installed: $(node -v)"; else
  echo "Installing Node.js ${NODE_MAJOR}.x..."
  apt-get update -qq; apt-get install -y -qq ca-certificates curl
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  echo "Installed Node.js $(node -v)"
fi
if command -v yarn >/dev/null 2>&1; then echo "Yarn already installed: $(yarn -v)"; else npm install -g yarn >/dev/null; echo "Installed Yarn $(yarn -v)"; fi
if command -v pm2 >/dev/null 2>&1; then echo "PM2 already installed: $(pm2 -v)"; else npm install -g pm2 >/dev/null; echo "Installed PM2 $(pm2 -v)"; fi

echo "Registering PM2 with systemd for ${TARGET_USER}..."
env PATH="${PATH}:/usr/bin" pm2 startup systemd -u "${TARGET_USER}" --hp "${TARGET_HOME}" >/dev/null
echo "Done: node $(node -v), yarn $(yarn -v), pm2 $(pm2 -v); PM2 starts at boot for ${TARGET_USER}."
