"""
KPC Revenue Assurance - Synthetic Data Generator
Generates raw CSVs with leakage, fraud rings, and physical inventory.
"""
import pandas as pd
import numpy as np
import random
import os
from datetime import datetime, timedelta
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)
np.random.seed(42)

# --- CONSTANTS ---
PIPELINE_TARIFF = 5.53
STORAGE_TARIFF = 1000.00
DEPOT_DISTANCES = {"Mombasa (KOSF)": 10, "Mombasa (Kipevu)": 5, "Nairobi": 450, "Kisumu": 650, "Eldoret": 700}
OMC_NAMES = ["TotalEnergies Kenya", "Vivo Energy", "Rubis Energy", "Gulf Energy", "PetroOil Kenya", "Hashi Energy", "Kobil", "National Oil", "Dalbit Petroleum", "Tamoil", "Hass Petroleum", "Galana Energies", "Lake Oil", "Saudi Petroleum", "Mombasa Petroleum", "KPA Marine", "KAA Aviation", "Uganda National Oil", "Tanzania Petroleum", "Ethiopian Oil"]
PRODUCTS = ["Petrol (PMS)", "Diesel (AGO)", "Kerosene (DPK)", "Jet A-1", "Heavy Fuel Oil", "LPG", "Lubricants"]
DEPOTS = list(DEPOT_DISTANCES.keys())
CONFIG = {"num_dispatches": 1200, "invoice_leak": 0.08, "payment_leak": 0.06, "underpay": 0.18, "installment": 0.30, "fraud_size": 3}

def generate_omc_master():
    omcs = []
    for idx, name in enumerate(OMC_NAMES, 1):
        omcs.append({'omc_id': f'OMC-{idx:03d}', 'customer_name': name, 'kra_pin': str(fake.random_number(8, True)), 
                     'payment_terms_days': random.choice([15,30,45,60]), 'credit_limit_kes': random.randint(20000000, 80000000),
                     'risk_rating': random.choices(['Low','Medium','High'], weights=[0.5,0.35,0.15])[0],
                     'contact_email': fake.email(), 'phone': fake.phone_number(), 'is_active': True})
    return pd.DataFrame(omcs)

def generate_dispatches(omcs_df):
    records = []
    start = datetime(2025,1,1); end = datetime(2026,7,1)
    for i in range(CONFIG["num_dispatches"]):
        omc = omcs_df.sample(1).iloc[0]
        d = start + timedelta(days=random.randint(0, (end-start).days))
        product = random.choice(PRODUCTS); depot = random.choice(DEPOTS)
        vol = round(random.uniform(20000, 60000), 0)
        dist = DEPOT_DISTANCES[depot]
        transport = round((vol/1000) * PIPELINE_TARIFF * dist, 0)
        storage = round((vol/1000) * STORAGE_TARIFF, 0)
        records.append({'dispatch_id': f'DISP-{i+1:05d}', 'date': d.strftime('%Y-%m-%d'), 'year': d.year, 'month': d.month,
                        'omc_id': omc['omc_id'], 'customer_name': omc['customer_name'], 'product': product, 'depot': depot,
                        'volume_liters': int(vol), 'distance_km': dist, 'transport_tariff_kes': int(transport),
                        'storage_tariff_kes': int(storage), 'value_kes': int(transport+storage)})
    return pd.DataFrame(records)

def inject_fraud_ring(dispatches_df, omcs_df):
    fraud_omcs = omcs_df.sample(CONFIG["fraud_size"])['omc_id'].tolist()
    weird_product = random.choice(["Jet A-1", "LPG"])
    print(f"⚠️ Injecting Fraud: {fraud_omcs} -> {weird_product}")
    idxs = dispatches_df[dispatches_df['omc_id'].isin(fraud_omcs)].index
    for idx in random.sample(list(idxs), min(20, len(idxs))):
        dispatches_df.at[idx, 'product'] = weird_product
        dispatches_df.at[idx, 'volume_liters'] = int(random.uniform(50000, 90000))
        v = dispatches_df.at[idx, 'volume_liters']; d = dispatches_df.at[idx, 'distance_km']
        dispatches_df.at[idx, 'transport_tariff_kes'] = int((v/1000)*PIPELINE_TARIFF*d)
        dispatches_df.at[idx, 'storage_tariff_kes'] = int((v/1000)*STORAGE_TARIFF)
        dispatches_df.at[idx, 'value_kes'] = dispatches_df.at[idx, 'transport_tariff_kes'] + dispatches_df.at[idx, 'storage_tariff_kes']
    return dispatches_df

def generate_invoices(dispatches_df):
    inv = []
    for _, r in dispatches_df.iterrows():
        if random.random() < CONFIG["invoice_leak"]: continue
        d = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(1,7))
        val = r['value_kes'] * random.uniform(0.98, 1.02)
        if random.random() < 0.05: val *= random.uniform(0.70, 1.30)
        inv.append({'invoice_id': f'INV-{random.randint(10000,99999)}', 'dispatch_id': r['dispatch_id'], 
                    'omc_id': r['omc_id'], 'customer_name': r['customer_name'], 'product': r['product'],
                    'date': d.strftime('%Y-%m-%d'), 'value_kes': int(val)})
    return pd.DataFrame(inv)

def generate_payments(invoices_df):
    pay = []
    for _, r in invoices_df.iterrows():
        if random.random() < CONFIG["payment_leak"]: continue
        d = datetime.strptime(r['date'], '%Y-%m-%d') + timedelta(days=random.randint(10,60))
        val = r['value_kes']
        if random.random() < CONFIG["installment"]:
            p1 = val * random.uniform(0.50, 0.80)
            pay.append({'payment_id': f'PAY-{random.randint(10000,99999)}', 'invoice_id': r['invoice_id'], 
                        'omc_id': r['omc_id'], 'customer_name': r['customer_name'], 'date': d.strftime('%Y-%m-%d'), 
                        'value_kes': int(p1), 'installment': 1})
            d2 = d + timedelta(days=random.randint(14,30))
            p2 = val - p1
            if p2 > 0: pay.append({'payment_id': f'PAY-{random.randint(10000,99999)}', 'invoice_id': r['invoice_id'], 
                        'omc_id': r['omc_id'], 'customer_name': r['customer_name'], 'date': d2.strftime('%Y-%m-%d'), 
                        'value_kes': int(p2), 'installment': 2})
        else:
            if random.random() < CONFIG["underpay"]: val *= random.uniform(0.75, 0.99)
            pay.append({'payment_id': f'PAY-{random.randint(10000,99999)}', 'invoice_id': r['invoice_id'], 
                        'omc_id': r['omc_id'], 'customer_name': r['customer_name'], 'date': d.strftime('%Y-%m-%d'), 
                        'value_kes': int(val), 'installment': 1})
    return pd.DataFrame(pay)

def generate_ledger(dispatches_df):
    records = []
    start = datetime(2025,1,1)
    balances = {}
    for depot in DEPOTS:
        for product in PRODUCTS:
            balances[(depot, product)] = random.randint(500000, 2000000)
    for day in range(365):
        d = start + timedelta(days=day)
        for (depot, product) in balances.keys():
            opening = balances[(depot, product)]
            inbound = random.randint(100000, 500000) if random.random() < 0.3 else 0
            outbound = dispatches_df[(dispatches_df['depot']==depot) & (dispatches_df['product']==product) & (dispatches_df['date']==d.strftime('%Y-%m-%d'))]['volume_liters'].sum()
            theoretical = opening + inbound - outbound
            variance = -random.randint(0, 20000) if random.random() < 0.15 else 0
            physical = theoretical + variance
            records.append({'ledger_id': f'LGR-{len(records)+1:05d}', 'depot': depot, 'product': product, 
                            'date': d.strftime('%Y-%m-%d'), 'opening_balance': opening, 'inbound': int(inbound), 
                            'outbound': int(outbound), 'theoretical': int(theoretical), 'physical': int(physical), 
                            'variance': int(variance), 'reason': 'Reconciled' if variance==0 else random.choice(['Measurement Error','Theft','Evaporation'])})
            balances[(depot, product)] = physical
    return pd.DataFrame(records)

if __name__ == "__main__":
    os.makedirs('data/raw', exist_ok=True)
    omcs = generate_omc_master()
    disp = generate_dispatches(omcs)
    disp = inject_fraud_ring(disp, omcs)
    inv = generate_invoices(disp)
    pay = generate_payments(inv)
    ledger = generate_ledger(disp)
    omcs.to_csv('data/raw/omcs.csv', index=False)
    disp.to_csv('data/raw/dispatches.csv', index=False)
    inv.to_csv('data/raw/invoices.csv', index=False)
    pay.to_csv('data/raw/payments.csv', index=False)
    ledger.to_csv('data/raw/depot_ledger.csv', index=False)
    print("✅ Raw CSVs generated in data/raw/")