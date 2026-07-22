"""
ETL Pipeline: Raw CSVs -> Clean SQLite Database
Handles: Data Cleaning, Installment Aggregation, Quality Gates
"""
import pandas as pd
import sqlite3
import os
from datetime import datetime

def run_etl():
    print(f"[{datetime.now()}] 🚀 Starting ETL Pipeline...")
    
    # 1. EXTRACT (Read Raw CSVs)
    raw_dir = 'data/raw'
    if not os.path.exists(raw_dir):
        raise FileNotFoundError(f"Raw data folder '{raw_dir}' not found. Run generator first.")
    
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
    db_path = 'kpc.db'
    if os.path.exists(db_path):
        os.remove(db_path)  # Fresh start
    
    conn = sqlite3.connect(db_path)
    
    # Write tables
    clean_disp_valid.to_sql('dispatches', conn, if_exists='replace', index=False)
    raw_inv.to_sql('invoices', conn, if_exists='replace', index=False)
    clean_payments.to_sql('payments', conn, if_exists='replace', index=False)  # Already aggregated!
    raw_omcs.to_sql('omcs', conn, if_exists='replace', index=False)
    clean_ledger.to_sql('depot_ledger', conn, if_exists='replace', index=False)
    
    # Create indexes for performance (Person A will love this)
    conn.execute("CREATE INDEX idx_dispatch_date ON dispatches (date);")
    conn.execute("CREATE INDEX idx_invoice_omc ON invoices (omc_id);")
    conn.execute("CREATE INDEX idx_payment_invoice ON payments (invoice_id);")
    
    conn.close()
    
    print(f"[{datetime.now()}] 📥 Loaded: Database '{db_path}' created with indexes.")
    print(f"[{datetime.now()}] ✅ ETL Pipeline Complete!")
    
    # Print summary for team
    print("\n📊 DATA SUMMARY:")
    print(f"   OMCs: {len(raw_omcs)}")
    print(f"   Valid Dispatches: {len(clean_disp_valid)}")
    print(f"   Invoices: {len(raw_inv)}")
    print(f"   Aggregated Payments: {len(clean_payments)}")
    print(f"   Ledger Entries: {len(clean_ledger)}")
    print(f"   Invalid Rows Flagged: {invalid_count}")

if __name__ == "__main__":
    run_etl()