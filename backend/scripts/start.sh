#!/bin/bash
set -e

echo "🚀 KPC Revenue Assurance - Startup Script"
echo "🔍 Environment: $ENVIRONMENT"
echo "📁 Current directory: $(pwd)"

# Move to backend root
cd "$(dirname "$0")/.." || exit 1
echo "📁 Changed to backend root: $(pwd)"

# Ensure data directories exist
mkdir -p data/raw data/clean logs

# ------------------------------------------------------------------
# 1. Check if PostgreSQL data already exists
# ------------------------------------------------------------------
RUN_ETL=1  # default: run ETL

if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" == postgresql://* ]]; then
    echo "✅ PostgreSQL detected (DATABASE_URL set)"

    # Check if 'dispatches' table has any rows
    DATA_EXISTS=$(python3 -c "
import os
import sys
from sqlalchemy import create_engine, text

try:
    engine = create_engine(os.environ['DATABASE_URL'])
    with engine.connect() as conn:
        result = conn.execute(text(\"SELECT EXISTS (SELECT 1 FROM dispatches LIMIT 1)\")).scalar()
        sys.exit(0 if result else 1)
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(2)
" 2>&1 || echo "error")

    if [[ "$DATA_EXISTS" == "error" ]] || [[ "$DATA_EXISTS" == "2" ]]; then
        echo "⚠️ Could not check database – running ETL to be safe."
        RUN_ETL=1
    elif [[ "$DATA_EXISTS" -eq 0 ]]; then
        echo "✅ Data found in PostgreSQL – skipping ETL and data generation."
        RUN_ETL=0
    else
        echo "📊 No data found in PostgreSQL – will run ETL."
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
    # Generate CSVs if missing
    if [ -f "data/raw/dispatches.csv" ] && [ -f "data/raw/invoices.csv" ] && [ -f "data/raw/payments.csv" ]; then
        echo "✅ CSVs already exist – skipping generation."
    else
        echo "📊 Generating fresh synthetic data..."
        python scripts/generate_kpc_data.py
    fi

    echo "🔄 Running ETL pipeline..."
    python scripts/etl_pipeline.py
else
    echo "⏭️ Skipping ETL pipeline (data already present)."
fi

# ------------------------------------------------------------------
# 2b. Medallion lakehouse foundation (bronze/silver/gold) — always run.
# Parallel to the main app's data path above, not a replacement for it:
# the running API still reads the plain public-schema tables ETL just
# loaded. This only creates the bronze/silver/gold schemas and loads
# static/historical CSVs into a separate 'master' schema; nothing reads
# from either yet. Both scripts no-op cleanly if DATABASE_URL isn't
# Postgres. live_kpc_stream.py (continuous bronze->silver->gold feed) is
# deliberately NOT run here — still a manual/separate step for now.
# ------------------------------------------------------------------
echo "🔄 Setting up medallion schema (bronze/silver/gold)..."
python scripts/setup_medallion.py

echo "🔄 Loading master data (master schema)..."
python scripts/load_master_data.py

# ------------------------------------------------------------------
# 3. Always run migrations and seeding (idempotent)
# ------------------------------------------------------------------
echo "🔄 Running Alembic migrations..."
alembic upgrade head

echo "🔄 Seeding roles and users..."
python scripts/seed_roles.py
python scripts/seed_admin.py
python scripts/seed_demo_users.py
python scripts/seed_terms_documents.py

echo "🚀 Starting Uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}