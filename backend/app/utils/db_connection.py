"""
Database Utility - Singleton connection for FastAPI services
"""
import sqlite3
import pandas as pd
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')

def get_connection():
    """Returns a SQLite connection object."""
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Database not found at {DB_PATH}. Run ETL pipeline first.")
    return sqlite3.connect(DB_PATH)

def load_table(table_name):
    """Loads an entire table as a Pandas DataFrame."""
    conn = get_connection()
    df = pd.read_sql(f"SELECT * FROM {table_name}", conn)
    conn.close()
    return df

def execute_query(query, params=None):
    """Executes a raw SQL query (for custom joins)."""
    conn = get_connection()
    if params:
        df = pd.read_sql(query, conn, params=params)
    else:
        df = pd.read_sql(query, conn)
    conn.close()
    return df

# Quick test if run directly
if __name__ == "__main__":
    try:
        df = load_table("dispatches")
        print(f"✅ DB Connection successful. Loaded {len(df)} dispatches.")
    except Exception as e:
        print(f"❌ DB Error: {e}")