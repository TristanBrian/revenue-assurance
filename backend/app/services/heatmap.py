# backend/app/services/heatmap.py
"""
Heatmap Service – Aggregates leakage by OMC and Product.
"""
import pandas as pd
import sqlite3
import os
from app.services.reconciliation import run_reconciliation

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')


def get_heatmap_data(materiality: float = 0) -> dict:
    """
    Returns a pivot table of leakage (KSh) by customer (OMC) and product.
    """
    # Run reconciliation to get all anomalies (materiality=0 to include everything)
    result = run_reconciliation(materiality=materiality)
    anomalies = result.get('anomalies', [])
    
    if not anomalies:
        return {
            'data': [],
            'omcs': [],
            'products': [],
            'total_leakage': 0
        }
    
    # Convert to DataFrame
    df = pd.DataFrame(anomalies)
    
    # If no leakage data, return empty
    if df.empty or 'leakage_kes' not in df.columns:
        return {
            'data': [],
            'omcs': [],
            'products': [],
            'total_leakage': 0
        }
    
    # Pivot table: rows = customer, columns = product, values = leakage_kes
    pivot = df.pivot_table(
        index='customer',
        columns='product',
        values='leakage_kes',
        aggfunc='sum',
        fill_value=0
    )
    
    # Sort by total leakage per OMC (descending)
    pivot['total'] = pivot.sum(axis=1)
    pivot = pivot.sort_values('total', ascending=False).drop('total', axis=1)
    
    # Convert to JSON‑friendly format
    omcs = pivot.index.tolist()
    products = pivot.columns.tolist()
    data = pivot.values.tolist()
    
    return {
        'data': data,
        'omcs': omcs,
        'products': products,
        'total_leakage': float(df['leakage_kes'].sum())
    }