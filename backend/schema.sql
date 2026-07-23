-- ============================================================================
-- KPC Revenue Assurance Platform — Postgres schema
-- Rebuilds the reconciliation-domain tables confirmed to exist in the
-- working SQLite DB, plus products (added to support pricing and
-- product-mismatch checks for reconciliation / fraud detection).
-- No e-billing tables included — ebilling_sync/ebilling_dlq/ebilling_webhook_log
-- ARE real persisted tables (created at runtime by
-- app/services/e_billing.py's init_ebilling_tables()), just not included in
-- this file. Add them here the same way if you want them version-controlled
-- DDL instead of created ad hoc at first use.
--
-- Nullability rule applied:
--   - omcs / products = master data, assumed pre-existing/curated ->
--     identity/primary fields are NOT NULL.
--   - dispatches / invoices / payments / depot_ledger = raw transactional
--     data -> only the primary key is NOT NULL. Nulls elsewhere are expected
--     and meaningful (e.g. invoices.dispatch_id NULL = ghost load,
--     payments.invoice_id NULL = unmatched payment).
--
-- This file is documentation/reference only for tables 1, 3-8 — none of
-- those have been applied to the live kpc database. The app currently
-- builds them via scripts/etl_pipeline.py's pandas .to_sql(if_exists=
-- 'replace'), not this DDL (which also means none of the REFERENCES below
-- are actually enforced as live constraints today for those tables —
-- to_sql creates plain, unconstrained tables). See app/models/*.py for the
-- matching SQLAlchemy ORM classes (not yet wired into the services, which
-- still use raw pd.read_sql).
--
-- quota_ledger (table 2) is the ONE EXCEPTION: unlike the rest of this
-- file, it IS Alembic-managed and has actually been applied via
-- `alembic upgrade head` — see alembic/versions/. There's no ETL generator
-- producing quota data, so it doesn't compete with that mechanism the way
-- the others do.
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
-- 2. quota_ledger — lightweight OMC quota tracking, laying the groundwork
--    for future quota-drift/breach detection. Deliberately minimal — one
--    row per OMC, updated periodically, not an event log. No service/route
--    reads or writes this yet; only the schema exists so far. See
--    app/models/quota_ledger.py.
--    omc_id is NOT a REFERENCES/FK to omcs: omcs is dropped and recreated
--    by scripts/etl_pipeline.py's pandas .to_sql(if_exists='replace') every
--    run, and a live FK from this Alembic-managed table would make Postgres
--    block that DROP on every future ETL run.
-- ----------------------------------------------------------------------------
CREATE TABLE quota_ledger (
    omc_id                TEXT PRIMARY KEY,
    base_quota_litres     INTEGER,
    current_quota_litres  INTEGER,   -- base_quota + trailing-offtake adjustment
    trailing_window_days  INTEGER DEFAULT 30,
    last_recalculated_at  TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. depots — depot master data (depot showed up as free text in
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
-- 4. products — product reference data. product_id is the bare official
--    KPC/EPRA fuel code (PMS/AGO/DPK), matching what
--    scripts/generate_kpc_data.py now generates directly into
--    dispatches/invoices/depot_ledger.product (it used to store the full
--    display string "Petrol (PMS)" etc. — changed to store just "PMS" so
--    this FK actually matches).
--
--    4 non-fuel codes (JETA1, HFO, LPG, LUB) are included too, even though
--    they're outside the official PMS/AGO/DPK set — they already exist in
--    the generator, and JETA1/LPG specifically are the values used for
--    fraud injection there. Without them here, any dispatch carrying one of
--    those would violate this FK.
-- ----------------------------------------------------------------------------
CREATE TABLE products (
    product_id       TEXT PRIMARY KEY,   -- e.g. "PMS", "AGO", "DPK", "JETA1", "HFO", "LPG", "LUB"
    product_name     TEXT NOT NULL,      -- e.g. "Premium Motor Spirit (Petrol)"
    unit_price_kes   NUMERIC(10,2),      -- current price per litre; NULL for the 4 non-fuel codes with no real price basis in this dataset. Not used in any dispatch/invoice value calc today (those are tariff-based) — this only tracks the CURRENT price, not a history; a product_price_history table (effective_from/effective_to) would be needed if historical dispatches ever need validating against the price in effect on their own date.
    is_active        BOOLEAN DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 5. dispatches — the physical fuel-out-of-depot event (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE dispatches (
    dispatch_id          TEXT PRIMARY KEY,
    date                 TIMESTAMP,
    year                 INTEGER,
    month                INTEGER,
    omc_id               TEXT REFERENCES omcs(omc_id),
    customer_name        TEXT,
    product               TEXT REFERENCES products(product_id),
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
-- 6. invoices — KPC's bill to the OMC for a dispatch (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    invoice_id     TEXT PRIMARY KEY,
    dispatch_id    TEXT REFERENCES dispatches(dispatch_id),  -- NULL = ghost load (dispatch with no matching invoice)
    omc_id         TEXT REFERENCES omcs(omc_id),
    customer_name  TEXT,
    product        TEXT REFERENCES products(product_id),
    date           TIMESTAMP,
    value_kes      INTEGER
);

CREATE INDEX idx_invoice_omc ON invoices (omc_id);

-- ----------------------------------------------------------------------------
-- 7. payments — money received against an invoice (raw, PK-only NOT NULL)
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
-- 8. depot_ledger — daily depot variance snapshot (raw, PK-only NOT NULL)
-- ----------------------------------------------------------------------------
CREATE TABLE depot_ledger (
    ledger_id        TEXT PRIMARY KEY,
    depot            TEXT REFERENCES depots(depot_id),
    product          TEXT REFERENCES products(product_id),
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
