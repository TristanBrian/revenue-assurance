CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;

-- Clean slate: Drop existing tables to ensure the new columns are added
DROP TABLE IF EXISTS bronze.raw_o2c_events CASCADE;
DROP TABLE IF EXISTS silver.dispatches CASCADE;
DROP TABLE IF EXISTS silver.invoices CASCADE;
DROP TABLE IF EXISTS silver.payments CASCADE;
DROP TABLE IF EXISTS gold.omc_revenue_summary CASCADE;

-- BRONZE: Raw, untyped JSON payload (Append Only)
CREATE TABLE bronze.raw_o2c_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50),
    payload JSONB,
    ingested_at TIMESTAMP DEFAULT NOW(),
    is_processed BOOLEAN DEFAULT FALSE
);

-- SILVER: Cleaned, structured, and validated tables
CREATE TABLE silver.dispatches (
    dispatch_id VARCHAR(50) PRIMARY KEY,
    date DATE,
    omc_id VARCHAR(20),
    product VARCHAR(10),
    depot VARCHAR(50),
    volume_liters NUMERIC(15, 2),
    value_kes NUMERIC(15, 2),
    truck_reg_number VARCHAR(20),      -- NEW: Fleet tracking for network graphs
    driver_id VARCHAR(20)              -- NEW: Driver tracking for network graphs
);

CREATE TABLE silver.invoices (
    invoice_id VARCHAR(50) PRIMARY KEY,
    dispatch_id VARCHAR(50),
    omc_id VARCHAR(20),
    date DATE,
    value_kes NUMERIC(15, 2)
);

CREATE TABLE silver.payments (
    payment_id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(50),
    omc_id VARCHAR(20),
    date DATE,
    value_kes NUMERIC(15, 2),
    remitting_bank_account VARCHAR(50) -- NEW: Financial tracking for network graphs
);

-- GOLD: Business-level Aggregations for the Null_Terminators' frontend/backend
CREATE TABLE gold.omc_revenue_summary (
    omc_id VARCHAR(20) PRIMARY KEY,
    total_dispatched_value NUMERIC(15, 2) DEFAULT 0,
    total_invoiced_value NUMERIC(15, 2) DEFAULT 0,
    total_paid_value NUMERIC(15, 2) DEFAULT 0,
    unbilled_leakage NUMERIC(15, 2) GENERATED ALWAYS AS (total_dispatched_value - total_invoiced_value) STORED,
    outstanding_balance NUMERIC(15, 2) GENERATED ALWAYS AS (total_invoiced_value - total_paid_value) STORED,
    last_updated TIMESTAMP DEFAULT NOW()
);