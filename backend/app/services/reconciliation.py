"""
- Vectorized operations for speed
- Dynamic column detection
- Data quality scoring
- Duplicate detection (fraud prevention)
- OMC risk profiling
- Materiality threshold support
- Performance logging
- NaN‑safe date and numeric conversions
- JSON sanitizer for inf/nan values
- 100% JSON‑compliant even with messy data
"""

import pandas as pd
# import sqlite3  # replaced by SQLAlchemy engine (see app.utils.db_connection)
import os
from datetime import datetime
import numpy as np
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass
import time
from collections import Counter
import math

from app.utils.db_connection import get_engine

# =============================================================================
# LOGGING SETUP
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION
# =============================================================================

# DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')  # SQLite-only path, no longer used directly
UNDERPAYMENT_THRESHOLD = 100       # KSh - ignore tiny rounding errors
CRITICAL_AGE_DAYS = 60             # Days after which pending becomes critical
MATERIALITY_THRESHOLD = 100000     # KSh - only flag leaks above this (configurable)

# =============================================================================
# JSON SANITIZER
# =============================================================================

def clean_json_values(obj):
    """
    Recursively clean dictionaries, lists, and primitive types.
    Replaces NaN and Infinity with 0.
    """
    if isinstance(obj, dict):
        return {k: clean_json_values(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_json_values(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return 0
        return obj
    elif isinstance(obj, (np.float64, np.float32)):
        if np.isnan(obj) or np.isinf(obj):
            return 0
        return float(obj)
    elif isinstance(obj, (np.int64, np.int32)):
        return int(obj)
    else:
        return obj

# =============================================================================
# HELPERS
# =============================================================================

@dataclass
class DataQualityReport:
    total_rows: int
    null_volume: int
    null_value: int
    zero_volume: int
    zero_value: int
    invalid_customer: int
    quality_score: float


# def get_table_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
#     """SQLite-only helper (PRAGMA table_info). Unused; kept for reference."""
#     cursor = conn.execute(f"PRAGMA table_info({table_name})")
#     return [row[1] for row in cursor.fetchall()]


def calculate_data_quality(df: pd.DataFrame, customer_col: str, value_col: str) -> DataQualityReport:
    total = len(df)
    null_volume = df['volume_liters'].isna().sum() if 'volume_liters' in df else 0
    null_value = df[value_col].isna().sum() if value_col in df else 0
    zero_volume = (df['volume_liters'] == 0).sum() if 'volume_liters' in df else 0
    zero_value = (df[value_col] == 0).sum() if value_col in df else 0
    invalid_customer = df[customer_col].isna().sum() if customer_col in df else 0

    quality_score = 100.0
    if total > 0:
        quality_score -= (null_volume / total) * 25
        quality_score -= (null_value / total) * 25
        quality_score -= (zero_volume / total) * 10
        quality_score -= (zero_value / total) * 10
        quality_score -= (invalid_customer / total) * 30
        quality_score = max(0, quality_score)

    return DataQualityReport(
        total_rows=total,
        null_volume=int(null_volume),
        null_value=int(null_value),
        zero_volume=int(zero_volume),
        zero_value=int(zero_value),
        invalid_customer=int(invalid_customer),
        quality_score=round(quality_score, 2)
    )


def detect_duplicates(df: pd.DataFrame, column: str, label: str) -> List[Dict]:
    if column not in df.columns:
        return []
    dupes = df[df.duplicated(subset=[column], keep=False)]
    if dupes.empty:
        return []
    return [{
        'type': 'Duplicate Detection',
        'column': column,
        'label': label,
        'duplicate_count': len(dupes),
        'details': dupes.to_dict(orient='records')
    }]


def calculate_omc_risk(anomalies_df: pd.DataFrame) -> List[Dict]:
    if anomalies_df.empty:
        return []
    omc_stats = anomalies_df.groupby('customer').agg({
        'leakage_kes': 'sum',
        'dispatch_id': 'count'
    }).reset_index().rename(columns={'dispatch_id': 'anomaly_count'})
    bins = [0, 100000, 1000000, float('inf')]
    labels = ['Low', 'Medium', 'High']
    omc_stats['risk_level'] = pd.cut(omc_stats['leakage_kes'], bins=bins, labels=labels)
    return omc_stats.to_dict(orient='records')


# =============================================================================
# CORE RECONCILIATION ENGINE
# =============================================================================

def run_reconciliation_on_dataframes(
    dispatches_df: pd.DataFrame,
    invoices_df: pd.DataFrame,
    payments_df: pd.DataFrame,
    materiality: float = MATERIALITY_THRESHOLD
) -> Dict:
    start_time = time.time()
    logger.info("🚀 Starting reconciliation on DataFrames...")

    dispatches = dispatches_df.copy()
    invoices = invoices_df.copy()
    payments = payments_df.copy()

    # Clean dates
    for col in ['date']:
        if col in dispatches.columns:
            dispatches[col] = pd.to_datetime(dispatches[col], errors='coerce')
        if col in invoices.columns:
            invoices[col] = pd.to_datetime(invoices[col], errors='coerce')

    # Detect columns
    customer_candidates = ['customer_name', 'customer', 'omc_id']
    customer_col = next((c for c in customer_candidates if c in dispatches.columns), None)
    if customer_col is None:
        raise ValueError("❌ No customer column found in Dispatches")

    value_candidates = ['value_kes', 'total_value', 'value']
    value_col = next((c for c in value_candidates if c in dispatches.columns), None)
    if value_col is None:
        raise ValueError("❌ No value column found in Dispatches")

    logger.info(f"👤 Customer column: '{customer_col}' | 💰 Value column: '{value_col}'")

    # Data quality
    quality_report = calculate_data_quality(dispatches, customer_col, value_col)
    logger.info(f"📊 Data quality score: {quality_report.quality_score}%")

    # Merge Dispatches → Invoices
    merged = dispatches.merge(
        invoices,
        on='dispatch_id',
        how='left',
        suffixes=('_disp', '_inv')
    )

    # Aggregate Payments
    if 'total_paid_kes' in payments.columns:
        payments_agg = payments
    else:
        if 'invoice_id' in payments.columns and 'value_kes' in payments.columns:
            payments_agg = payments.groupby('invoice_id').agg({
                'value_kes': 'sum',
                'payment_id': lambda x: ','.join(x) if hasattr(x, 'unique') else ','.join(x)
            }).reset_index()
            payments_agg.rename(columns={'value_kes': 'total_paid_kes'}, inplace=True)
        else:
            payments_agg = pd.DataFrame(columns=['invoice_id', 'total_paid_kes'])

    # Merge with payments
    if 'invoice_id' in merged.columns and 'invoice_id' in payments_agg.columns:
        merged = merged.merge(
            payments_agg[['invoice_id', 'total_paid_kes']],
            on='invoice_id',
            how='left'
        )
    else:
        merged['total_paid_kes'] = 0

    merged['total_paid_kes'] = merged['total_paid_kes'].fillna(0)

    # Financial columns
    disp_val_col = f'{value_col}_disp' if f'{value_col}_disp' in merged.columns else value_col
    inv_val_col = f'{value_col}_inv' if f'{value_col}_inv' in merged.columns else value_col

    merged['dispatched_kes'] = merged[disp_val_col].fillna(0)
    merged['invoiced_kes'] = merged[inv_val_col].fillna(0)
    merged['paid_kes'] = merged['total_paid_kes'].fillna(0)

    # Detect breaks
    merged['invoice_missing'] = merged['invoice_id'].isna()
    merged['diff_kes'] = merged['invoiced_kes'] - merged['paid_kes']
    merged['diff_abs'] = merged['diff_kes'].abs()

    conditions = [
        merged['invoice_missing'],
        (merged['paid_kes'] == 0) & (~merged['invoice_missing']),
        (merged['diff_kes'] > UNDERPAYMENT_THRESHOLD),
        (merged['diff_kes'] < -UNDERPAYMENT_THRESHOLD)
    ]
    choices = ['Missing Invoice', 'Missing Payment', 'Underpayment', 'Overpayment']
    merged['break_type'] = np.select(conditions, choices, default='Reconciled')

    # Leakage
    merged['leakage_kes'] = 0
    merged.loc[merged['break_type'] == 'Missing Invoice', 'leakage_kes'] = merged['dispatched_kes']
    merged.loc[merged['break_type'] == 'Missing Payment', 'leakage_kes'] = merged['invoiced_kes']
    merged.loc[merged['break_type'] == 'Underpayment', 'leakage_kes'] = merged['diff_kes']
    merged.loc[merged['break_type'] == 'Overpayment', 'leakage_kes'] = merged['diff_abs']

    # Age (NaN-safe)
    today = datetime.now()
    if 'date_disp' in merged.columns:
        merged['age_days'] = (today - pd.to_datetime(merged['date_disp'])).dt.days
        merged['age_days'] = merged['age_days'].fillna(0)
    else:
        merged['age_days'] = 0

    # Status
    merged['status'] = 'Reconciled'
    merged.loc[merged['break_type'].isin(['Missing Invoice', 'Missing Payment']), 'status'] = 'Critical'
    merged.loc[(merged['break_type'] == 'Underpayment') & (merged['age_days'] > CRITICAL_AGE_DAYS), 'status'] = 'Critical'
    merged.loc[(merged['break_type'] == 'Underpayment') & (merged['age_days'] <= CRITICAL_AGE_DAYS), 'status'] = 'Pending'
    merged.loc[merged['break_type'] == 'Overpayment', 'status'] = 'Review Required'

    # Filter anomalies
    anomalies_df = merged[merged['break_type'] != 'Reconciled'].copy()
    logger.info(f"🚨 Found {len(anomalies_df)} anomalies")

    if materiality > 0:
        anomalies_df = anomalies_df[anomalies_df['leakage_kes'] >= materiality]
        logger.info(f"🎯 Filtered by materiality (≥{materiality} KSh): {len(anomalies_df)} remaining")

    # Metrics
    total_disp = int(merged['dispatched_kes'].sum())
    total_inv = int(merged['invoiced_kes'].sum())
    total_pay = int(merged['paid_kes'].sum())
    total_leak = int(anomalies_df['leakage_kes'].sum()) if not anomalies_df.empty else 0

    missing_invoice_leak = int(anomalies_df[anomalies_df['break_type'] == 'Missing Invoice']['leakage_kes'].sum()) if not anomalies_df.empty else 0
    missing_payment_leak = int(anomalies_df[anomalies_df['break_type'] == 'Missing Payment']['leakage_kes'].sum()) if not anomalies_df.empty else 0
    underpayment_leak = int(anomalies_df[anomalies_df['break_type'] == 'Underpayment']['leakage_kes'].sum()) if not anomalies_df.empty else 0
    overpayment_leak = int(anomalies_df[anomalies_df['break_type'] == 'Overpayment']['leakage_kes'].sum()) if not anomalies_df.empty else 0

    rec_rate = round((1 - (total_leak / total_disp if total_disp > 0 else 0)) * 100, 2)

    metrics = {
        'total_dispatched_kes': total_disp,
        'total_invoiced_kes': total_inv,
        'total_paid_kes': total_pay,
        'total_leakage_kes': total_leak,
        'reconciliation_rate': rec_rate,
        'missing_invoice_leak': missing_invoice_leak,
        'missing_payment_leak': missing_payment_leak,
        'underpayment_leak': underpayment_leak,
        'overpayment_leak': overpayment_leak,
        'anomaly_count': len(anomalies_df),
        'critical_count': len(anomalies_df[anomalies_df['status'] == 'Critical']),
        'pending_count': len(anomalies_df[anomalies_df['status'] == 'Pending']),
        'review_count': len(anomalies_df[anomalies_df['status'] == 'Review Required'])
    }

    # Load persisted resolution overlay (app/models/anomaly_resolution.py).
    # This never changes what counts as an anomaly or its computed
    # break_type/status — it's purely an annotation layer added on top, so
    # a dispatch flagged "Resolved" still reappears here every run (the
    # underlying dispatch/invoice/payment data hasn't changed), just now
    # carrying its resolution info. Missing table (e.g. migration not yet
    # applied) degrades to "no resolutions" rather than failing the whole
    # reconciliation run.
    resolutions = {}
    try:
        resolutions_df = pd.read_sql(
            "SELECT dispatch_id, status, notes, updated_at FROM anomaly_resolutions",
            get_engine()
        )
        resolutions = {
            row['dispatch_id']: row for row in resolutions_df.to_dict(orient='records')
        }
    except Exception as e:
        logger.warning(f"⚠️ Could not load anomaly_resolutions overlay (table may not exist yet): {e}")

    # Build anomalies
    anomalies = []
    if not anomalies_df.empty:
        merged_customer_candidates = [
            'customer_name', 'customer', 'omc_id',
            'customer_name_disp', 'customer_name_inv',
            'customer_disp', 'customer_inv'
        ]
        merged_customer_col = next((c for c in merged_customer_candidates if c in anomalies_df.columns), None)
        if merged_customer_col is None:
            for col in anomalies_df.columns:
                if 'customer' in col.lower() or 'omc' in col.lower() or 'name' in col.lower():
                    merged_customer_col = col
                    break
        if merged_customer_col is None:
            merged_customer_col = anomalies_df.columns[0]
            logger.warning(f"⚠️ No customer column found! Using '{merged_customer_col}' as fallback.")

        product_col = next((c for c in ['product', 'product_disp', 'product_inv'] if c in anomalies_df.columns), 'Unknown')
        if product_col == 'Unknown':
            for col in anomalies_df.columns:
                if 'product' in col.lower():
                    product_col = col
                    break

        for _, row in anomalies_df.iterrows():
            age_val = row['age_days']
            if pd.isna(age_val):
                age_val = 0

            if 'date_disp' in row and pd.notna(row['date_disp']):
                created_at = row['date_disp'].strftime('%Y-%m-%d %H:%M:%S')
            else:
                created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

            resolution = resolutions.get(row['dispatch_id'])

            anomalies.append({
                'dispatch_id': row['dispatch_id'],
                'invoice_id': row['invoice_id'] if not pd.isna(row['invoice_id']) else None,
                'customer': row[merged_customer_col],
                'product': row[product_col],
                'dispatched_kes': int(row['dispatched_kes']),
                'invoiced_kes': int(row['invoiced_kes']),
                'paid_kes': int(row['paid_kes']),
                'leakage_kes': int(row['leakage_kes']),
                'break_type': row['break_type'],
                'status': row['status'],
                'ebilling_status': 'Pending',
                'ebilling_sync_date': None,
                'age_days': int(age_val),
                'created_at': created_at,
                'resolution_status': resolution['status'] if resolution else None,
                'resolution_notes': resolution['notes'] if resolution else None,
                'resolution_updated_at': (
                    pd.to_datetime(resolution['updated_at']).strftime('%Y-%m-%d %H:%M:%S')
                    if resolution and pd.notna(resolution['updated_at']) else None
                )
            })

    anomalies = sorted(anomalies, key=lambda x: x['leakage_kes'], reverse=True)

    # Duplicates
    duplicate_anomalies = []
    if 'invoice_id' in invoices.columns:
        dup_invoices = detect_duplicates(invoices, 'invoice_id', 'Invoice')
        duplicate_anomalies.extend(dup_invoices)
    if 'dispatch_id' in dispatches.columns:
        dup_dispatches = detect_duplicates(dispatches, 'dispatch_id', 'Dispatch')
        duplicate_anomalies.extend(dup_dispatches)

    omc_risk_profile = calculate_omc_risk(pd.DataFrame(anomalies) if anomalies else pd.DataFrame())

    # Performance
    elapsed_time = round(time.time() - start_time, 2)
    performance = {
        'processing_time_seconds': elapsed_time,
        'rows_processed': len(merged),
        'rows_per_second': round(len(merged) / elapsed_time, 2) if elapsed_time > 0 else 0
    }

    result = {
        'metrics': metrics,
        'anomalies': anomalies,
        'summary': {
            'total_anomalies': metrics['anomaly_count'],
            'total_leakage_kes': metrics['total_leakage_kes'],
            'reconciliation_rate': metrics['reconciliation_rate'],
            'critical_count': metrics['critical_count'],
            'pending_count': metrics['pending_count'],
            'review_count': metrics['review_count']
        },
        'performance': performance,
        'data_quality': {
            'total_rows': quality_report.total_rows,
            'null_volume': quality_report.null_volume,
            'null_value': quality_report.null_value,
            'zero_volume': quality_report.zero_volume,
            'zero_value': quality_report.zero_value,
            'invalid_customer': quality_report.invalid_customer,
            'quality_score': quality_report.quality_score
        },
        'ebilling_status': {
            'system': 'KRA iCMS (Simulated)',
            'connected': True,
            'total_pending': metrics['pending_count'],
            'total_synced': 0,
            'last_sync': None
        },
        'duplicate_anomalies': duplicate_anomalies,
        'omc_risk_profile': omc_risk_profile
    }

    # ---- JSON SANITIZER ----
    return clean_json_values(result)

# =============================================================================
# DATABASE WRAPPER
# =============================================================================

def run_reconciliation(materiality: float = MATERIALITY_THRESHOLD) -> Dict:
    try:
        # --- Old SQLite-only connection (kept for reference) ---
        # conn = sqlite3.connect(DB_PATH)
        # dispatches = pd.read_sql("SELECT * FROM dispatches", conn)
        # invoices = pd.read_sql("SELECT * FROM invoices", conn)
        # payments = pd.read_sql("SELECT * FROM payments", conn)
        # conn.close()

        engine = get_engine()
        dispatches = pd.read_sql("SELECT * FROM dispatches", engine)
        invoices = pd.read_sql("SELECT * FROM invoices", engine)
        payments = pd.read_sql("SELECT * FROM payments", engine)
        logger.info(f"📥 Loaded {len(dispatches)} dispatches, {len(invoices)} invoices, {len(payments)} payments from DB")
        return run_reconciliation_on_dataframes(dispatches, invoices, payments, materiality)
    except Exception as e:
        logger.error(f"❌ DB reconciliation failed: {e}")
        raise