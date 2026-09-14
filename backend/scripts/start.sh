#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Startup failed at line $LINENO" >&2' ERR
cd "$(dirname "$0")/.."
mkdir -p data/raw data/clean logs

# ETL replaces operational tables. Never run it implicitly on a restart.
if [ "${BOOTSTRAP_DEMO_DATA:-false}" = "true" ]; then
    echo "Bootstrapping synthetic demo data (dedicated demo database only)"
    python scripts/generate_kpc_data.py
    cp scripts/data/raw/*.csv data/raw/
    python scripts/etl_pipeline.py
    python scripts/setup_medallion.py
    python scripts/load_master_data.py
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
    python scripts/seed_roles.py
    python scripts/seed_terms_documents.py
fi

if [ "${BOOTSTRAP_ADMIN:-false}" = "true" ]; then
    python scripts/seed_admin.py
fi
if [ "${SEED_DEMO_USERS:-false}" = "true" ]; then
    python scripts/seed_demo_users.py
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
