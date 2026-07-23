-- ============================================================================
-- KPC Revenue Assurance Platform — Postgres schema
-- Rebuilds the 5 tables confirmed to exist in the working SQLite DB.
-- No e-billing tables included — ebilling_sync/ebilling_dlq/ebilling_webhook_log
-- ARE real persisted tables (created at runtime by
-- app/services/e_billing.py's init_ebilling_tables()), just not included in
-- this file. Add them here the same way if you want them version-controlled
-- DDL instead of created ad hoc at first use.
--
-- Nullability rule applied:
--   - omcs = master data, assumed pre-existing/curated -> identity/primary
--     fields are NOT NULL.
--   - dispatches / invoices / payments / depot_ledger = raw transactional
--     data -> only the primary key is NOT NULL. Nulls elsewhere are expected
--     and meaningful (e.g. invoices.dispatch_id NULL = ghost load,
--     payments.invoice_id NULL = unmatched payment).
--
-- This file is documentation/reference only — it has not been applied to
-- the live kpc database. The app currently builds these tables via
-- scripts/etl_pipeline.py's pandas .to_sql(if_exists='replace'), not this
-- DDL. See app/models/reconciliation.py for the matching SQLAlchemy ORM
-- classes (not yet wired into the services, which still use raw pd.read_sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. omcs — customer/OMC master data
-- ----------------------------------------------------------------------------
CREATE TABLE omcs (
    omc_id              TEXT PRIMARY KEY,
    customer_name       TEXT NOT NULL,
    kra_pin             TEXT NOT NULL,   -- TEXT not INTEGER: real KRA PINs are alphanumeric (e.g. P051234567A)
    payment_terms_days  INTEGER,
    credit_limit_kes    INTEGER,
    risk_rating         TEXT,
    contact_email       TEXT,
    phone               TEXT,
    is_active           BOOLEAN DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 2. depots — depot master data (NEW: depot showed up as free text in
--    dispatches/depot_ledger with no backing table — normalizing it here,
--    same treatment as omcs since it's a known, fixed physical list)
-- ----------------------------------------------------------------------------
CREATE TABLE depots (
    depot_id         TEXT PRIMARY KEY,   -- reuses existing depot text values (e.g. "Nairobi", "Mombasa") as the natural key
    depot_name       TEXT NOT NULL,
    location         TEXT,               -- ASSUMPTION: placeholder field, adjust/remove if not tracked
    capacity_litres  INTEGER,            -- ASSUMPTION: placeholder field, adjust/remove if not tracked
    is_active        BOOLEAN DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 3. dispatches — the physical fuel-out-of-depot event (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE dispatches (
    dispatch_id          TEXT PRIMARY KEY,
    date                 TIMESTAMP,
    year                 INTEGER,
    month                INTEGER,
    omc_id               TEXT REFERENCES omcs(omc_id),
    customer_name        TEXT,
    product               TEXT,
    depot                TEXT REFERENCES depots(depot_id),
    volume_liters        INTEGER,
    distance_km          INTEGER,
    transport_tariff_kes INTEGER,
    storage_tariff_kes   INTEGER,
    value_kes            INTEGER,
    risk_rating          TEXT,     -- denormalized snapshot from omcs at dispatch time — may drift, by design
    credit_limit_kes     INTEGER,  -- denormalized snapshot from omcs at dispatch time — may drift, by design
    data_quality_flag    TEXT
);

CREATE INDEX idx_dispatch_date ON dispatches (date);

-- ----------------------------------------------------------------------------
-- 4. invoices — KPC's bill to the OMC for a dispatch (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    invoice_id     TEXT PRIMARY KEY,
    dispatch_id    TEXT REFERENCES dispatches(dispatch_id),  -- NULL = ghost load (dispatch with no matching invoice)
    omc_id         TEXT REFERENCES omcs(omc_id),
    customer_name  TEXT,
    product        TEXT,
    date           TIMESTAMP,
    value_kes      INTEGER
);

CREATE INDEX idx_invoice_omc ON invoices (omc_id);

-- ----------------------------------------------------------------------------
-- 5. payments — money received against an invoice (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE payments (
    payment_id      TEXT PRIMARY KEY,
    invoice_id      TEXT REFERENCES invoices(invoice_id),  -- NULL = unmatched/unallocated payment
    total_paid_kes  INTEGER,
    omc_id          TEXT REFERENCES omcs(omc_id),
    customer_name   TEXT,
    date            TIMESTAMP,
    installment     INTEGER
);

CREATE INDEX idx_payment_invoice ON payments (invoice_id);

-- ----------------------------------------------------------------------------
-- 6. depot_ledger — daily depot variance snapshot (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE depot_ledger (
    ledger_id        TEXT PRIMARY KEY,
    depot            TEXT REFERENCES depots(depot_id),
    product          TEXT,
    date             TEXT,   -- kept as TEXT to match original SQLite type; consider DATE if format is consistent
    opening_balance  INTEGER,
    inbound          INTEGER,
    outbound         INTEGER,
    theoretical      INTEGER,
    physical         INTEGER,
    variance         INTEGER,
    reason           TEXT,
    variance_abs     INTEGER
);
