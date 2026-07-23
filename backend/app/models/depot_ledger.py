"""
DepotLedger model — daily depot variance snapshot.

STALE as of the tariffs/loading-logs ETL rewrite: scripts/etl_pipeline.py
no longer creates a depot_ledger table at all — it's been replaced by
depot_daily_inventory (different columns entirely: record_id/date/depot/
product/opening_stock_liters/received_pipeline_liters/dispatched_liters/
book_closing_stock_liters/physical_dip_closing_stock_liters/
variance_liters, no ORM model yet). Querying DepotLedger via the ORM will
hit a "table does not exist" error against a real DB — this class was
already unused by any service/route before the rewrite, so nothing broke,
but it's now describing a table that plain doesn't get created either.
Kept rather than deleted since Depot.ledger_entries/Product.ledger_entries
relationships reference it; replace with a real DepotDailyInventory model
if depot_daily_inventory ever needs ORM access.
"""
from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class DepotLedger(Base):
    __tablename__ = "depot_ledger"

    ledger_id = Column(Text, primary_key=True)
    depot = Column(Text, ForeignKey("depots.depot_id"))
    product = Column(Text, ForeignKey("products.product_id"))
    date = Column(Text)  # kept TEXT to match the original SQLite type; consider DateTime if the format is consistent
    opening_balance = Column(Integer)
    inbound = Column(Integer)
    outbound = Column(Integer)
    theoretical = Column(Integer)
    physical = Column(Integer)
    variance = Column(Integer)
    reason = Column(Text)
    variance_abs = Column(Integer)

    depot_ref = relationship("Depot", back_populates="ledger_entries")
    product_ref = relationship("Product", back_populates="ledger_entries")
