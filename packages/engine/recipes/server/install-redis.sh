#!/usr/bin/env bash
# foundry-recipe: install-redis
# title: Redis on this server
# root: yes
# changes: installs the package redis-server; enables and starts the service (listening on 127.0.0.1:6379)
#
# Modelled on an EC2 setup script. Idempotent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if command -v redis-server >/dev/null 2>&1 && systemctl is-active --quiet redis-server; then echo "Redis already running: $(redis-server --version | cut -d' ' -f1-3)"; else
  echo "Installing Redis..."; apt-get update -qq; apt-get install -y -qq redis-server
  systemctl enable --now redis-server
fi
echo "Done: Redis on 127.0.0.1:6379."
