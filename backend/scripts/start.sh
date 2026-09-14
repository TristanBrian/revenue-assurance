#!/bin/bash
set -e          # exit on error
set -u          # treat unset variables as error
# set -x          # print each command before executing (tracing) - COMMENT THIS OUT

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
    # disbursements.csv is the LAST file generate_kpc_data.py writes
    # (inbound dispatches/invoices/payments first, then substantial
    # computation, then outbound officers/beneficiaries/attendance/
    # stipend_authorizations/disbursements — see that script's own
    # write order). Checking only the three inbound files here used to
    # let a generation run that crashed/OOM'd/timed out midway (after
    # inbound, before outbound) look "complete" forever after: this
    # check would keep finding the inbound CSVs on every restart and
    # skip regenerating anything, permanently leaving outbound data
    # missing with no visible error (etl_pipeline.py treats outbound
    # CSVs as optional and just warns-and-skips them, so nothing else
    # failed loudly either). Requiring disbursements.csv too means a
    # partial run gets detected and regenerated from scratch instead of
    # silently wedging in that state.
    if [ -f "data/raw/dispatches.csv" ] && [ -f "data/raw/invoices.csv" ] && [ -f "data/raw/payments.csv" ] && [ -f "data/raw/disbursements.csv" ]; then
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
# 4. Run migrations and seeding - WITH FIX FOR DUPLICATE TABLES
# ------------------------------------------------------------------
echo "🔄 Running Alembic migrations..."

# Check if alembic_version table exists and get current state
if psql $DATABASE_URL -t -c "SELECT 1 FROM alembic_version" 2>/dev/null | grep -q "1"; then
    echo "✅ Migration table exists. Running upgrades..."
    # Try to upgrade, if it fails due to duplicate tables, stamp as head
    alembic upgrade head || {
        echo "⚠️  Alembic upgrade failed. Stamping as head..."
        alembic stamp head
    }
else
    echo "⚠️  No migration table found. Running from scratch..."
    alembic upgrade head || {
        echo "⚠️  Alembic upgrade failed. Stamping as head..."
        alembic stamp head
    }
fi

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