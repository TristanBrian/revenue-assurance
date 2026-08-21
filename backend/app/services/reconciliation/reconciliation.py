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
import os
from datetime import datetime
import numpy as np
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass
import time
from collections import Counter
import math
import traceback

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
    Also converts pandas Categorical to string.
    """
    import pandas as pd
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
    elif isinstance(obj, pd.Categorical):
        # Convert to list of strings
        return [str(x) for x in obj]
    elif isinstance(obj, pd.Series):
        # Convert to list (should not happen, but safe)
        return clean_json_values(obj.tolist())
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


MAX_DUPLICATE_DETAILS = 100


def detect_duplicates(df: pd.DataFrame, column: str, label: str) -> List[Dict]:
    if column not in df.columns:
        return []
    dupes = df[df.duplicated(subset=[column], keep=False)]
    if dupes.empty:
        return []
    # 'details' is capped, not the full duplicate set: on this dataset a single
    # noisy column can mark 17,000+ rows as "duplicated", and dumping every one
    # of them (full row, every column) turned a <1KB metrics response into a
    # 3.2MB one — nothing in the frontend renders this list at all, it's a
    # sample for the Excel export's "Duplicates" sheet. duplicate_count still
    # reports the true total; only the row sample is bounded.
    return [{
        'type': 'Duplicate Detection',
        'column': column,
        'label': label,
        'duplicate_count': len(dupes),
        'details': dupes.head(MAX_DUPLICATE_DETAILS).to_dict(orient='records')
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
    # Convert categorical to string to avoid serialization issues
    omc_stats['risk_level'] = omc_stats['risk_level'].astype(str)
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

    try:
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

        # Load persisted resolution overlay
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
            logger.warning(f"⚠️ Could not load anomaly_resolutions overlay: {e}")

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

    except Exception as e:
        logger.error(f"❌ Reconciliation failed at line {traceback.extract_tb(e.__traceback__)[-1].lineno}: {e}")
        logger.error(traceback.format_exc())
        raise

# =============================================================================
# DATABASE WRAPPER
# =============================================================================

def run_reconciliation(materiality: float = MATERIALITY_THRESHOLD) -> Dict:
    try:
        engine = get_engine()
        dispatches = pd.read_sql("SELECT * FROM dispatches", engine)
        invoices = pd.read_sql("SELECT * FROM invoices", engine)
        payments = pd.read_sql("SELECT * FROM payments", engine)
        logger.info(f"📥 Loaded {len(dispatches)} dispatches, {len(invoices)} invoices, {len(payments)} payments from DB")
        result = run_reconciliation_on_dataframes(dispatches, invoices, payments, materiality)
        for a in result.get('anomalies', []):
            a['flow_direction'] = 'inbound'
        _score_anomalies_for_fraud(result.get('anomalies', []), direction='inbound', engine=engine,
                                    dispatches=dispatches, invoices=invoices)
        return result
    except Exception as e:
        logger.error(f"❌ DB reconciliation failed: {e}")
        raise


def _score_anomalies_for_fraud(anomalies: list, *, direction: str, engine, **table_kwargs) -> None:
    """
    Enriches `anomalies` in place with fraud_score/fraud_tier — best-
    effort and non-fatal: the fraud scoring layer is an enrichment on top
    of the reconciliation engine (see the fraud-scoring spec's guiding
    principle — it scores on top of existing anomalies, it doesn't
    replace or gate them), so any failure here (no trained model yet, a
    transient feature-building error, ...) must never break reconciliation
    itself. Sets fraud_score/fraud_tier to None on any failure rather than
    omitting the keys, so the Anomaly schema's Optional fields always come
    back consistently shaped either way.

    Imported lazily (inside the function, not at module top) to keep
    services/fraud/* an optional, layered-on-top dependency of
    reconciliation.py rather than a hard one — reconciliation.py works
    identically with fraud scoring uninstalled/misconfigured.
    """
    if not anomalies:
        return
    try:
        from app.services.fraud import fraud_scoring_service, feature_builder

        if direction == 'outbound':
            context = feature_builder.gather_outbound_context(
                table_kwargs['attendance'], table_kwargs['authorizations'], table_kwargs['disbursements']
            )
        else:
            context = feature_builder.gather_inbound_context(
                table_kwargs['dispatches'], table_kwargs['invoices'], engine
            )
        fraud_scoring_service.score_anomalies(
            anomalies,
            direction=direction,
            duplicate_ids=context['duplicate_ids'],
            value_delta_zscore_by_actor=context['value_delta_zscore_by_actor'],
        )
    except Exception as exc:
        logger.error(f"Fraud scoring failed (non-fatal — reconciliation result is unaffected): {exc}")
        for a in anomalies:
            a.setdefault('fraud_score', None)
            a.setdefault('fraud_tier', None)


# =============================================================================
# OUTBOUND (STIPEND/DISBURSEMENT) RECONCILIATION — Inuka Foundation, Stage 2
# =============================================================================
# Mirrors the inbound engine above entity-for-entity:
#   Dispatch -> Attendance   Invoice -> Stipend Authorization   Payment -> Disbursement
#
# There is no persisted Anomaly table for either direction — anomalies are
# computed dicts, not DB rows (see run_reconciliation_on_dataframes's own
# docstring/callers). flow_direction is therefore a DICT KEY set at
# creation time here, not a schema/migration change, and the outbound
# anomaly dicts below deliberately reuse the same field names the inbound
# ones use (dispatch_id/invoice_id/customer/product) rather than
# introducing a parallel shape — see the field-by-field mapping comment
# next to _build_outbound_anomaly() for what each one actually holds here.
# This is what lets AnomalyTable, the heatmap, the fraud graph, and the
# Excel export all keep working unchanged for both directions (extend,
# don't fork — see the Stage 2 spec's guiding principle).
#
# Severity rules differ from inbound on purpose (Stage 2 spec, section 1):
# Missing Authorization / Missing Disbursement / Underpayment scale with
# materiality exactly like inbound does. Overpayment, Duplicate
# Disbursement, and Ghost Payment are critical BY DEFAULT regardless of
# amount — each is exempted from the materiality filter explicitly below,
# not just given a high severity label that materiality would otherwise
# still filter out.

GHOST_PAYMENT_LABEL = "Ghost Payment"
DUPLICATE_DISBURSEMENT_LABEL = "Duplicate Disbursement"

# break_types that are critical regardless of materiality/amount — used
# both for the status assignment and for the materiality-filter exemption.
_ALWAYS_CRITICAL_OUTBOUND_BREAKS = {"Overpayment", GHOST_PAYMENT_LABEL, DUPLICATE_DISBURSEMENT_LABEL}


def _build_outbound_anomaly(row: dict, resolutions: dict) -> dict:
    """
    One outbound anomaly dict, deliberately shaped like an inbound one so
    both flow through the same Anomaly schema/AnomalyTable/export sheet:
        dispatch_id  <- attendance_id      (the anomaly's own primary key,
                                             same role dispatch_id plays inbound)
        invoice_id   <- authorization_id   (nullable, same as inbound)
        customer     <- beneficiary_name (falls back to beneficiary_id)
        product      <- pillar_id
        dispatched_kes <- eligible_amount_kes (what attendance implied was owed)
        invoiced_kes   <- amount_authorized
        paid_kes       <- amount_disbursed
    Plus the one new field: flow_direction="outbound".
    """
    record_id = row.get('attendance_id') or row.get('disbursement_id')
    resolution = resolutions.get(record_id)
    return {
        'dispatch_id': record_id,
        'invoice_id': row.get('authorization_id'),
        'customer': row.get('beneficiary_name') or row.get('beneficiary_id'),
        'product': row.get('pillar_id'),
        'dispatched_kes': int(row.get('eligible_kes', 0) or 0),
        'invoiced_kes': int(row.get('authorized_kes', 0) or 0),
        'paid_kes': int(row.get('disbursed_kes', 0) or 0),
        'leakage_kes': int(row.get('leakage_kes', 0) or 0),
        'break_type': row['break_type'],
        'status': row['status'],
        'ebilling_status': 'N/A',  # outbound has no e-billing/KRA concept
        'ebilling_sync_date': None,
        'age_days': int(row.get('age_days', 0) or 0),
        'created_at': row.get('created_at'),
        'resolution_status': resolution['status'] if resolution else None,
        'resolution_notes': resolution['notes'] if resolution else None,
        'resolution_updated_at': (
            pd.to_datetime(resolution['updated_at']).strftime('%Y-%m-%d %H:%M:%S')
            if resolution and pd.notna(resolution['updated_at']) else None
        ),
        'flow_direction': 'outbound',
        'officer_id': row.get('officer_id'),
        'beneficiary_id': row.get('beneficiary_id'),
    }


def run_outbound_reconciliation_on_dataframes(
    attendance_df: pd.DataFrame,
    authorizations_df: pd.DataFrame,
    disbursements_df: pd.DataFrame,
    materiality: float = MATERIALITY_THRESHOLD,
    beneficiaries_df: Optional[pd.DataFrame] = None,
) -> Dict:
    start_time = time.time()
    logger.info("🚀 Starting outbound (stipend/disbursement) reconciliation on DataFrames...")

    try:
        attendance = attendance_df.copy()
        authorizations = authorizations_df.copy()
        disbursements = disbursements_df.copy()

        # beneficiary_name lives only on the beneficiaries master table —
        # neither attendance nor authorizations carry it (mirroring how
        # dispatches carries customer_name directly and never needs an
        # OMC-name lookup) — optional param so the pure-function/unit-test
        # signature still works without a beneficiaries table on hand;
        # falls back to showing beneficiary_id as `customer` if omitted,
        # same fallback style as inbound's own customer-column search.
        if beneficiaries_df is not None and {'beneficiary_id', 'beneficiary_name'}.issubset(beneficiaries_df.columns):
            name_lookup = beneficiaries_df[['beneficiary_id', 'beneficiary_name']].drop_duplicates('beneficiary_id')
            attendance = attendance.merge(name_lookup, on='beneficiary_id', how='left')

        for col in ['attendance_date']:
            if col in attendance.columns:
                attendance[col] = pd.to_datetime(attendance[col], errors='coerce')

        quality_report = calculate_data_quality(attendance, 'beneficiary_id', 'eligible_amount_kes')
        logger.info(f"📊 Outbound data quality score: {quality_report.quality_score}%")

        # Attendance -> Authorization (mirrors dispatches.merge(invoices))
        merged = attendance.merge(
            authorizations, on='attendance_id', how='left', suffixes=('_att', '_auth')
        )

        # beneficiary_id/pillar_id/period exist on BOTH attendance and
        # authorizations (by design — stipend_authorizations carries them
        # too, mirroring how invoices repeats customer_name/product from
        # dispatches), so the merge above suffixed all three instead of
        # colliding — same situation inbound resolves via its
        # merged_customer_candidates fallback list. Coalesced explicitly
        # here instead: prefer the attendance side (authoritative for who/
        # what this row is about — an authorization can't exist without an
        # attendance row, but the reverse isn't true), falling back to the
        # authorization side only where attendance-side is missing.
        for col in ['beneficiary_id', 'pillar_id', 'period']:
            att_col, auth_col = f'{col}_att', f'{col}_auth'
            if att_col in merged.columns and auth_col in merged.columns:
                merged[col] = merged[att_col].combine_first(merged[auth_col])
            elif att_col in merged.columns:
                merged[col] = merged[att_col]
            elif auth_col in merged.columns:
                merged[col] = merged[auth_col]
            # else: no collision happened (e.g. single-row edge cases) — col already unsuffixed

        # Aggregate Disbursements by authorization_id (mirrors payments
        # aggregated by invoice_id) — dropna=True so ghost-payment rows
        # (authorization_id is NaN) never enter this aggregation; they're
        # handled entirely separately below, never via this join, since a
        # left-join starting FROM attendance can only ever find
        # disbursements that DO trace back to a real authorization.
        if 'authorization_id' in disbursements.columns and 'amount_paid' in disbursements.columns:
            disb_agg = disbursements.dropna(subset=['authorization_id']).groupby(
                'authorization_id'
            ).agg(total_disbursed_kes=('amount_paid', 'sum')).reset_index()
        else:
            disb_agg = pd.DataFrame(columns=['authorization_id', 'total_disbursed_kes'])

        if 'authorization_id' in merged.columns:
            merged = merged.merge(disb_agg, on='authorization_id', how='left')
        else:
            merged['total_disbursed_kes'] = 0
        merged['total_disbursed_kes'] = merged['total_disbursed_kes'].fillna(0)

        merged['eligible_kes'] = merged.get('eligible_amount_kes', 0)
        merged['eligible_kes'] = merged['eligible_kes'].fillna(0) if 'eligible_kes' in merged else 0
        merged['authorized_kes'] = merged.get('amount_authorized', 0)
        merged['authorized_kes'] = merged['authorized_kes'].fillna(0) if 'authorized_kes' in merged else 0
        merged['disbursed_kes'] = merged['total_disbursed_kes'].fillna(0)

        merged['authorization_missing'] = merged['authorization_id'].isna()
        merged['diff_kes'] = merged['authorized_kes'] - merged['disbursed_kes']
        merged['diff_abs'] = merged['diff_kes'].abs()

        conditions = [
            merged['authorization_missing'],
            (merged['disbursed_kes'] == 0) & (~merged['authorization_missing']),
            (merged['diff_kes'] > UNDERPAYMENT_THRESHOLD),
            (merged['diff_kes'] < -UNDERPAYMENT_THRESHOLD),
        ]
        choices = ['Missing Authorization', 'Missing Disbursement', 'Underpayment', 'Overpayment']
        merged['break_type'] = np.select(conditions, choices, default='Reconciled')

        merged['leakage_kes'] = 0
        merged.loc[merged['break_type'] == 'Missing Authorization', 'leakage_kes'] = merged['eligible_kes']
        merged.loc[merged['break_type'] == 'Missing Disbursement', 'leakage_kes'] = merged['authorized_kes']
        merged.loc[merged['break_type'] == 'Underpayment', 'leakage_kes'] = merged['diff_kes']
        merged.loc[merged['break_type'] == 'Overpayment', 'leakage_kes'] = merged['diff_abs']

        today = datetime.now()
        if 'attendance_date' in merged.columns:
            merged['age_days'] = (today - merged['attendance_date']).dt.days
            merged['age_days'] = merged['age_days'].fillna(0)
        else:
            merged['age_days'] = 0

        # Severity: Missing Authorization/Missing Disbursement critical
        # like inbound; Underpayment ages in like inbound; Overpayment is
        # ALWAYS critical here (not amount- or age-gated) — see section 1
        # of the Stage 2 spec, this is the one place severity genuinely
        # diverges from just reusing the inbound thresholds.
        merged['status'] = 'Reconciled'
        merged.loc[merged['break_type'].isin(['Missing Authorization', 'Missing Disbursement']), 'status'] = 'Critical'
        merged.loc[(merged['break_type'] == 'Underpayment') & (merged['age_days'] > CRITICAL_AGE_DAYS), 'status'] = 'Critical'
        merged.loc[(merged['break_type'] == 'Underpayment') & (merged['age_days'] <= CRITICAL_AGE_DAYS), 'status'] = 'Pending'
        merged.loc[merged['break_type'] == 'Overpayment', 'status'] = 'Critical'

        chain_anomalies_df = merged[merged['break_type'] != 'Reconciled'].copy()
        logger.info(f"🚨 Found {len(chain_anomalies_df)} outbound chain anomalies (authorization/disbursement)")

        if 'created_at' not in chain_anomalies_df.columns:
            if 'attendance_date' in chain_anomalies_df.columns:
                chain_anomalies_df['created_at'] = chain_anomalies_df['attendance_date'].dt.strftime('%Y-%m-%d %H:%M:%S')
            else:
                chain_anomalies_df['created_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        chain_anomalies_df['created_at'] = chain_anomalies_df['created_at'].fillna(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

        # --- GHOST PAYMENTS --- disbursements with no matching authorization
        # at all (authorization_id null, or non-null but not present in the
        # authorizations table — ETL's Gate D already quarantines the
        # latter as a data-quality defect before this ever runs, so in
        # practice this is just the null-FK rows, but the isin() check
        # below covers both cases defensively rather than assuming that).
        valid_auth_ids = (
            set(authorizations['authorization_id'].dropna().unique())
            if 'authorization_id' in authorizations.columns else set()
        )
        if 'authorization_id' in disbursements.columns:
            ghost_mask = disbursements['authorization_id'].isna() | ~disbursements['authorization_id'].isin(valid_auth_ids)
        else:
            ghost_mask = pd.Series([False] * len(disbursements))
        ghost_df = disbursements[ghost_mask].copy()
        logger.info(f"👻 Found {len(ghost_df)} ghost payments (disbursement with no valid authorization)")

        # --- DUPLICATE DISBURSEMENTS --- same beneficiary, same period,
        # paid twice. Composite key + the existing detect_duplicates() —
        # reused as-is, not reimplemented, per the Stage 2 spec.
        duplicate_disbursement_df = pd.DataFrame()
        if {'beneficiary_id', 'period'}.issubset(disbursements.columns):
            disbursements['_beneficiary_period_key'] = (
                disbursements['beneficiary_id'].astype(str) + '_' + disbursements['period'].astype(str)
            )
            dup_detail = detect_duplicates(disbursements, '_beneficiary_period_key', 'Disbursement (beneficiary+period)')
            if dup_detail:
                # detect_duplicates() caps `details` at MAX_DUPLICATE_DETAILS for
                # the sidebar/export use case — re-derive the full set here from
                # the same duplicated-mask logic so every duplicate becomes its
                # own critical anomaly, not just the first 100.
                dup_mask = disbursements.duplicated(subset=['_beneficiary_period_key'], keep=False)
                duplicate_disbursement_df = disbursements[dup_mask].copy()

        # --- Assemble all outbound anomalies (chain + ghost + duplicate) ---
        resolutions = {}
        try:
            resolutions_df = pd.read_sql(
                "SELECT dispatch_id, status, notes, updated_at FROM anomaly_resolutions",
                get_engine()
            )
            resolutions = {row['dispatch_id']: row for row in resolutions_df.to_dict(orient='records')}
        except Exception as e:
            logger.warning(f"⚠️ Could not load anomaly_resolutions overlay: {e}")

        anomalies = [_build_outbound_anomaly(row, resolutions) for row in chain_anomalies_df.to_dict(orient='records')]

        for row in ghost_df.to_dict(orient='records'):
            anomalies.append(_build_outbound_anomaly({
                'attendance_id': None,
                'disbursement_id': row.get('disbursement_id'),
                'authorization_id': None,
                'beneficiary_id': row.get('beneficiary_id'),
                'officer_id': None,
                'pillar_id': row.get('pillar_id'),
                'eligible_kes': 0,
                'authorized_kes': 0,
                'disbursed_kes': row.get('amount_paid', 0),
                'leakage_kes': row.get('amount_paid', 0),
                'break_type': GHOST_PAYMENT_LABEL,
                'status': 'Critical',
                'age_days': 0,
                'created_at': row.get('date'),
            }, resolutions))

        for row in duplicate_disbursement_df.to_dict(orient='records'):
            anomalies.append(_build_outbound_anomaly({
                'attendance_id': None,
                'disbursement_id': row.get('disbursement_id'),
                'authorization_id': row.get('authorization_id'),
                'beneficiary_id': row.get('beneficiary_id'),
                'officer_id': None,
                'pillar_id': row.get('pillar_id'),
                'eligible_kes': 0,
                'authorized_kes': 0,
                'disbursed_kes': row.get('amount_paid', 0),
                'leakage_kes': row.get('amount_paid', 0),
                'break_type': DUPLICATE_DISBURSEMENT_LABEL,
                'status': 'Critical',
                'age_days': 0,
                'created_at': row.get('date'),
            }, resolutions))

        # Materiality filter — exempts the always-critical categories
        # entirely, per section 1 of the spec ("critical by default,
        # regardless of amount"), not just given a high status label that
        # the filter would otherwise still drop below materiality.
        if materiality > 0:
            anomalies = [
                a for a in anomalies
                if a['break_type'] in _ALWAYS_CRITICAL_OUTBOUND_BREAKS or a['leakage_kes'] >= materiality
            ]

        anomalies = sorted(anomalies, key=lambda x: x['leakage_kes'], reverse=True)

        total_eligible = int(merged['eligible_kes'].sum())
        total_authorized = int(merged['authorized_kes'].sum())
        total_disbursed = int(merged['disbursed_kes'].sum()) + int(ghost_df.get('amount_paid', pd.Series(dtype=float)).sum())
        total_leak = int(sum(a['leakage_kes'] for a in anomalies))

        missing_auth_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == 'Missing Authorization'))
        missing_disb_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == 'Missing Disbursement'))
        underpayment_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == 'Underpayment'))
        overpayment_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == 'Overpayment'))
        ghost_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == GHOST_PAYMENT_LABEL))
        duplicate_leak = int(sum(a['leakage_kes'] for a in anomalies if a['break_type'] == DUPLICATE_DISBURSEMENT_LABEL))

        rec_rate = round((1 - (total_leak / total_eligible if total_eligible > 0 else 0)) * 100, 2)

        metrics = {
            'total_dispatched_kes': total_eligible,
            'total_invoiced_kes': total_authorized,
            'total_paid_kes': total_disbursed,
            'total_leakage_kes': total_leak,
            'reconciliation_rate': rec_rate,
            'missing_invoice_leak': missing_auth_leak,
            'missing_payment_leak': missing_disb_leak,
            'underpayment_leak': underpayment_leak,
            'overpayment_leak': overpayment_leak,
            'ghost_payment_leak': ghost_leak,
            'duplicate_disbursement_leak': duplicate_leak,
            'anomaly_count': len(anomalies),
            'critical_count': sum(1 for a in anomalies if a['status'] == 'Critical'),
            'pending_count': sum(1 for a in anomalies if a['status'] == 'Pending'),
            'review_count': sum(1 for a in anomalies if a['status'] == 'Review Required'),
        }

        duplicate_anomalies = []
        dup_auth = detect_duplicates(authorizations, 'authorization_id', 'Stipend Authorization') if 'authorization_id' in authorizations.columns else []
        duplicate_anomalies.extend(dup_auth)
        dup_att = detect_duplicates(attendance, 'attendance_id', 'Attendance') if 'attendance_id' in attendance.columns else []
        duplicate_anomalies.extend(dup_att)

        beneficiary_risk_profile = calculate_omc_risk(pd.DataFrame(anomalies) if anomalies else pd.DataFrame())

        elapsed_time = round(time.time() - start_time, 2)
        performance = {
            'processing_time_seconds': elapsed_time,
            'rows_processed': len(merged) + len(ghost_df),
            'rows_per_second': round((len(merged) + len(ghost_df)) / elapsed_time, 2) if elapsed_time > 0 else 0,
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
                'review_count': metrics['review_count'],
            },
            'performance': performance,
            'data_quality': {
                'total_rows': quality_report.total_rows,
                'null_volume': quality_report.null_volume,
                'null_value': quality_report.null_value,
                'zero_volume': quality_report.zero_volume,
                'zero_value': quality_report.zero_value,
                'invalid_customer': quality_report.invalid_customer,
                'quality_score': quality_report.quality_score,
            },
            'ebilling_status': {
                'system': 'N/A (outbound has no e-billing/KRA concept)',
                'connected': False,
                'total_pending': 0,
                'total_synced': 0,
                'last_sync': None,
            },
            'duplicate_anomalies': duplicate_anomalies,
            'omc_risk_profile': beneficiary_risk_profile,
        }

        return clean_json_values(result)

    except Exception as e:
        logger.error(f"❌ Outbound reconciliation failed at line {traceback.extract_tb(e.__traceback__)[-1].lineno}: {e}")
        logger.error(traceback.format_exc())
        raise


def run_outbound_reconciliation(materiality: float = MATERIALITY_THRESHOLD) -> Dict:
    try:
        engine = get_engine()
        attendance = pd.read_sql("SELECT * FROM attendance", engine)
        authorizations = pd.read_sql("SELECT * FROM stipend_authorizations", engine)
        disbursements = pd.read_sql("SELECT * FROM disbursements", engine)
        try:
            beneficiaries = pd.read_sql("SELECT beneficiary_id, beneficiary_name FROM beneficiaries", engine)
        except Exception as e:
            logger.warning(f"⚠️ Could not load beneficiaries for name enrichment (non-fatal): {e}")
            beneficiaries = None
        logger.info(
            f"📥 Loaded {len(attendance)} attendance, {len(authorizations)} authorizations, "
            f"{len(disbursements)} disbursements from DB"
        )
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality, beneficiaries_df=beneficiaries
        )
        _score_anomalies_for_fraud(result.get('anomalies', []), direction='outbound', engine=engine,
                                    attendance=attendance, authorizations=authorizations,
                                    disbursements=disbursements)
        return result
    except Exception as e:
        logger.error(f"❌ DB outbound reconciliation failed: {e}")
        raise


def run_combined_reconciliation(direction: str = "all", materiality: float = MATERIALITY_THRESHOLD) -> Dict:
    """
    Single entry point routes/reconciliation/reconcile.py calls, so the
    route layer doesn't need to know how to merge two result dicts itself.
    direction="inbound"/"outbound" delegates straight to the matching
    single-direction function (same shape as always). direction="all"
    (the default) runs BOTH and merges: anomalies concatenated (each
    already carries its own flow_direction), metrics/leak totals summed,
    counts summed, data_quality/performance averaged (both are already
    per-run diagnostics, not a total anyone needs precisely added), and
    duplicate_anomalies/omc_risk_profile concatenated.
    """
    if direction == "inbound":
        return run_reconciliation(materiality=materiality)
    if direction == "outbound":
        return run_outbound_reconciliation(materiality=materiality)

    inbound = run_reconciliation(materiality=materiality)
    outbound = run_outbound_reconciliation(materiality=materiality)

    merged_metrics = {}
    # Union of both dicts' keys, not just inbound's — outbound has two
    # keys inbound doesn't (ghost_payment_leak, duplicate_disbursement_leak).
    # Iterating inbound['metrics'] alone silently dropped both from every
    # direction="all" response (caught by
    # tests/test_outbound_reconciliation.py's
    # test_direction_all_merges_both_and_tags_flow_direction).
    for key in {**inbound['metrics'], **outbound['metrics']}:
        in_val = inbound['metrics'].get(key, 0)
        out_val = outbound['metrics'].get(key, 0)
        merged_metrics[key] = (in_val or 0) + (out_val or 0) if isinstance(in_val, (int, float)) or isinstance(out_val, (int, float)) else in_val
    # reconciliation_rate isn't additive — recompute from the summed totals instead.
    total_disp = merged_metrics.get('total_dispatched_kes', 0)
    merged_metrics['reconciliation_rate'] = round(
        (1 - (merged_metrics.get('total_leakage_kes', 0) / total_disp if total_disp > 0 else 0)) * 100, 2
    )

    return clean_json_values({
        'metrics': merged_metrics,
        'anomalies': inbound.get('anomalies', []) + outbound.get('anomalies', []),
        'summary': {
            'total_anomalies': inbound['summary']['total_anomalies'] + outbound['summary']['total_anomalies'],
            'total_leakage_kes': inbound['summary']['total_leakage_kes'] + outbound['summary']['total_leakage_kes'],
            'reconciliation_rate': merged_metrics['reconciliation_rate'],
            'critical_count': inbound['summary']['critical_count'] + outbound['summary']['critical_count'],
            'pending_count': inbound['summary']['pending_count'] + outbound['summary']['pending_count'],
            'review_count': inbound['summary']['review_count'] + outbound['summary']['review_count'],
        },
        'performance': inbound['performance'],
        'data_quality': inbound['data_quality'],
        'ebilling_status': inbound['ebilling_status'],
        'duplicate_anomalies': inbound.get('duplicate_anomalies', []) + outbound.get('duplicate_anomalies', []),
        'omc_risk_profile': inbound.get('omc_risk_profile', []) + outbound.get('omc_risk_profile', []),
    })