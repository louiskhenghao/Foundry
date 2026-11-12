#!/usr/bin/env bash
# foundry-recipe: install-postgres
# title: PostgreSQL (with pgvector) on this server
# root: yes
# param: POSTGRES_APP_PASSWORD | The password of the postgres role (use it in the app's environment) | secret
# param: POSTGRES_APP_DB | The main database to create | app
# param: POSTGRES_APP_DB_TEST | A test database to create (empty = none) |
# param: POSTGRES_PUBLIC | yes = listen on every interface and accept password logins from any address (INSECURE without a strong password and a firewall); no = local connections only | no
# changes: installs the packages postgresql, postgresql-contrib and postgresql-<version>-pgvector; enables and starts the service
# changes: sets the postgres role's password and creates the databases named (existing ones are left as they are)
# changes: for POSTGRES_PUBLIC=yes, edits postgresql.conf (listen_addresses='*') and appends two host rules to pg_hba.conf (both backed up as .bak.foundry), allows 5432/tcp in ufw when active, and restarts PostgreSQL
#
# Modelled on an EC2 setup script. Idempotent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
POSTGRES_APP_PASSWORD="${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}"
POSTGRES_APP_DB="${POSTGRES_APP_DB:-app}"
POSTGRES_APP_DB_TEST="${POSTGRES_APP_DB_TEST:-}"
POSTGRES_PUBLIC="${POSTGRES_PUBLIC:-no}"

if command -v psql >/dev/null 2>&1 && systemctl is-active --quiet postgresql; then echo "PostgreSQL already running: $(psql --version)"; else
  echo "Installing PostgreSQL..."; apt-get update -qq; apt-get install -y -qq postgresql postgresql-contrib
  systemctl enable --now postgresql
fi
PG_MAJOR="$(ls -1 /etc/postgresql 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "${PG_MAJOR}" ]; then
  if apt-get install -y -qq "postgresql-${PG_MAJOR}-pgvector"; then echo "pgvector installed for PostgreSQL ${PG_MAJOR}."; else echo "pgvector could not be installed for PostgreSQL ${PG_MAJOR}; see https://github.com/pgvector/pgvector#apt" >&2; fi
fi

PW_SQL="${POSTGRES_APP_PASSWORD//\'/\'\'}"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER USER postgres WITH PASSWORD '${PW_SQL}';"
echo "Set the postgres role's password."
for db in "${POSTGRES_APP_DB}" "${POSTGRES_APP_DB_TEST}"; do
  [ -n "${db}" ] || continue
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then echo "Database ${db} already exists."; else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"${db}\";"; echo "Created database ${db}."
  fi
done

case "${POSTGRES_PUBLIC,,}" in
  yes|y|1|true)
    MAIN="$(ls -d /etc/postgresql/*/main | sort -V | tail -1)"
    CONF="${MAIN}/postgresql.conf"; HBA="${MAIN}/pg_hba.conf"
    echo "WARNING: opening PostgreSQL to every address; keep the password strong and the cloud firewall tight."
    if grep -qE "^listen_addresses\s*=\s*'\*'" "${CONF}"; then echo "listen_addresses is already '*'."; else
      cp -a "${CONF}" "${CONF}.bak.foundry"; sed -i -E "s/^#?listen_addresses\s*=.*/listen_addresses = '*'/" "${CONF}"; echo "Set listen_addresses='*' in ${CONF}"
    fi
    if grep -q 'foundry-recipe: public' "${HBA}"; then echo "pg_hba public rules already present."; else
      cp -a "${HBA}" "${HBA}.bak.foundry"
      printf '\n# foundry-recipe: public IPv4/IPv6 (scram-sha-256) — remove or restrict for production\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n' >> "${HBA}"
      echo "Appended public host rules to ${HBA}"
    fi
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then ufw allow 5432/tcp >/dev/null 2>&1 && echo "ufw: allowed 5432/tcp" || true; fi
    systemctl restart postgresql
    echo "PostgreSQL restarted; reachable on port 5432 from outside."
    ;;
  *) echo "PostgreSQL listens on localhost only (POSTGRES_PUBLIC=no)." ;;
esac
echo "Done: PROJECT_DB_USERNAME=postgres PROJECT_DB_DATABASE=${POSTGRES_APP_DB} (password as given)."
