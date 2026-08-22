#!/bin/bash
set -e
set -u

echo "🚀 KPC Revenue Assurance - Startup Script"
echo "🔍 Environment: ${ENVIRONMENT:-production}"   # <-- default added
echo "📁 Current directory: $(pwd)"

cd "$(dirname "$0")/.." || exit 1
echo "📁 Changed to backend root: $(pwd)"

mkdir -p data/raw data/clean logs

# ------------------------------------------------------------------
# 1. Check if PostgreSQL data already exists
# ------------------------------------------------------------------
RUN_ETL=1

is_postgres_url() {
    case "$1" in
        postgres://*|postgresql://*|postgresql+*) return 0 ;;
        *) return 1 ;;
    esac
}

if [ -n "$DATABASE_URL" ] && is_postgres_url "$DATABASE_URL"; then
    echo "✅ PostgreSQL detected (DATABASE_URL set)"
    # Run a Python script to check if 'dispatches' table has data.
    # We capture the exit code and ignore the output to avoid parsing errors.
    python3 -c "
import os, sys
from sqlalchemy import create_engine, text
try:
    engine = create_engine(os.environ['DATABASE_URL'])
    with engine.connect() as conn:
        result = conn.execute(text(\"SELECT EXISTS (SELECT 1 FROM dispatches LIMIT 1)\")).scalar()
        sys.exit(0 if result else 1)
except Exception:
    sys.exit(2)
" 2>/dev/null

    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "✅ Data found in PostgreSQL – skipping ETL and data generation."
        RUN_ETL=0
    elif [ $EXIT_CODE -eq 1 ]; then
        echo "📊 No data found in PostgreSQL – will run ETL."
        RUN_ETL=1
    else
        echo "⚠️ Could not check database – running ETL to be safe."
        RUN_ETL=1
    fi
else
    echo "ℹ️ No PostgreSQL URL – assuming SQLite mode."
    RUN_ETL=1
fi

# ------------------------------------------------------------------
# 2. Run data generation & ETL only if needed
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
# 2b. Medallion lakehouse
# ------------------------------------------------------------------
echo "🔄 Setting up medallion schema (bronze/silver/gold)..."
python scripts/setup_medallion.py

echo "🔄 Loading master data (master schema)..."
python scripts/load_master_data.py

# ------------------------------------------------------------------
# 3. Always run migrations and seeding
# ------------------------------------------------------------------
echo "🔄 Running Alembic migrations..."
alembic upgrade head

echo "🔄 Seeding roles and users..."
python scripts/seed_roles.py
python scripts/seed_admin.py
python scripts/seed_demo_users.py
python scripts/seed_terms_documents.py

echo "🚀 Starting Uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}