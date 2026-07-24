"""
KPC Revenue Assurance - Synthetic Data Generator (Order-to-Cash & Data Quality)
Generates end-to-end messy operational CSVs for KPC's revenue leakage hackathon.

Datasets Generated:
1. products.csv                - Product/fuel code master (PMS/AGO/DPK + non-fuel codes)
2. depots.csv                  - Depot master
3. omcs.csv                    - Master list of Oil Marketing Companies
4. tariffs.csv                 - Tariff Master with Effective Date Ranges (SCD Type 2)
5. depot_loading_logs.csv      - Physical Metering & Loading Bay Events at Gantries
6. dispatches.csv              - Commercial Dispatch & Waybill Records
7. invoices.csv                - Financial Invoices Issued to OMCs
8. payments.csv                - Remittance & Payment Transaction Records
9. depot_daily_inventory.csv   - Daily Physical Tank Dips vs. Book Balances
"""

import os
import random
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from faker import Faker

# --- REPRODUCIBILITY SEEDS ---
fake = Faker()
Faker.seed(42)
random.seed(42)
np.random.seed(42)

# --- GLOBAL CONFIGURATION & CONSTANTS ---
CONFIG = {
    "num_dispatches": 50000
}

# --- NEW: OMC RISK PROFILES ---
LEAKAGE_PROFILES = {
    "Good": { # 3 OMCs: Zero leakages (Perfect baseline)
        "unmetered_loading_leak": 0.00, "dispatch_loading_skew": 0.00,
        "invoice_leak": 0.00, "payment_leak": 0.00, "underpay_rate": 0.00,
        "installment_rate": 0.00, "tariff_error_rate": 0.00
    },
    "Small": { # 10 OMCs: Very minor, occasional errors
        "unmetered_loading_leak": 0.01, "dispatch_loading_skew": 0.02,
        "invoice_leak": 0.02, "payment_leak": 0.01, "underpay_rate": 0.05,
        "installment_rate": 0.10, "tariff_error_rate": 0.01
    },
    "Medium": { # 4 OMCs: Standard operational messiness
        "unmetered_loading_leak": 0.05, "dispatch_loading_skew": 0.08,
        "invoice_leak": 0.08, "payment_leak": 0.05, "underpay_rate": 0.20,
        "installment_rate": 0.30, "tariff_error_rate": 0.05
    },
    "High": { # 3 OMCs: Massive leakages & targeted for fraud ring
        "unmetered_loading_leak": 0.15, "dispatch_loading_skew": 0.20,
        "invoice_leak": 0.20, "payment_leak": 0.15, "underpay_rate": 0.40,
        "installment_rate": 0.50, "tariff_error_rate": 0.15
    }
}

DEPOT_DISTANCES_KM = {
    "Mombasa (KOSF)": 10,
    "Mombasa (Kipevu)": 5,
    "Nairobi": 450,
    "Kisumu": 650,
    "Eldoret": 700,
}

OMC_NAMES = [
    "TotalEnergies Kenya", "Vivo Energy", "Rubis Energy", "Gulf Energy",
    "PetroOil Kenya", "Hashi Energy", "Kobil", "National Oil",
    "Dalbit Petroleum", "Tamoil", "Hass Petroleum", "Galana Energies",
    "Lake Oil", "Texol Energies", "Mombasa Petroleum", "KPA Marine",
    "KAA Aviation", "Uganda National Oil", "Tanzania Petroleum", "Ethiopian Oil"
]

# Bare product codes — PMS/AGO/DPK are the official KPC/EPRA fuel codes
# (Premium Motor Spirit/Petrol, Automotive Gas Oil/Diesel, Dual Purpose
# Kerosene/Kerosene). JETA1/HFO/LPG/LUB aren't part of that official set but
# already exist in this generator (JETA1 and LPG are also the values used
# by inject_fraud_ring() below) — see PRODUCT_MASTER for the full name +
# price of each. Matches products.product_id in app/models/product.py.
# Used directly by generate_tariff_master()/generate_depot_inventory() below
# too, so keeping this as bare codes keeps tariffs/dispatches/inventory all
# consistent with products.csv without any extra mapping step.
PRODUCTS = ["PMS", "AGO", "DPK", "JETA1", "HFO", "LPG", "LUB"]

# Product master data: (product_id, product_name, unit_price_kes).
# Prices are illustrative placeholders for the 3 real fuel codes (Kenyan
# pump prices fluctuate under EPRA's monthly cap, this is not a live
# figure) — not used in any dispatch/invoice value calculation below, which
# is all tariff-based, not priced-per-litre. The other 4 have no
# established price basis in this dataset, so unit_price_kes is None.
PRODUCT_MASTER = [
    ("PMS", "Premium Motor Spirit (Petrol)", 182.00),
    ("AGO", "Automotive Gas Oil (Diesel)", 168.00),
    ("DPK", "Dual Purpose Kerosene (Kerosene)", 145.00),
    ("JETA1", "Jet A-1", None),
    ("HFO", "Heavy Fuel Oil", None),
    ("LPG", "Liquefied Petroleum Gas", None),
    ("LUB", "Lubricants", None),
]


def generate_product_master():
    return pd.DataFrame(
        [{'product_id': pid, 'product_name': name, 'unit_price_kes': price, 'is_active': True}
         for pid, name, price in PRODUCT_MASTER]
    )


def generate_depot_master():
    # depot_id reuses the DEPOT_DISTANCES_KM keys as-is (e.g. "Nairobi",
    # "Mombasa (KOSF)") — same natural-key treatment as products, matching
    # what dispatches/depot_loading_logs.depot already store.
    # capacity_litres is a placeholder (no real capacity data in this
    # dataset); location is left unset for the same reason.
    return pd.DataFrame(
        [{'depot_id': depot_id, 'depot_name': depot_id, 'location': None,
          'capacity_litres': random.randint(2000000, 8000000), 'is_active': True}
         for depot_id in DEPOT_DISTANCES_KM.keys()]
    )


# --- 1. GENERATE TARIFF MASTER (SCD TYPE 2) ---
def generate_tariff_master():
    """Generates tariff schedule with versioned rate changes over time."""
    tariffs = []
    # Rate Schedule 2025
    for product in PRODUCTS:
        for depot in DEPOT_DISTANCES_KM.keys():
            tariffs.append({
                'tariff_id': f"TRF-2025-{hash(product+depot)%10000:04d}",
                'product': product,
                'depot': depot,
                'pipeline_tariff_per_m3_km': 5.53,
                'storage_tariff_per_m3_day': 1000.00,
                'effective_start': '2025-01-01',
                'effective_end': '2025-12-31'
            })
    # Adjusted Rate Schedule 2026 (5% Tariff Revision)
    for product in PRODUCTS:
        for depot in DEPOT_DISTANCES_KM.keys():
            tariffs.append({
                'tariff_id': f"TRF-2026-{hash(product+depot)%10000:04d}",
                'product': product,
                'depot': depot,
                'pipeline_tariff_per_m3_km': round(5.53 * 1.05, 2),
                'storage_tariff_per_m3_day': round(1000.00 * 1.05, 2),
                'effective_start': '2026-01-01',
                'effective_end': '2026-12-31'
            })
    return pd.DataFrame(tariffs)


# --- 2. GENERATE OMC MASTER ---
def generate_omc_master():
    """Generates customer master records with specific risk tiers."""
    omcs = []
    
    # Exactly 20 profiles to match the 20 OMC_NAMES
    profiles = (["Good"] * 3) + (["Small"] * 10) + (["Medium"] * 4) + (["High"] * 3)
    random.shuffle(profiles)
    
    for idx, name in enumerate(OMC_NAMES, 1):
        omcs.append({
            'omc_id': f'OMC-{idx:03d}',
            'customer_name': name,
            'kra_pin': f"P{fake.random_number(9, True)}Z",
            'payment_terms_days': random.choice([15, 30, 45, 60]),
            'credit_limit_kes': random.randint(20000000, 80000000),
            'risk_rating': random.choices(['Low', 'Medium', 'High'], weights=[0.50, 0.35, 0.15])[0],
            'risk_profile': profiles[idx-1], # Assign the assigned risk tier
            'contact_email': fake.company_email(),
            'phone': fake.phone_number(),
            'is_active': True
        })
    return pd.DataFrame(omcs)


# --- 3. GENERATE DEPOT LOADING LOGS & DISPATCHES ---
def generate_loading_and_dispatches(omcs_df, tariffs_df):
    """Generates physical loading meter events and links them to commercial dispatches."""
    # Map OMC IDs to their assigned risk profile
    omc_profiles = dict(zip(omcs_df['omc_id'], omcs_df['risk_profile']))
    
    dispatches = []
    loading_logs = []
    start_date = datetime(2025, 1, 1)
    end_date = datetime(2026, 7, 1)

    for i in range(CONFIG["num_dispatches"]):
        omc = omcs_df.sample(1).iloc[0]
        profile = LEAKAGE_PROFILES[omc_profiles[omc['omc_id']]] # Fetch specific rules
        
        event_dt = start_date + timedelta(days=random.randint(0, (end_date - start_date).days),
                                         seconds=random.randint(0, 86400))
        date_str = event_dt.strftime('%Y-%m-%d')
        product = random.choice(PRODUCTS)
        depot = random.choice(list(DEPOT_DISTANCES_KM.keys()))
        dist_km = DEPOT_DISTANCES_KM[depot]

        # Determine applicable tariff based on event date
        tariff_match = tariffs_df[
            (tariffs_df['product'] == product) &
            (tariffs_df['depot'] == depot) &
            (tariffs_df['effective_start'] <= date_str) &
            (tariffs_df['effective_end'] >= date_str)
        ]

        p_rate = tariff_match['pipeline_tariff_per_m3_km'].values[0] if not tariff_match.empty else 5.53
        s_rate = tariff_match['storage_tariff_per_m3_day'].values[0] if not tariff_match.empty else 1000.00

        # Physical Meter Loading Volume
        physical_loaded_liters = round(random.uniform(20000, 60000), 0)
        loading_id = f"LOAD-{i+1:06d}"
        dispatch_id = f"DISP-{i+1:05d}"

        # Inject discrepancy between physical loading vs commercial dispatch log based on profile
        if random.random() < profile["dispatch_loading_skew"]:
            disp_vol = physical_loaded_liters * random.uniform(0.92, 0.98) # Under-recorded dispatch volume
        else:
            disp_vol = physical_loaded_liters

        # Calculate commercial tariffs based on recorded dispatch volume
        transport_fee = round((disp_vol / 1000) * p_rate * dist_km, 0)
        storage_fee = round((disp_vol / 1000) * s_rate, 0)
        total_val = transport_fee + storage_fee

        # Depot Gantry Physical Loading Log Entry
        loading_logs.append({
            'loading_id': loading_id,
            'gantry_bay_id': f"BAY-{random.randint(1, 12):02d}",
            'meter_id': f"MTR-{random.randint(100, 999)}",
            'dispatch_id': None if random.random() < profile["unmetered_loading_leak"] else dispatch_id,
            'omc_id': omc['omc_id'],
            'depot': depot,
            'product': product,
            'physical_loaded_liters': int(physical_loaded_liters),
            'temperature_c': round(random.uniform(20.0, 32.0), 1),
            'density_kg_m3': round(random.uniform(720.0, 850.0), 1),
            'loading_timestamp': event_dt.strftime('%Y-%m-%d %H:%M:%S')
        })

        # Dispatch Entry (Commercial Record)
        dispatches.append({
            'dispatch_id': dispatch_id,
            'loading_id': loading_id,
            'date': date_str,
            'year': event_dt.year,
            'month': event_dt.month,
            'omc_id': omc['omc_id'],
            'customer_name': omc['customer_name'],
            'product': product,
            'depot': depot,
            'volume_liters': int(disp_vol),
            'distance_km': dist_km,
            'transport_tariff_kes': int(transport_fee),
            'storage_tariff_kes': int(storage_fee),
            'value_kes': int(total_val)
        })

    return pd.DataFrame(loading_logs), pd.DataFrame(dispatches)


# --- 4. INJECT FRAUD PATTERNS ---
def inject_fraud_ring(dispatches_df, omcs_df):
    """Injects high-volume product substitution anomalies into targeted OMC accounts."""
    fraud_omcs = omcs_df.sample(CONFIG["fraud_ring_size"])['omc_id'].tolist()
    weird_product = random.choice(["JETA1", "LPG"])
    print(f"⚠️ Injecting Fraud: {fraud_omcs} -> {weird_product}")
    idxs = dispatches_df[dispatches_df['omc_id'].isin(fraud_omcs)].index

    for idx in random.sample(list(idxs), min(25, len(idxs))):
        dispatches_df.at[idx, 'product'] = weird_product
        dispatches_df.at[idx, 'volume_liters'] = int(random.uniform(70000, 110000))
        vol = dispatches_df.at[idx, 'volume_liters']
        dist = dispatches_df.at[idx, 'distance_km']

        t_fee = int((vol / 1000) * 5.53 * dist)
        s_fee = int((vol / 1000) * 1000.0)
        dispatches_df.at[idx, 'transport_tariff_kes'] = t_fee
        dispatches_df.at[idx, 'storage_tariff_kes'] = s_fee
        dispatches_df.at[idx, 'value_kes'] = t_fee + s_fee

    return dispatches_df


# --- 5. GENERATE INVOICES ---
def generate_invoices(dispatches_df, omcs_df):
    """Generates invoices based on commercial dispatches, injecting unbilled leakage."""
    omc_profiles = dict(zip(omcs_df['omc_id'], omcs_df['risk_profile']))
    invoices = []
    
    for _, r in dispatches_df.iterrows():
        profile = LEAKAGE_PROFILES[omc_profiles[r['omc_id']]]
        
        if random.random() < profile["invoice_leak"]:
            continue  # Uninvoiced dispatch (Revenue Leak)

        inv_dt = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(1, 7))
        val = r['value_kes'] * random.uniform(0.98, 1.02)
        
        if random.random() < profile["tariff_error_rate"]:
            val *= random.uniform(0.70, 1.30)  # Tariff/calculation error

        invoices.append({
            'invoice_id': f'INV-{random.randint(10000, 99999)}',
            'dispatch_id': r['dispatch_id'],
            'omc_id': r['omc_id'],
            'customer_name': r['customer_name'],
            'product': r['product'],
            'date': inv_dt.strftime('%Y-%m-%d'),
            'value_kes': int(val)
        })
    return pd.DataFrame(invoices)


# --- 6. GENERATE PAYMENTS ---
def generate_payments(invoices_df, omcs_df):
    """Generates payment records including underpayments and split installments."""
    omc_profiles = dict(zip(omcs_df['omc_id'], omcs_df['risk_profile']))
    payments = []
    
    for _, r in invoices_df.iterrows():
        profile = LEAKAGE_PROFILES[omc_profiles[r['omc_id']]]
        
        if random.random() < profile["payment_leak"]:
            continue  # Unpaid Invoice (Bad Debt / Payment Leak)

        pay_dt = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(10, 60))
        val = r['value_kes']

        if random.random() < profile["installment_rate"]:
            p1 = val * random.uniform(0.50, 0.80)
            payments.append({
                'payment_id': f'PAY-{random.randint(10000, 99999)}',
                'invoice_id': r['invoice_id'],
                'omc_id': r['omc_id'],
                'customer_name': r['customer_name'],
                'date': pay_dt.strftime('%Y-%m-%d'),
                'value_kes': int(p1),
                'installment_no': 1
            })
            pay_dt_2 = pay_dt + timedelta(days=random.randint(14, 30))
            p2 = val - p1
            if p2 > 0:
                payments.append({
                    'payment_id': f'PAY-{random.randint(10000, 99999)}',
                    'invoice_id': r['invoice_id'],
                    'omc_id': r['omc_id'],
                    'customer_name': r['customer_name'],
                    'date': pay_dt_2.strftime('%Y-%m-%d'),
                    'value_kes': int(p2),
                    'installment_no': 2
                })
        else:
            if random.random() < profile["underpay_rate"]:
                val *= random.uniform(0.75, 0.99)  # Partial payment / Underpayment
            payments.append({
                'payment_id': f'PAY-{random.randint(10000, 99999)}',
                'invoice_id': r['invoice_id'],
                'omc_id': r['omc_id'],
                'customer_name': r['customer_name'],
                'date': pay_dt.strftime('%Y-%m-%d'),
                'value_kes': int(val),
                'installment_no': 1
            })
    return pd.DataFrame(payments)


# --- 7. GENERATE DEPOT DAILY INVENTORY LEDGER ---
def generate_depot_inventory(dispatches_df):
    """Generates daily physical tank dips vs metered book balances per depot/product."""
    inventory_records = []
    dates = pd.date_range(start="2025-01-01", end="2026-07-01", freq="D")

    for dt in dates:
        dt_str = dt.strftime('%Y-%m-%d')
        for depot in DEPOT_DISTANCES_KM.keys():
            for product in PRODUCTS:
                # Aggregate daily dispatched volume
                daily_disp = dispatches_df[
                    (dispatches_df['date'] == dt_str) &
                    (dispatches_df['depot'] == depot) &
                    (dispatches_df['product'] == product)
                ]['volume_liters'].sum()

                opening_stock = random.randint(500000, 2000000)
                receipts = random.choice([0, 0, 0, random.randint(200000, 800000)])
                book_closing = opening_stock + receipts - daily_disp

                # Physical Dip Reading with meter variance/loss
                variance = random.randint(-5000, 2000)
                physical_dip_closing = book_closing + variance

                inventory_records.append({
                    'record_id': f"INV-BAL-{hash(dt_str+depot+product)%1000000:06d}",
                    'date': dt_str,
                    'depot': depot,
                    'product': product,
                    'opening_stock_liters': opening_stock,
                    'received_pipeline_liters': receipts,
                    'dispatched_liters': int(daily_disp),
                    'book_closing_stock_liters': int(book_closing),
                    'physical_dip_closing_stock_liters': int(physical_dip_closing),
                    'variance_liters': int(variance)
                })
    return pd.DataFrame(inventory_records)


# --- 8. INJECT OPERATIONAL DATA MESSINESS ---
def inject_messiness(df, date_col=None, float_col=None):
    """Introduces raw operational data flaws (duplicates, bad dates, bad string formatting)."""
    df_messy = df.copy()

    # 1. Duplicate Ingestion Glitches (4%)
    dupes = df_messy.sample(frac=0.04)
    df_messy = pd.concat([df_messy, dupes], ignore_index=True)

    # 2. Missing Dates & Inconsistent Formatting (3%)
    if date_col and date_col in df_messy.columns:
        null_idx = df_messy.sample(frac=0.03).index
        df_messy.loc[null_idx, date_col] = np.nan

        # Format subset of dates as DD/MM/YYYY
        alt_date_idx = df_messy.dropna(subset=[date_col]).sample(frac=0.05).index
        df_messy.loc[alt_date_idx, date_col] = df_messy.loc[alt_date_idx, date_col].apply(
            lambda x: datetime.strptime(str(x)[:10], '%Y-%m-%d').strftime('%d/%m/%Y') if pd.notnull(x) else x
        )

    # 3. String Currency Formatting Errors (5%)
    if float_col and float_col in df_messy.columns:
        format_idx = df_messy.sample(frac=0.05).index
        df_messy.loc[format_idx, float_col] = df_messy.loc[format_idx, float_col].apply(
            lambda x: f" KES {int(x):,} " if pd.notnull(x) else x
        )

    return df_messy.sample(frac=1).reset_index(drop=True)


# --- MAIN EXECUTION PIPELINE ---
if __name__ == "__main__":
    output_dir = 'data/raw'
    os.makedirs(output_dir, exist_ok=True)
    print("⏳ Starting Synthetic Data Generation for KPC Revenue Assurance...")

    # Step 0: Product/Depot Master (kept unmessied, like omcs — curated master data)
    products_df = generate_product_master()
    depots_df = generate_depot_master()

    # Step 1: Base Entities
    tariffs_df = generate_tariff_master()
    omcs_df = generate_omc_master()

    # Step 2: Physical & Commercial Loading/Dispatches
    loading_df, dispatches_df = generate_loading_and_dispatches(omcs_df, tariffs_df)
    dispatches_df = inject_fraud_ring(dispatches_df, omcs_df)

    # Step 3: Order-to-Cash Invoicing & Payments
    invoices_df = generate_invoices(dispatches_df, omcs_df)
    payments_df = generate_payments(invoices_df, omcs_df)

    # Step 4: Physical Tank Inventory Ledger
    inventory_df = generate_depot_inventory(dispatches_df)

    # Step 5: Messiness Injection
    loading_messy = inject_messiness(loading_df, date_col='loading_timestamp')
    dispatches_messy = inject_messiness(dispatches_df, date_col='date', float_col='value_kes')
    invoices_messy = inject_messiness(invoices_df, date_col='date', float_col='value_kes')
    payments_messy = inject_messiness(payments_df, date_col='date', float_col='value_kes')
    inventory_messy = inject_messiness(inventory_df, date_col='date')

    # Step 6: Export CSV Files
    products_df.to_csv(f'{output_dir}/products.csv', index=False)
    depots_df.to_csv(f'{output_dir}/depots.csv', index=False)
    tariffs_df.to_csv(f'{output_dir}/tariffs.csv', index=False)
    omcs_df.to_csv(f'{output_dir}/omcs.csv', index=False)
    loading_messy.to_csv(f'{output_dir}/depot_loading_logs.csv', index=False)
    dispatches_messy.to_csv(f'{output_dir}/dispatches.csv', index=False)
    invoices_messy.to_csv(f'{output_dir}/invoices.csv', index=False)
    payments_messy.to_csv(f'{output_dir}/payments.csv', index=False)
    inventory_messy.to_csv(f'{output_dir}/depot_daily_inventory.csv', index=False)

    print(f" Raw synthetic CSV datasets successfully created in '{output_dir}/':")
    print("  - products.csv (Product/Fuel Code Master)")
    print("  - depots.csv (Depot Master)")
    print("  - tariffs.csv (Tariff Master & Rates)")
    print("  - omcs.csv (OMC Master)")
    print("  - depot_loading_logs.csv (Physical Loading Bay Events)")
    print("  - dispatches.csv (Commercial Waybills)")
    print("  - invoices.csv (Financial Invoices)")
    print("  - payments.csv (Payment Remittances)")
    print("  - depot_daily_inventory.csv (Physical Tank Dips & Balances)")
