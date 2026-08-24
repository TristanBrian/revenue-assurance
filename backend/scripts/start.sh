#!/bin/bash
set -e          # exit on error
set -u          # treat unset variables as error
set -x          # print each command before executing (tracing)

# Trap errors and print the line number
trap 'echo "❌ Error at line $LINENO (command: $BASH_COMMAND)" >&2; exit 1' ERR

echo "🚀 KPC Revenue Assurance - Startup Script"
echo "🔍 Environment: ${ENVIRONMENT:-production}"
echo "📁 Current directory: $(pwd)"

cd "$(dirname "$0")/.." || exit 1
echo "📁 Changed to backend root: $(pwd)"

mkdir -p data/raw data/clean logs

# ------------------------------------------------------------------
# 1. Always run ETL – no database check (Fly.io internal networking
#    may not resolve .flycast domains reliably during startup).
# ------------------------------------------------------------------
RUN_ETL=1

# ------------------------------------------------------------------
# 2. Run data generation & ETL
# ------------------------------------------------------------------
if [ "$RUN_ETL" -eq 1 ]; then
    if [ -f "data/raw/dispatches.csv" ] && [ -f "data/raw/invoices.csv" ] && [ -f "data/raw/payments.csv" ]; then
        echo "✅ CSVs already exist – skipping generation."
    else
        echo "📊 Generating fresh synthetic data..."
        python scripts/generate_kpc_data.py
        # Copy generated CSVs to ETL expected location
        mkdir -p data/raw
        cp scripts/data/raw/* data/raw/ 2>/dev/null || true
    fi

    echo "🔄 Running ETL pipeline..."
    python scripts/etl_pipeline.py
else
    echo "⏭️ Skipping ETL pipeline (data already present)."
fi

# ------------------------------------------------------------------
# 3. Medallion lakehouse (always run, but never break startup)
# ------------------------------------------------------------------
echo "🔄 Setting up medallion schema (bronze/silver/gold)..."
python scripts/setup_medallion.py || true

echo "🔄 Loading master data (master schema)..."
python scripts/load_master_data.py || true

# ------------------------------------------------------------------
# 4. Always run migrations and seeding
# ------------------------------------------------------------------
echo "🔄 Running Alembic migrations..."
alembic upgrade head

echo "🔄 Seeding roles and platform bootstrap..."
python scripts/seed_roles.py
python scripts/seed_admin.py
python scripts/seed_terms_documents.py

# Demo accounts are deliberately opt-in. Running this on every deployment
# would overwrite demo passwords and force every demo user through reset again.
if [ "${SEED_DEMO_USERS:-false}" = "true" ]; then
    echo "🔐 SEED_DEMO_USERS=true — resetting local demo accounts"
    python scripts/seed_demo_users.py
else
    echo "⏭️ Skipping demo-account seeding (set SEED_DEMO_USERS=true for a local demo)"
fi

echo "🚀 Starting Uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}