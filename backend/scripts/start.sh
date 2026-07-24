#!/bin/bash
set -e

echo "🚀 KPC Revenue Assurance - Startup Script"

# Check if all three CSV files already exist
if [ -f "data/raw/dispatches.csv" ] && [ -f "data/raw/invoices.csv" ] && [ -f "data/raw/payments.csv" ]; then
    echo "✅ Data already exists (dispatches.csv, invoices.csv, payments.csv found)"
    echo "📊 Skipping data generation..."
else
    echo "📊 Generating fresh synthetic data (first run)..."
    python scripts/generate_kpc_data.py
fi

echo "🔄 Running ETL pipeline..."
python scripts/etl_pipeline.py

echo "🔄 Running Alembic migrations..."
alembic upgrade head

echo "🔄 Seeding roles and users..."
python scripts/seed_roles.py
python scripts/seed_admin.py
python scripts/seed_demo_users.py

echo "🚀 Starting Uvicorn server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload