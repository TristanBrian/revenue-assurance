#!/usr/bin/env bash
# Sets up a self-contained local Postgres cluster for this project — no
# sudo, no system Postgres role/service needed, doesn't touch any Postgres
# you might already have running on the default port.
#
# Auth requires Postgres (users/roles/permissions use Postgres-native UUID
# columns SQLite can't hold). This is the "I don't have a Postgres and don't
# want to fight system package config" path — if you already run your own
# local Postgres, just create a role/db yourself and point DATABASE_URL at
# it instead.
#
# Usage (from anywhere): backend/scripts/setup_local_postgres.sh
# Safe to re-run — skips steps that are already done.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGDATA="$REPO_ROOT/backend/.localpg/data"
PORT=5433
DB_NAME=kpc_db
DB_USER=kpc_app
DB_PASSWORD=kpc_local_dev

# Unix sockets have a ~107-byte path limit — a repo cloned somewhere deep
# blows past that easily, so this cluster is TCP-only (no -k socket dir).
find_pg_bin() {
  if command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return
  fi
  # Debian/Ubuntu package layout: /usr/lib/postgresql/<version>/bin
  local candidate
  candidate=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$candidate" ] && [ -x "$candidate/initdb" ]; then
    echo "$candidate"
    return
  fi
  echo ""
}

PG_BIN="$(find_pg_bin)"
if [ -z "$PG_BIN" ]; then
  echo "Could not find initdb/pg_ctl. Install PostgreSQL (postgresql-16 or" >&2
  echo "similar) so they're on PATH or under /usr/lib/postgresql/<ver>/bin." >&2
  exit 1
fi
echo "Using Postgres binaries at: $PG_BIN"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing cluster at $PGDATA ..."
  mkdir -p "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" -U "$(whoami)" --auth=trust >/dev/null
else
  echo "Cluster already initialized at $PGDATA"
fi

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "Starting Postgres on port $PORT ..."
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/logfile" -o "-p $PORT -h localhost -k ''" start
else
  echo "Postgres already running."
fi

export PGHOST=localhost PGPORT=$PORT PGUSER="$(whoami)"

if ! psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "Creating role $DB_USER ..."
  psql -d postgres -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';" >/dev/null
else
  echo "Role $DB_USER already exists."
fi

if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "Creating database $DB_NAME ..."
  createdb -O "$DB_USER" "$DB_NAME"
else
  echo "Database $DB_NAME already exists."
fi

echo ""
echo "Done. Add this to your repo-root .env:"
echo ""
echo "  DATABASE_URL=postgresql+psycopg2://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME"
echo ""
echo "To stop this cluster later:"
echo "  $PG_BIN/pg_ctl -D $PGDATA stop"
