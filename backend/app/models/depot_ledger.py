"""
DepotLedger model — daily depot variance snapshot. Not currently read by
any service or route — loaded into the DB by the ETL pipeline but
otherwise unused by the app today.
"""
from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class DepotLedger(Base):
    __tablename__ = "depot_ledger"

    ledger_id = Column(Text, primary_key=True)
    depot = Column(Text, ForeignKey("depots.depot_id"))
    product = Column(Text)
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
