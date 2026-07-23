"""
Depot model — depot master data. depot_id reuses the existing free-text
depot values (e.g. "Nairobi", "Mombasa") as its natural key — normalized
here since it's a known, fixed physical list, same treatment as omc.py.
"""
from sqlalchemy import Boolean, Column, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Depot(Base):
    __tablename__ = "depots"

    depot_id = Column(Text, primary_key=True)
    depot_name = Column(Text, nullable=False)
    location = Column(Text)  # ASSUMPTION: placeholder field, adjust/remove if not tracked
    capacity_litres = Column(Integer)  # ASSUMPTION: placeholder field, adjust/remove if not tracked
    is_active = Column(Boolean, default=True)

    dispatches = relationship("Dispatch", back_populates="depot_ref")
    ledger_entries = relationship("DepotLedger", back_populates="depot_ref")
