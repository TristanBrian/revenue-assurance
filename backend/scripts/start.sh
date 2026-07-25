#!/bin/bash
set -e

echo "🚀 KPC Revenue Assurance - Startup Script"
echo "🔍 Environment: $ENVIRONMENT"
echo "📁 Current directory: $(pwd)"

# Make sure we're in the right place
cd "$(dirname "$0")/.." || exit 1
echo "📁 Changed to backend root: $(pwd)"

# Ensure data directory exists
mkdir -p data/raw data/clean logs

# Check if data exists
if [ -f "data/raw/dispatches.csv" ] && [ -f "data/raw/invoices.csv" ] && [ -f "data/raw/payments.csv" ]; then
    echo "✅ Data already exists (CSVs found)"
else
    echo "📊 Generating fresh synthetic data..."
    python scripts/generate_kpc_data.py
fi

# Run ETL pipeline
echo "🔄 Running ETL pipeline..."
python scripts/etl_pipeline.py

# Run migrations
echo "🔄 Running Alembic migrations..."
alembic upgrade head

# Seed roles and users
echo "🔄 Seeding roles and users..."
python scripts/seed_roles.py
python scripts/seed_admin.py
python scripts/seed_demo_users.py

echo "🚀 Starting Uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000