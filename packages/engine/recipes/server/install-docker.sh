#!/usr/bin/env bash
# foundry-recipe: install-docker
# title: Install Docker Engine and the compose plugin
# root: yes
# fixes: docker
# param: TARGET_USER | The user Foundry logs in as, added to the docker group | deploy
# changes: adds Docker's apt repository and key under /etc/apt (Ubuntu or Debian)
# changes: installs the packages docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin, docker-compose-plugin
# changes: enables and starts the docker service
# changes: adds TARGET_USER to the docker group (a member of that group can act as root through Docker)
#
# Idempotent: a Docker that is already installed is left as it is; only the group membership is checked.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
TARGET_USER="${TARGET_USER:-}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Docker is already installed: $(docker --version); $(docker compose version)"
else
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) echo "This recipe installs Docker on Ubuntu or Debian only (this server is ${PRETTY_NAME:-unknown}); see https://docs.docker.com/engine/install/" >&2; exit 1 ;;
  esac
  echo "Installing Docker Engine on ${PRETTY_NAME}..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "Installed: $(docker --version); $(docker compose version)"
fi

if [ -n "${TARGET_USER}" ] && [ "${TARGET_USER}" != "root" ]; then
  if id -nG "${TARGET_USER}" 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    echo "${TARGET_USER} is already in the docker group."
  else
    usermod -aG docker "${TARGET_USER}"
    echo "Added ${TARGET_USER} to the docker group (takes effect on their next login; Foundry's next ssh session sees it)."
  fi
fi
echo "Docker is ready."
