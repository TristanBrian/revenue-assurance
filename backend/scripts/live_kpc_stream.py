"""
KPC Revenue Assurance - Live Medallion Architecture Stream
---------------------------------------------------------------
Simulates real-time Order-to-Cash (O2C) events (Dispatches, Invoices, Payments).
*UPDATED: Now injects live Network Graph anomalies (shared fleets & bank accounts)
into the stream to simulate active shell companies.*
"""
import os
import time
import random
import json
import logging
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# ==========================================
# 1. LOGGING & CONFIGURATION
# ==========================================
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("MedallionStream")

POSTGRES_URI = os.getenv("DATABASE_URL")
if POSTGRES_URI and POSTGRES_URI.startswith("postgres://"):
    POSTGRES_URI = POSTGRES_URI.replace("postgres://", "postgresql://", 1)

engine = create_engine(POSTGRES_URI, pool_pre_ping=True)

# Domain Constants
PRODUCTS = ["PMS", "AGO", "DPK", "JETA1", "HFO", "LPG", "LUB"]
DEPOTS = ["Mombasa (KOSF)", "Mombasa (Kipevu)", "Nairobi", "Kisumu", "Eldoret"]

# --- SHELL COMPANY NETWORK GRAPH CONSTANTS ---
SHELL_OMCS = ["OMC-018", "OMC-019", "OMC-020"]
SHARED_BANK_ACCOUNT = "KE9900000666666666" # The central fraud ring account
SHARED_FLEET = ["KCD-999X", "KCD-888Y", "KCD-777Z"] # The ghost fleet
SHARED_DRIVERS = ["DRV-001", "DRV-002"] 

# ==========================================
# 2. LIVE EVENT GENERATORS
# ==========================================
def generate_dispatch_event() -> dict:
    """Simulates a live commercial dispatch waybill with fleet logistics."""
    vol = round(random.uniform(20000, 60000), 0)
    dist = random.choice([10, 5, 450, 650, 700])
    val = round((vol / 1000) * 5.53 * dist + (vol / 1000) * 1000.0, 0)
    omc_id = f"OMC-{random.randint(1, 20):03d}"
    
    # Inject Shared Fleet Logic for Shell Companies
    if omc_id in SHELL_OMCS:
        truck = random.choice(SHARED_FLEET)
        driver = random.choice(SHARED_DRIVERS)
    else:
        truck = f"K{random.choice(['A','B'])}{random.randint(10,99)}{random.choice(['F','G','H'])}"
        driver = f"DRV-{random.randint(10000,99999)}"
    
    return {
        "dispatch_id": f"DISP-{random.randint(100000, 999999)}",
        "omc_id": omc_id,
        "date": datetime.utcnow().strftime('%Y-%m-%d'),
        "product": random.choice(PRODUCTS),
        "depot": random.choice(DEPOTS),
        "volume_liters": int(vol),
        "value_kes": int(val),
        "truck_reg_number": truck,
        "driver_id": driver
    }

def generate_invoice_event(dispatch: dict) -> dict:
    """Simulates generating an invoice from a dispatch (with occasional leakage)."""
    if random.random() < 0.05: # 5% Invoice Leakage (Unbilled)
        return None 
        
    return {
        "invoice_id": f"INV-{random.randint(100000, 999999)}",
        "dispatch_id": dispatch["dispatch_id"],
        "omc_id": dispatch["omc_id"],
        "date": (datetime.utcnow() + timedelta(days=random.randint(1, 5))).strftime('%Y-%m-%d'),
        "value_kes": dispatch["value_kes"] * random.uniform(0.98, 1.05) # Tariff errors
    }

def generate_payment_event(invoice: dict) -> dict:
    """Simulates a payment against an invoice with bank account mapping."""
    if random.random() < 0.08: # 8% Payment Leakage (Bad Debt)
        return None
        
    # Inject Shared Bank Account Logic for Shell Companies
    if invoice["omc_id"] in SHELL_OMCS:
        bank_acc = SHARED_BANK_ACCOUNT
    else:
        bank_acc = f"KE{random.randint(10,99)}0000{random.randint(1000000,9999999)}"
        
    return {
        "payment_id": f"PAY-{random.randint(100000, 999999)}",
        "invoice_id": invoice["invoice_id"],
        "omc_id": invoice["omc_id"],
        "remitting_bank_account": bank_acc,
        "date": (datetime.utcnow() + timedelta(days=random.randint(10, 30))).strftime('%Y-%m-%d'),
        "value_kes": invoice["value_kes"] * random.uniform(0.80, 1.0) # Underpayments
    }

# ==========================================
# 3. MEDALLION PIPELINE STAGES
# ==========================================
def ingest_to_bronze(conn, event_type: str, payload: dict):
    """Appends raw, untyped JSON data to the Bronze layer."""
    if not payload:
        return
    conn.execute(
        text("""
            INSERT INTO bronze.raw_o2c_events (event_type, payload, ingested_at, is_processed)
            VALUES (:event_type, :payload, NOW(), FALSE)
        """),
        {"event_type": event_type, "payload": json.dumps(payload)}
    )

def process_bronze_to_silver(conn) -> int:
    """
    Extracts JSON fields, enforces data types, and moves to Silver.
    *Updated to map the new network graph features (trucks, drivers, bank accounts)*
    """
    # 1. Process Dispatches (Now captures fleet data)
    conn.execute(text("""
        WITH unprocessed AS (
            SELECT id, payload FROM bronze.raw_o2c_events 
            WHERE event_type = 'dispatch' AND is_processed = FALSE
        ),
        inserted AS (
            INSERT INTO silver.dispatches (dispatch_id, date, omc_id, product, depot, volume_liters, value_kes, truck_reg_number, driver_id)
            SELECT 
                payload->>'dispatch_id', (payload->>'date')::DATE, payload->>'omc_id',
                payload->>'product', payload->>'depot', 
                (payload->>'volume_liters')::NUMERIC, (payload->>'value_kes')::NUMERIC,
                payload->>'truck_reg_number', payload->>'driver_id'
            FROM unprocessed
            ON CONFLICT (dispatch_id) DO NOTHING
            RETURNING 1
        )
        UPDATE bronze.raw_o2c_events SET is_processed = TRUE 
        WHERE id IN (SELECT id FROM unprocessed);
    """))

    # 2. Process Invoices (Unchanged)
    conn.execute(text("""
        WITH unprocessed AS (
            SELECT id, payload FROM bronze.raw_o2c_events 
            WHERE event_type = 'invoice' AND is_processed = FALSE
        ),
        inserted AS (
            INSERT INTO silver.invoices (invoice_id, dispatch_id, omc_id, date, value_kes)
            SELECT 
                payload->>'invoice_id', payload->>'dispatch_id', payload->>'omc_id',
                (payload->>'date')::DATE, (payload->>'value_kes')::NUMERIC
            FROM unprocessed
            ON CONFLICT (invoice_id) DO NOTHING
            RETURNING 1
        )
        UPDATE bronze.raw_o2c_events SET is_processed = TRUE 
        WHERE id IN (SELECT id FROM unprocessed);
    """))

    # 3. Process Payments (Now captures bank account data)
    result = conn.execute(text("""
        WITH unprocessed AS (
            SELECT id, payload FROM bronze.raw_o2c_events 
            WHERE event_type = 'payment' AND is_processed = FALSE
        ),
        inserted AS (
            INSERT INTO silver.payments (payment_id, invoice_id, omc_id, date, value_kes, remitting_bank_account)
            SELECT 
                payload->>'payment_id', payload->>'invoice_id', payload->>'omc_id',
                (payload->>'date')::DATE, (payload->>'value_kes')::NUMERIC,
                payload->>'remitting_bank_account'
            FROM unprocessed
            ON CONFLICT (payment_id) DO NOTHING
            RETURNING 1
        )
        UPDATE bronze.raw_o2c_events SET is_processed = TRUE 
        WHERE event_type IN ('dispatch', 'invoice', 'payment') AND is_processed = FALSE;
    """))
    return result.rowcount

def process_silver_to_gold(conn):
    """
    Aggregates Clean Silver data into Gold business tables.
    """
    conn.execute(text("""
        INSERT INTO gold.omc_revenue_summary (omc_id, total_dispatched_value, total_invoiced_value, total_paid_value, last_updated)
        WITH dispatch_aggs AS (
            SELECT omc_id, SUM(value_kes) as total_disp FROM silver.dispatches GROUP BY omc_id
        ),
        invoice_aggs AS (
            SELECT omc_id, SUM(value_kes) as total_inv FROM silver.invoices GROUP BY omc_id
        ),
        payment_aggs AS (
            SELECT omc_id, SUM(value_kes) as total_pay FROM silver.payments GROUP BY omc_id
        )
        SELECT 
            d.omc_id, 
            COALESCE(d.total_disp, 0), 
            COALESCE(i.total_inv, 0), 
            COALESCE(p.total_pay, 0), 
            NOW()
        FROM dispatch_aggs d
        LEFT JOIN invoice_aggs i ON d.omc_id = i.omc_id
        LEFT JOIN payment_aggs p ON d.omc_id = p.omc_id
        ON CONFLICT (omc_id) DO UPDATE SET
            total_dispatched_value = EXCLUDED.total_dispatched_value,
            total_invoiced_value = EXCLUDED.total_invoiced_value,
            total_paid_value = EXCLUDED.total_paid_value,
            last_updated = EXCLUDED.last_updated;
    """))

# ==========================================
# 4. STREAMING LOOP
# ==========================================
def run_live_simulation(interval_seconds: int = 4):
    logger.info("🚀 Starting Live KPC Revenue Medallion Stream (With Network Graph Anomaly Injection)")
    logger.info("Press Ctrl+C to stop.")
    
    try:
        while True:
            with engine.begin() as conn:
                # 1. Generate a micro-batch of events
                dispatch = generate_dispatch_event()
                invoice = generate_invoice_event(dispatch)
                payment = generate_payment_event(invoice) if invoice else None

                # 2. Ingest to Bronze (Raw JSON)
                ingest_to_bronze(conn, 'dispatch', dispatch)
                ingest_to_bronze(conn, 'invoice', invoice)
                ingest_to_bronze(conn, 'payment', payment)
                
                logger.info(f"📥 Ingested new Order-to-Cash cycle for {dispatch['omc_id']} to Bronze.")

                # 3. Transform Bronze -> Silver (Clean & Enforce Types)
                process_bronze_to_silver(conn)

                # 4. Aggregate Silver -> Gold (Business Logic)
                process_silver_to_gold(conn)
                logger.info("🥇 Updated Gold OMC revenue summaries.")
            
            time.sleep(interval_seconds)
            
    except KeyboardInterrupt:
        logger.info("🛑 Live simulation stopped manually.")
    except Exception as e:
        logger.error(f"❌ Pipeline failed: {e}")

if __name__ == "__main__":
    # Simulates continuous O2C cycles flowing every 4 seconds
    run_live_simulation(interval_seconds=4)