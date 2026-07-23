"""
Product model — product reference/master data.

product_id uses the official KPC/EPRA fuel codes (PMS, AGO, DPK) plus 4
non-fuel/other values that already exist in the synthetic data generator
(JETA1, HFO, LPG, LUB — two of which, JETA1 and LPG, are specifically used
for fraud injection in scripts/generate_kpc_data.py). All 7 are included so
the FK from dispatch.py/invoice.py/depot_ledger.py doesn't break on
non-fuel or fraud-injected rows.

unit_price_kes is nullable: only PMS/AGO/DPK have a real per-litre price
basis. The other 4 have no established pricing in this dataset and are
left NULL rather than given an invented number.

Same caveat as omc.py/depot.py/dispatch.py etc. (see SCHEMA_NOTES.md):
dispatches/invoices/payments/products/depot_ledger are all loaded via
scripts/etl_pipeline.py's pandas .to_sql(if_exists='replace'), which
creates plain tables with no real constraints — the ForeignKey/relationship
below is ORM-level documentation of the intended relationship, not
currently an enforced DB constraint.
"""
from sqlalchemy import Boolean, Column, Numeric, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Product(Base):
    __tablename__ = "products"

    product_id = Column(Text, primary_key=True)  # e.g. "PMS", "AGO", "DPK", "JETA1", "HFO", "LPG", "LUB"
    product_name = Column(Text, nullable=False)  # e.g. "Premium Motor Spirit (Petrol)"
    unit_price_kes = Column(Numeric(10, 2), nullable=True)  # current price per litre; NULL for non-fuel/no-price-basis products
    is_active = Column(Boolean, default=True)

    dispatches = relationship("Dispatch", back_populates="product_ref")
    invoices = relationship("Invoice", back_populates="product_ref")
    ledger_entries = relationship("DepotLedger", back_populates="product_ref")
