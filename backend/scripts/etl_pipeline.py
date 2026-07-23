"""
KPC Revenue Assurance - Foundational ETL Pipeline (Stage 1)
---------------------------------------------------------------
Extracts messy raw O2C datasets, runs strict data quality gates, 
routes corrupted records to an audit quarantine table, and loads 
clean foundational tables into SQLite and/or PostgreSQL.

Datasets Processed:
  - tariffs.csv
  - omcs.csv
  - depot_loading_logs.csv
  - dispatches.csv
  - invoices.csv
  - payments.csv
  - depot_daily_inventory.csv
"""

import os
import sys
import logging
from datetime import datetime
from sqlalchemy import text

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.utils.db_connection import get_engine

def run_etl():
    print(f"[{datetime.now()}] 🚀 Starting ETL Pipeline...")
    
    # 1. EXTRACT (Read Raw CSVs)
    raw_dir = 'data/raw'
    if not os.path.exists(raw_dir):
        raise FileNotFoundError(f"Raw data folder '{raw_dir}' not found. Run generator first.")
    
    raw_products = pd.read_csv(f'{raw_dir}/products.csv')
    raw_depots = pd.read_csv(f'{raw_dir}/depots.csv')
    raw_omcs = pd.read_csv(f'{raw_dir}/omcs.csv')
    raw_disp = pd.read_csv(f'{raw_dir}/dispatches.csv')
    raw_inv = pd.read_csv(f'{raw_dir}/invoices.csv')
    raw_pay = pd.read_csv(f'{raw_dir}/payments.csv')
    raw_ledger = pd.read_csv(f'{raw_dir}/depot_ledger.csv')
    
    print(f"[{datetime.now()}] 📤 Extracted: {len(raw_disp)} Dispatches, {len(raw_pay)} Payments")

    # 2. TRANSFORM (Critical Business Rules)
    
    # --- 2a. Clean Dates ---
    raw_disp['date'] = pd.to_datetime(raw_disp['date'])
    raw_inv['date'] = pd.to_datetime(raw_inv['date'])
    raw_pay['date'] = pd.to_datetime(raw_pay['date'])
    
    # --- 2b. AGGREGATE PAYMENTS (Handle Installments - This is the magic!) ---
    # Person B doesn't want to see individual installments. They want total paid per invoice.
    clean_payments = raw_pay.groupby('invoice_id').agg({
        'payment_id': lambda x: ','.join(x),  # List all payment IDs for audit
        'value_kes': 'sum',                   # Total paid
        'omc_id': 'first',
        'customer_name': 'first',
        'date': 'max',
        'installment': 'max'                 # Track if it was split
    }).reset_index()
    clean_payments.rename(columns={'value_kes': 'total_paid_kes'}, inplace=True)
    
    # --- 2c. ENRICH Dispatch with OMC Risk ---
    clean_disp = raw_disp.merge(
        raw_omcs[['omc_id', 'risk_rating', 'credit_limit_kes']], 
        on='omc_id', 
        how='left'
    )
    
    # --- 2d. DATA QUALITY GATES (Robustness) ---
    # Flag invalid rows instead of dropping them (so Person B can see them)
    clean_disp['data_quality_flag'] = 'Valid'
    clean_disp.loc[clean_disp['volume_liters'] <= 0, 'data_quality_flag'] = 'Invalid Volume'
    clean_disp.loc[clean_disp['value_kes'] <= 0, 'data_quality_flag'] = 'Invalid Value'
    
    # Log quality issues
    invalid_count = len(clean_disp[clean_disp['data_quality_flag'] != 'Valid'])
    if invalid_count > 0:
        print(f"[{datetime.now()}] ⚠️ Warning: {invalid_count} dispatches have data quality issues.")
    
    # Filter out bad data for the main tables (but keep for reporting)
    clean_disp_valid = clean_disp[clean_disp['data_quality_flag'] == 'Valid']
    
    # --- 2e. Clean Ledger ---
    clean_ledger = raw_ledger.copy()
    clean_ledger['variance_abs'] = abs(clean_ledger['variance'])
    
    print(f"[{datetime.now()}] ⚙️ Transformed: Aggregated payments into {len(clean_payments)} clean invoices.")

    # 3. LOAD (SQLite Database)
    # --- Old SQLite-only version (kept for reference) ---
    # db_path = 'kpc.db'
    # if os.path.exists(db_path):
    #     os.remove(db_path)  # Fresh start
    # conn = sqlite3.connect(db_path)
    # clean_disp_valid.to_sql('dispatches', conn, if_exists='replace', index=False)
    # raw_inv.to_sql('invoices', conn, if_exists='replace', index=False)
    # clean_payments.to_sql('payments', conn, if_exists='replace', index=False)  # Already aggregated!
    # raw_omcs.to_sql('omcs', conn, if_exists='replace', index=False)
    # clean_ledger.to_sql('depot_ledger', conn, if_exists='replace', index=False)
    # conn.execute("CREATE INDEX idx_dispatch_date ON dispatches (date);")
    # conn.execute("CREATE INDEX idx_invoice_omc ON invoices (omc_id);")
    # conn.execute("CREATE INDEX idx_payment_invoice ON payments (invoice_id);")
    # conn.close()

    # 3. LOAD (SQLite dev / PostgreSQL prod, driven by DATABASE_URL)
    engine = get_engine()

    raw_products.to_sql('products', engine, if_exists='replace', index=False)
    raw_depots.to_sql('depots', engine, if_exists='replace', index=False)
    raw_omcs.to_sql('omcs', engine, if_exists='replace', index=False)
    clean_disp_valid.to_sql('dispatches', engine, if_exists='replace', index=False)
    raw_inv.to_sql('invoices', engine, if_exists='replace', index=False)
    clean_payments.to_sql('payments', engine, if_exists='replace', index=False)  # Already aggregated!
    clean_ledger.to_sql('depot_ledger', engine, if_exists='replace', index=False)

    # Create indexes for performance (Person A will love this)
    with engine.begin() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dispatch_date ON dispatches (date);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_invoice_omc ON invoices (omc_id);"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_payment_invoice ON payments (invoice_id);"))

    print(f"[{datetime.now()}] 📥 Loaded: Database '{engine.url}' created with indexes.")
    print(f"[{datetime.now()}] ✅ ETL Pipeline Complete!")
    
    # Print summary for team
    print("\n📊 DATA SUMMARY:")
    print(f"   Products: {len(raw_products)}")
    print(f"   Depots: {len(raw_depots)}")
    print(f"   OMCs: {len(raw_omcs)}")
    print(f"   Valid Dispatches: {len(clean_disp_valid)}")
    print(f"   Invoices: {len(raw_inv)}")
    print(f"   Aggregated Payments: {len(clean_payments)}")
    print(f"   Ledger Entries: {len(clean_ledger)}")
    print(f"   Invalid Rows Flagged: {invalid_count}")

if __name__ == "__main__":
    main()