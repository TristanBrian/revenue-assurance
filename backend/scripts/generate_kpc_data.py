"""
KPC Revenue Assurance - Synthetic Data Generator (Order-to-Cash & Data Quality)
Generates end-to-end messy operational CSVs for KPC's revenue leakage hackathon.
*UPDATED: Now includes network graph attributes (shared directors, fleets, sleeper cell temporal anomalies) to detect shell companies.*
*STAGE 2: Extended with the Inuka Foundation outbound (stipend/disbursement) domain —
see "OUTBOUND (STIPEND/DISBURSEMENT)" section below. Same leakage-injection philosophy,
mirrored entity-for-entity (see that section's docstring for the mapping).*

Datasets Generated (inbound):
1. products.csv                - Product/fuel code master (PMS/AGO/DPK + non-fuel codes)
2. depots.csv                  - Depot master
3. omcs.csv                    - Master list of Oil Marketing Companies
4. tariffs.csv                 - Tariff Master with Effective Date Ranges (SCD Type 2)
5. depot_loading_logs.csv      - Physical Metering & Loading Bay Events at Gantries
6. dispatches.csv              - Commercial Dispatch & Waybill Records
7. invoices.csv                - Financial Invoices Issued to OMCs
8. payments.csv                - Remittance & Payment Transaction Records
9. depot_daily_inventory.csv   - Daily Physical Tank Dips vs. Book Balances

Datasets Generated (outbound — Stage 2):
10. officers.csv                - Field Officer / Program Site master
11. beneficiaries.csv            - Beneficiary master (Inuka Foundation program participants)
12. attendance.csv               - Attendance / Eligibility Records
13. stipend_authorizations.csv   - Stipend Authorizations (officer sign-off on eligible attendance)
14. disbursements.csv            - Disbursements (mobile money / bank payouts to beneficiaries)
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
    "num_dispatches": 10000,
    "fraud_ring_size": 3  
}

# --- OMC RISK PROFILES ---
LEAKAGE_PROFILES = {
    "Good": { # 3 OMCs: Zero leakages (Perfect baseline)
        "unmetered_loading_leak": 0.00, "dispatch_loading_skew": 0.00,
        "invoice_leak": 0.00, "payment_leak": 0.00, "underpay_rate": 0.00,
        "overpay_rate": 0.00, 
        "installment_rate": 0.00, "tariff_error_rate": 0.00
    },
    "Small": { # 10 OMCs: Very minor, occasional errors
        "unmetered_loading_leak": 0.01, "dispatch_loading_skew": 0.02,
        "invoice_leak": 0.02, "payment_leak": 0.01, "underpay_rate": 0.05,
        "overpay_rate": 0.02, 
        "installment_rate": 0.10, "tariff_error_rate": 0.01
    },
    "Medium": { # 4 OMCs: Standard operational messiness
        "unmetered_loading_leak": 0.05, "dispatch_loading_skew": 0.08,
        "invoice_leak": 0.08, "payment_leak": 0.05, "underpay_rate": 0.20,
        "overpay_rate": 0.05, 
        "installment_rate": 0.30, "tariff_error_rate": 0.05
    },
    "High": { # 3 OMCs: Massive leakages & targeted for fraud ring / shell companies
        "unmetered_loading_leak": 0.15, "dispatch_loading_skew": 0.20,
        "invoice_leak": 0.20, "payment_leak": 0.15, "underpay_rate": 0.40,
        "overpay_rate": 0.10, 
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

# --- ACTOR ATTRIBUTION (audit trail — Domain 5, Problem 10) ---
# The audit trail attributes every ingested record to whoever the source
# record itself names as having done it, not a generic "ETL system"
# actor. These are the depot/KPC-side and Foundation-side staff pools that
# make that possible — a small, mostly-consistent-per-depot cast (like
# shared_fleet/shared_drivers above), not a fresh random name per row,
# since that's what a real depot/finance desk roster looks like.
DEPOT_CLERKS = {
    # depot.split(' ')[0][:3] alone collides for "Mombasa (KOSF)" and
    # "Mombasa (Kipevu)" (both -> "MOM") — the parenthesized suffix (if
    # any) disambiguates them into distinct clerk-id prefixes.
    depot: [
        f"CLERK-{depot.split(' ')[0][:3].upper()}{('-' + depot.split('(')[1][:3].upper()) if '(' in depot else ''}-{n:02d}"
        for n in range(1, 4)
    ]
    for depot in DEPOT_DISTANCES_KM
}
# KPC billing/finance staff who prepare invoices — deliberately a
# separate pool from depot clerks (segregation of duties: the person who
# records a dispatch isn't the one who bills for it).
KPC_FINANCE_STAFF = [f"FIN-{n:03d}" for n in range(1, 6)]
# Inuka Foundation payments desk — deliberately a separate pool from
# field officers (segregation of duties: the officer who authorizes a
# stipend isn't the one who processes the payout).
FOUNDATION_PAYMENTS_STAFF = [f"PAY-{n:03d}" for n in range(1, 5)]
# payments.csv has no analogous actor field: a payment here is a bank-to-
# bank remittance from the OMC's own banking system settling an invoice,
# not a KPC/OMC staff action — there's no real single named individual to
# attribute it to (see remitting_bank_account, already the closest thing
# to "who/what sent this"). Audited with a null actor, which is the
# realistic attribution, not a gap.

OMC_NAMES = [
    "TotalEnergies Kenya", "Vivo Energy", "Rubis Energy", "Gulf Energy",
    "PetroOil Kenya", "Hashi Energy", "Kobil", "National Oil",
    "Dalbit Petroleum", "Tamoil", "Hass Petroleum", "Galana Energies",
    "Lake Oil", "Texol Energies", "Mombasa Petroleum", "KPA Marine",
    "KAA Aviation", "Uganda National Oil", "Tanzania Petroleum", "Ethiopian Oil"
]

PRODUCTS = ["PMS", "AGO", "DPK", "JETA1", "HFO", "LPG", "LUB"]

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
    return pd.DataFrame(
        [{'depot_id': depot_id, 'depot_name': depot_id, 'location': None,
          'capacity_litres': random.randint(2000000, 8000000), 'is_active': True}
         for depot_id in DEPOT_DISTANCES_KM.keys()]
    )

def generate_tariff_master():
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

def generate_omc_master():
    """Generates customer master records, injecting shell company network graphs."""
    omcs = []
    
    profiles = (["Good"] * 3) + (["Small"] * 10) + (["Medium"] * 4) + (["High"] * 3)
    random.shuffle(profiles)
    
    # --- FRAUD RING / SHELL COMPANY SHARED ASSETS ---
    fraud_director = fake.name()
    fraud_address = fake.address().replace('\n', ', ')
    fraud_bank_account = fake.iban()
    
    for idx, name in enumerate(OMC_NAMES, 1):
        profile = profiles[idx-1]
        
        # Inject network graph connections for high-risk OMCs
        if profile == "High":
            director = fraud_director
            address = fraud_address
            bank_acc = fraud_bank_account
            # Shell companies incorporated just days before operations begin
            incorp_date = fake.date_between(start_date=datetime(2024, 11, 1), end_date=datetime(2024, 12, 15)).strftime('%Y-%m-%d')
            risk_rating = 'High'
        else:
            director = fake.name()
            address = fake.address().replace('\n', ', ')
            bank_acc = fake.iban()
            # Legitimate companies incorporated years ago
            incorp_date = fake.date_between(start_date=datetime(2010, 1, 1), end_date=datetime(2023, 12, 31)).strftime('%Y-%m-%d')
            risk_rating = random.choices(['Low', 'Medium'], weights=[0.60, 0.40])[0]

        omcs.append({
            'omc_id': f'OMC-{idx:03d}',
            'customer_name': name,
            'kra_pin': f"P{fake.random_number(9, True)}Z",
            'payment_terms_days': random.choice([15, 30, 45, 60]),
            'credit_limit_kes': random.randint(20000000, 80000000),
            'risk_rating': risk_rating,
            'risk_profile': profile,
            'contact_email': fake.company_email(),
            'phone': fake.phone_number(),
            # --- NETWORK GRAPH FIELDS ---
            'director_name': director,
            'registered_address': address,
            'incorporation_date': incorp_date,
            'primary_bank_account': bank_acc,
            'is_active': True
        })
    return pd.DataFrame(omcs)

def generate_loading_and_dispatches(omcs_df, tariffs_df):
    """Generates physical loading logs and commercial dispatches, injecting temporal & fleet anomalies."""
    omc_data = omcs_df.set_index('omc_id').to_dict('index')
    
    dispatches = []
    loading_logs = []
    
    start_date = datetime(2025, 1, 1)
    end_date = datetime(2026, 7, 1)
    
    # --- FRAUD RING GHOST FLEET ---
    # The shell companies share a small pool of 4 trucks and drivers
    shared_fleet = [f"K{random.choice(['C','D'])}{random.randint(10,99)}{random.choice(['A','B','C','D','E'])}" for _ in range(4)]
    shared_drivers = [f"DRV-{random.randint(1000,9999)}" for _ in range(4)]
    
    # --- SLEEPER CELL DATES ---
    # High risk OMCs sit dormant, then execute all transactions in a sudden burst
    burst_start = datetime(2026, 2, 1)
    burst_end = datetime(2026, 4, 30)

    for i in range(CONFIG["num_dispatches"]):
        omc_id = random.choice(list(omc_data.keys()))
        omc = omc_data[omc_id]
        profile_name = omc['risk_profile']
        profile = LEAKAGE_PROFILES[profile_name]
        
        # Determine Date & Fleet based on risk profile
        if profile_name == "High":
            event_dt = burst_start + timedelta(days=random.randint(0, (burst_end - burst_start).days), seconds=random.randint(0, 86400))
            truck_reg = random.choice(shared_fleet)
            driver_id = random.choice(shared_drivers)
        else:
            event_dt = start_date + timedelta(days=random.randint(0, (end_date - start_date).days), seconds=random.randint(0, 86400))
            # Generate a random truck/driver for normal OMCs
            truck_reg = f"K{random.choice(['A','B'])}{random.randint(10,99)}{random.choice(['F','G','H','J'])}"
            driver_id = f"DRV-{random.randint(10000,99999)}"

        date_str = event_dt.strftime('%Y-%m-%d')
        product = random.choice(PRODUCTS)
        depot = random.choice(list(DEPOT_DISTANCES_KM.keys()))
        dist_km = DEPOT_DISTANCES_KM[depot]

        tariff_match = tariffs_df[
            (tariffs_df['product'] == product) &
            (tariffs_df['depot'] == depot) &
            (tariffs_df['effective_start'] <= date_str) &
            (tariffs_df['effective_end'] >= date_str)
        ]

        p_rate = tariff_match['pipeline_tariff_per_m3_km'].values[0] if not tariff_match.empty else 5.53
        s_rate = tariff_match['storage_tariff_per_m3_day'].values[0] if not tariff_match.empty else 1000.00

        physical_loaded_liters = round(random.uniform(20000, 60000), 0)
        loading_id = f"LOAD-{i+1:06d}"
        dispatch_id = f"DISP-{i+1:05d}"

        if random.random() < profile["dispatch_loading_skew"]:
            disp_vol = physical_loaded_liters * random.uniform(0.92, 0.98) 
        else:
            disp_vol = physical_loaded_liters

        transport_fee = round((disp_vol / 1000) * p_rate * dist_km, 0)
        storage_fee = round((disp_vol / 1000) * s_rate, 0)
        total_val = transport_fee + storage_fee

        loading_logs.append({
            'loading_id': loading_id,
            'gantry_bay_id': f"BAY-{random.randint(1, 12):02d}",
            'meter_id': f"MTR-{random.randint(100, 999)}",
            'dispatch_id': None if random.random() < profile["unmetered_loading_leak"] else dispatch_id,
            'omc_id': omc_id,
            'depot': depot,
            'product': product,
            'physical_loaded_liters': int(physical_loaded_liters),
            'temperature_c': round(random.uniform(20.0, 32.0), 1),
            'density_kg_m3': round(random.uniform(720.0, 850.0), 1),
            'loading_timestamp': event_dt.strftime('%Y-%m-%d %H:%M:%S')
        })

        dispatches.append({
            'dispatch_id': dispatch_id,
            'loading_id': loading_id,
            'date': date_str,
            'year': event_dt.year,
            'month': event_dt.month,
            'omc_id': omc_id,
            'customer_name': omc['customer_name'],
            'product': product,
            'depot': depot,
            'volume_liters': int(disp_vol),
            'distance_km': dist_km,
            # --- FLEET LOGISTICS ---
            'truck_reg_number': truck_reg,
            'driver_id': driver_id,
            'transport_tariff_kes': int(transport_fee),
            'storage_tariff_kes': int(storage_fee),
            'value_kes': int(total_val),
            # Depot clerk who recorded this dispatch — the audit actor,
            # distinct from driver_id (who moved the fuel, not who logged
            # the paperwork for it).
            'dispatched_by': random.choice(DEPOT_CLERKS[depot]),
        })

    return pd.DataFrame(loading_logs), pd.DataFrame(dispatches)

def inject_fraud_ring(dispatches_df, omcs_df):
    """Injects high-volume product substitution anomalies into targeted OMC accounts."""
    fraud_omcs = omcs_df[omcs_df['risk_profile'] == 'High']['omc_id'].tolist()
    weird_product = random.choice(["JETA1", "LPG"])
    print(f"⚠️ Injecting Substitution Fraud: {fraud_omcs} -> {weird_product}")
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

def generate_invoices(dispatches_df, omcs_df):
    omc_profiles = dict(zip(omcs_df['omc_id'], omcs_df['risk_profile']))
    invoices = []
    
    for _, r in dispatches_df.iterrows():
        profile = LEAKAGE_PROFILES[omc_profiles[r['omc_id']]]
        
        if random.random() < profile["invoice_leak"]:
            continue  

        inv_dt = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(1, 7))
        val = r['value_kes'] * random.uniform(0.98, 1.02)
        
        if random.random() < profile["tariff_error_rate"]:
            val *= random.uniform(0.70, 1.30) 

        invoices.append({
            'invoice_id': f'INV-{random.randint(10000, 99999)}',
            'dispatch_id': r['dispatch_id'],
            'omc_id': r['omc_id'],
            'customer_name': r['customer_name'],
            'product': r['product'],
            'date': inv_dt.strftime('%Y-%m-%d'),
            'value_kes': int(val),
            'prepared_by': random.choice(KPC_FINANCE_STAFF),
        })
    return pd.DataFrame(invoices)

def generate_payments(invoices_df, omcs_df):
    omc_profiles = dict(zip(omcs_df['omc_id'], omcs_df['risk_profile']))
    # Grab the pre-generated bank accounts to ensure consistency
    omc_banks = dict(zip(omcs_df['omc_id'], omcs_df['primary_bank_account']))
    
    payments = []
    
    for _, r in invoices_df.iterrows():
        profile = LEAKAGE_PROFILES[omc_profiles[r['omc_id']]]
        
        if random.random() < profile["payment_leak"]:
            continue  

        pay_dt = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(10, 60))
        val = r['value_kes']
        remitting_acc = omc_banks[r['omc_id']]

        if random.random() < profile["installment_rate"]:
            p1 = val * random.uniform(0.50, 0.80)
            payments.append({
                'payment_id': f'PAY-{random.randint(10000, 99999)}',
                'invoice_id': r['invoice_id'],
                'omc_id': r['omc_id'],
                'customer_name': r['customer_name'],
                'remitting_bank_account': remitting_acc,
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
                    'remitting_bank_account': remitting_acc,
                    'date': pay_dt_2.strftime('%Y-%m-%d'),
                    'value_kes': int(p2),
                    'installment_no': 2
                })
        else:
            if random.random() < profile["underpay_rate"]:
                val *= random.uniform(0.75, 0.99) 
            elif random.random() < profile["overpay_rate"]:
                val *= random.uniform(1.01, 1.15) 
                
            payments.append({
                'payment_id': f'PAY-{random.randint(10000, 99999)}',
                'invoice_id': r['invoice_id'],
                'omc_id': r['omc_id'],
                'customer_name': r['customer_name'],
                'remitting_bank_account': remitting_acc,
                'date': pay_dt.strftime('%Y-%m-%d'),
                'value_kes': int(val),
                'installment_no': 1
            })
    return pd.DataFrame(payments)

def generate_depot_inventory(dispatches_df):
    inventory_records = []
    dates = pd.date_range(start="2025-01-01", end="2026-07-01", freq="D")

    for dt in dates:
        dt_str = dt.strftime('%Y-%m-%d')
        for depot in DEPOT_DISTANCES_KM.keys():
            for product in PRODUCTS:
                daily_disp = dispatches_df[
                    (dispatches_df['date'] == dt_str) &
                    (dispatches_df['depot'] == depot) &
                    (dispatches_df['product'] == product)
                ]['volume_liters'].sum()

                opening_stock = random.randint(500000, 2000000)
                receipts = random.choice([0, 0, 0, random.randint(200000, 800000)])
                book_closing = opening_stock + receipts - daily_disp

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

def inject_messiness(df, date_col=None, float_col=None):
    df_messy = df.copy()

    dupes = df_messy.sample(frac=0.04)
    df_messy = pd.concat([df_messy, dupes], ignore_index=True)

    if date_col and date_col in df_messy.columns:
        null_idx = df_messy.sample(frac=0.03).index
        df_messy.loc[null_idx, date_col] = np.nan

        alt_date_idx = df_messy.dropna(subset=[date_col]).sample(frac=0.05).index
        df_messy.loc[alt_date_idx, date_col] = df_messy.loc[alt_date_idx, date_col].apply(
            lambda x: datetime.strptime(str(x)[:10], '%Y-%m-%d').strftime('%d/%m/%Y') if pd.notnull(x) else x
        )

    if float_col and float_col in df_messy.columns:
        format_idx = df_messy.sample(frac=0.05).index
        df_messy.loc[format_idx, float_col] = df_messy.loc[format_idx, float_col].apply(
            lambda x: f" KES {int(x):,} " if pd.notnull(x) else x
        )

    return df_messy.sample(frac=1).reset_index(drop=True)


# =============================================================================
# OUTBOUND (STIPEND/DISBURSEMENT) — Inuka Foundation, Stage 2
# =============================================================================
# Same structural-leakage philosophy as the inbound section above, mirrored
# entity-for-entity:
#   Dispatch -> Attendance/Eligibility Record   OMC -> Beneficiary
#   Invoice  -> Stipend Authorization            Product -> Pillar
#   Payment  -> Disbursement                     Depot -> Field Officer / Program Site
#
# Leakage is officer-level, not beneficiary-level: each beneficiary is
# assigned to one officer, and every attendance/authorization/disbursement
# roll for that beneficiary uses THEIR OFFICER's profile (not an
# independent per-beneficiary roll) — this is what makes officer-level
# clustering in the fraud graph meaningful later, same reason
# generate_invoices()/generate_payments() above key off omc risk_profile
# rather than rolling fresh dice per dispatch.

OFFICER_LEAKAGE_PROFILES = {
    "Good": {  # never misses a step
        "authorization_leak": 0.00, "disbursement_leak": 0.00,
        "underpay_rate": 0.00, "overpay_rate": 0.00, "ghost_payment_rate": 0.00,
    },
    "Small": {  # occasional paperwork slip
        "authorization_leak": 0.02, "disbursement_leak": 0.02,
        "underpay_rate": 0.05, "overpay_rate": 0.02, "ghost_payment_rate": 0.00,
    },
    "Medium": {  # standard field-office messiness
        "authorization_leak": 0.08, "disbursement_leak": 0.08,
        "underpay_rate": 0.20, "overpay_rate": 0.05, "ghost_payment_rate": 0.02,
    },
    "High": {  # targeted for the disbursement ring injection below
        "authorization_leak": 0.20, "disbursement_leak": 0.20,
        "underpay_rate": 0.40, "overpay_rate": 0.10, "ghost_payment_rate": 0.15,
    },
}

PILLARS = ["Scholarship", "Plus", "Vocational", "Tech"]

# Standard monthly stipend per pillar — the "eligible amount" an attendance
# record implies, same role as tariff-derived value_kes on inbound dispatches.
PILLAR_MONTHLY_RATE_KES = {
    "Scholarship": 15000,
    "Plus": 8000,
    "Vocational": 10000,
    "Tech": 12000,
}

PROGRAM_SITES = ["Nairobi East", "Kisumu Central", "Mombasa South", "Eldoret North", "Nakuru West"]

# 2025-01 .. 2026-06, 18 months — same overall span as the inbound dataset.
STIPEND_PERIODS = [f"2025-{m:02d}" for m in range(1, 13)] + [f"2026-{m:02d}" for m in range(1, 7)]


def generate_officer_master():
    """15 officers: 4 Good, 6 Small, 3 Medium, 2 High — proportionally
    similar spread to the 20-OMC inbound master (3/10/4/3)."""
    profiles = (["Good"] * 4) + (["Small"] * 6) + (["Medium"] * 3) + (["High"] * 2)
    random.shuffle(profiles)
    officers = []
    for idx, profile in enumerate(profiles, 1):
        officers.append({
            'officer_id': f'OFF-{idx:03d}',
            'officer_name': fake.name(),
            'program_site': random.choice(PROGRAM_SITES),
            'risk_profile': profile,
            'phone': fake.phone_number(),
            'is_active': True,
        })
    return pd.DataFrame(officers)


def generate_beneficiary_master(officers_df, num_beneficiaries=200):
    """Each beneficiary is assigned to exactly one officer and one pillar —
    the officer assignment is what the leakage rolls downstream key off."""
    officer_ids = officers_df['officer_id'].tolist()
    beneficiaries = []
    for idx in range(1, num_beneficiaries + 1):
        beneficiaries.append({
            'beneficiary_id': f'BEN-{idx:04d}',
            'beneficiary_name': fake.name(),
            'officer_id': random.choice(officer_ids),
            'pillar_id': random.choice(PILLARS),
            'guardian_name': fake.name(),
            'registered_address': fake.address().replace('\n', ', '),
            'mobile_money_number': fake.phone_number(),
            'enrollment_date': fake.date_between(
                start_date=datetime(2024, 6, 1), end_date=datetime(2025, 1, 1)
            ).strftime('%Y-%m-%d'),
            'is_active': True,
        })
    return pd.DataFrame(beneficiaries)


def generate_attendance(beneficiaries_df):
    """Each beneficiary attends (and is eligible for) a random subset of
    the 18 stipend periods, not necessarily every month — mirrors how not
    every OMC dispatches every day."""
    attendance = []
    for _, ben in beneficiaries_df.iterrows():
        rate = PILLAR_MONTHLY_RATE_KES[ben['pillar_id']]
        attended_periods = random.sample(STIPEND_PERIODS, k=random.randint(6, len(STIPEND_PERIODS)))
        for period in attended_periods:
            year, month = (int(x) for x in period.split('-'))
            attendance_dt = datetime(year, month, random.randint(1, 28))
            attendance.append({
                'attendance_id': f'ATT-{len(attendance) + 1:06d}',
                'beneficiary_id': ben['beneficiary_id'],
                'officer_id': ben['officer_id'],
                'pillar_id': ben['pillar_id'],
                'period': period,
                'attendance_date': attendance_dt.strftime('%Y-%m-%d'),
                'verified_at': (attendance_dt + timedelta(days=random.randint(0, 2))).strftime('%Y-%m-%d %H:%M:%S'),
                'eligible_amount_kes': rate,
                'status': 'Verified',
            })
    return pd.DataFrame(attendance)


def generate_stipend_authorizations(attendance_df, officers_df):
    officer_profiles = dict(zip(officers_df['officer_id'], officers_df['risk_profile']))
    authorizations = []

    for _, r in attendance_df.iterrows():
        profile = OFFICER_LEAKAGE_PROFILES[officer_profiles[r['officer_id']]]

        if random.random() < profile["authorization_leak"]:
            continue  # structurally skipped -> Missing Authorization

        att_dt = datetime.strptime(r['attendance_date'], '%Y-%m-%d')
        auth_dt = att_dt + timedelta(days=random.randint(1, 5))
        amount = r['eligible_amount_kes'] * random.uniform(0.98, 1.02)

        authorizations.append({
            'authorization_id': f'AUTH-{len(authorizations) + 1:06d}',
            'attendance_id': r['attendance_id'],
            'beneficiary_id': r['beneficiary_id'],
            'pillar_id': r['pillar_id'],
            'period': r['period'],
            'date': auth_dt.strftime('%Y-%m-%d'),
            'amount_authorized': int(amount),
            'authorized_by': r['officer_id'],
        })
    return pd.DataFrame(authorizations)


def generate_disbursements(authorizations_df, beneficiaries_df, officers_df):
    ben_officer = dict(zip(beneficiaries_df['beneficiary_id'], beneficiaries_df['officer_id']))
    ben_account = dict(zip(beneficiaries_df['beneficiary_id'], beneficiaries_df['mobile_money_number']))
    officer_profiles = dict(zip(officers_df['officer_id'], officers_df['risk_profile']))

    disbursements = []
    for _, r in authorizations_df.iterrows():
        officer_id = ben_officer[r['beneficiary_id']]
        profile = OFFICER_LEAKAGE_PROFILES[officer_profiles[officer_id]]

        if random.random() < profile["disbursement_leak"]:
            continue  # structurally skipped -> Missing Disbursement

        auth_dt = datetime.strptime(r['date'], '%Y-%m-%d')
        disb_dt = auth_dt + timedelta(days=random.randint(3, 21))
        amount = r['amount_authorized']

        if random.random() < profile["underpay_rate"]:
            amount *= random.uniform(0.70, 0.95)
        elif random.random() < profile["overpay_rate"]:
            amount *= random.uniform(1.05, 1.30)

        disbursements.append({
            'disbursement_id': f'DISB-{len(disbursements) + 1:06d}',
            'authorization_id': r['authorization_id'],
            'beneficiary_id': r['beneficiary_id'],
            'pillar_id': r['pillar_id'],
            'period': r['period'],
            'date': disb_dt.strftime('%Y-%m-%d'),
            'amount_paid': int(amount),
            'channel': random.choice(['mobile_money', 'bank']),
            'disbursing_account': ben_account.get(r['beneficiary_id']),
            'processed_by': random.choice(FOUNDATION_PAYMENTS_STAFF),
        })

    # --- GHOST PAYMENTS ---
    # Fabricated disbursements with NO backing authorization at all
    # (authorization_id=None) — not a skipped step like the leaks above,
    # an extra row that shouldn't exist. Targeted at High-profile officers'
    # beneficiaries specifically, same as inbound's inject_fraud_ring()
    # targets High-profile OMCs.
    high_officers = officers_df[officers_df['risk_profile'] == 'High']['officer_id'].tolist()
    for officer_id in high_officers:
        profile = OFFICER_LEAKAGE_PROFILES['High']
        officer_beneficiaries = beneficiaries_df[beneficiaries_df['officer_id'] == officer_id]['beneficiary_id'].tolist()
        if not officer_beneficiaries:
            continue
        n_ghost = max(1, int(len(officer_beneficiaries) * profile["ghost_payment_rate"]))
        for _ in range(n_ghost):
            beneficiary_id = random.choice(officer_beneficiaries)
            pillar = beneficiaries_df.set_index('beneficiary_id').loc[beneficiary_id, 'pillar_id']
            period = random.choice(STIPEND_PERIODS)
            year, month = (int(x) for x in period.split('-'))
            ghost_dt = datetime(year, month, random.randint(1, 28))
            disbursements.append({
                'disbursement_id': f'DISB-{len(disbursements) + 1:06d}',
                'authorization_id': None,  # <-- the ghost signal
                'beneficiary_id': beneficiary_id,
                'pillar_id': pillar,
                'period': period,
                'date': ghost_dt.strftime('%Y-%m-%d'),
                'amount_paid': int(PILLAR_MONTHLY_RATE_KES[pillar] * random.uniform(0.9, 1.1)),
                'channel': random.choice(['mobile_money', 'bank']),
                'disbursing_account': ben_account.get(beneficiary_id),
                # Ghost payments still get a processed_by — knowing WHO
                # processed a payment with no backing authorization is
                # exactly the forensic detail an investigation needs, not
                # something to omit because the row itself is fabricated.
                'processed_by': random.choice(FOUNDATION_PAYMENTS_STAFF),
            })

    return pd.DataFrame(disbursements)


def inject_disbursement_ring(beneficiaries_df, disbursements_df, officers_df):
    """Mirrors inject_fraud_ring(): applied post-hoc to 2-3 High-profile
    officers' beneficiaries — shared mobile money number, clustered
    enrollment dates, and disbursements bursting into a narrow window.
    This is the pattern graph_engine.py's outbound Louvain clustering
    should surface as a correlated fraud ring."""
    high_officers = officers_df[officers_df['risk_profile'] == 'High']['officer_id'].tolist()
    ring_officers = high_officers[:3]
    print(f"⚠️ Injecting Disbursement Ring: {ring_officers}")

    shared_mobile_money = fake.phone_number()
    cluster_start, cluster_end = datetime(2024, 12, 1), datetime(2024, 12, 20)
    burst_start, burst_end = datetime(2026, 3, 1), datetime(2026, 4, 15)

    ring_beneficiary_ids = beneficiaries_df[
        beneficiaries_df['officer_id'].isin(ring_officers)
    ]['beneficiary_id'].tolist()

    for idx in beneficiaries_df[beneficiaries_df['beneficiary_id'].isin(ring_beneficiary_ids)].index:
        beneficiaries_df.at[idx, 'mobile_money_number'] = shared_mobile_money
        beneficiaries_df.at[idx, 'enrollment_date'] = fake.date_between(
            start_date=cluster_start, end_date=cluster_end
        ).strftime('%Y-%m-%d')

    disb_idxs = disbursements_df[disbursements_df['beneficiary_id'].isin(ring_beneficiary_ids)].index
    for idx in disb_idxs:
        disbursements_df.at[idx, 'disbursing_account'] = shared_mobile_money
        burst_dt = burst_start + timedelta(days=random.randint(0, (burst_end - burst_start).days))
        disbursements_df.at[idx, 'date'] = burst_dt.strftime('%Y-%m-%d')

    return beneficiaries_df, disbursements_df


if __name__ == "__main__":
    output_dir = 'data/raw'
    os.makedirs(output_dir, exist_ok=True)
    print("⏳ Starting Synthetic Data Generation for KPC Revenue Assurance...")

    products_df = generate_product_master()
    depots_df = generate_depot_master()
    tariffs_df = generate_tariff_master()
    omcs_df = generate_omc_master()

    loading_df, dispatches_df = generate_loading_and_dispatches(omcs_df, tariffs_df)
    dispatches_df = inject_fraud_ring(dispatches_df, omcs_df)

    invoices_df = generate_invoices(dispatches_df, omcs_df)
    payments_df = generate_payments(invoices_df, omcs_df)
    inventory_df = generate_depot_inventory(dispatches_df)

    loading_messy = inject_messiness(loading_df, date_col='loading_timestamp')
    dispatches_messy = inject_messiness(dispatches_df, date_col='date', float_col='value_kes')
    invoices_messy = inject_messiness(invoices_df, date_col='date', float_col='value_kes')
    payments_messy = inject_messiness(payments_df, date_col='date', float_col='value_kes')
    inventory_messy = inject_messiness(inventory_df, date_col='date')

    products_df.to_csv(f'{output_dir}/products.csv', index=False)
    depots_df.to_csv(f'{output_dir}/depots.csv', index=False)
    tariffs_df.to_csv(f'{output_dir}/tariffs.csv', index=False)
    omcs_df.to_csv(f'{output_dir}/omcs.csv', index=False)
    loading_messy.to_csv(f'{output_dir}/depot_loading_logs.csv', index=False)
    dispatches_messy.to_csv(f'{output_dir}/dispatches.csv', index=False)
    invoices_messy.to_csv(f'{output_dir}/invoices.csv', index=False)
    payments_messy.to_csv(f'{output_dir}/payments.csv', index=False)
    inventory_messy.to_csv(f'{output_dir}/depot_daily_inventory.csv', index=False)

    print(f"✅ Raw synthetic CSV datasets successfully created in '{output_dir}/' with Shell Company Network Graph attributes included.")

    # =========================================================================
    # OUTBOUND (STIPEND/DISBURSEMENT) — Inuka Foundation, Stage 2
    # =========================================================================
    print("⏳ Starting Outbound (Stipend/Disbursement) Data Generation...")

    officers_df = generate_officer_master()
    beneficiaries_df = generate_beneficiary_master(officers_df)
    attendance_df = generate_attendance(beneficiaries_df)
    authorizations_df = generate_stipend_authorizations(attendance_df, officers_df)
    disbursements_df = generate_disbursements(authorizations_df, beneficiaries_df, officers_df)

    beneficiaries_df, disbursements_df = inject_disbursement_ring(beneficiaries_df, disbursements_df, officers_df)

    officers_messy = inject_messiness(officers_df)
    beneficiaries_messy = inject_messiness(beneficiaries_df, date_col='enrollment_date')
    attendance_messy = inject_messiness(attendance_df, date_col='attendance_date')
    authorizations_messy = inject_messiness(authorizations_df, date_col='date', float_col='amount_authorized')
    disbursements_messy = inject_messiness(disbursements_df, date_col='date', float_col='amount_paid')

    officers_messy.to_csv(f'{output_dir}/officers.csv', index=False)
    beneficiaries_messy.to_csv(f'{output_dir}/beneficiaries.csv', index=False)
    attendance_messy.to_csv(f'{output_dir}/attendance.csv', index=False)
    authorizations_messy.to_csv(f'{output_dir}/stipend_authorizations.csv', index=False)
    disbursements_messy.to_csv(f'{output_dir}/disbursements.csv', index=False)

    print(f"✅ Outbound synthetic CSV datasets successfully created in '{output_dir}/' with Disbursement Ring attributes included.")