"""
Dispatch model — the physical fuel-out-of-depot event. Raw transactional
data — only the PK is NOT NULL; nulls elsewhere are expected.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Dispatch(Base):
    __tablename__ = "dispatches"
    __table_args__ = (Index("idx_dispatch_date", "date"),)

    dispatch_id = Column(Text, primary_key=True)
    date = Column(DateTime)
    year = Column(Integer)
    month = Column(Integer)
    omc_id = Column(Text, ForeignKey("omcs.omc_id"))
    customer_name = Column(Text)
    product = Column(Text, ForeignKey("products.product_id"))
    depot = Column(Text, ForeignKey("depots.depot_id"))
    volume_liters = Column(Integer)
    distance_km = Column(Integer)
    transport_tariff_kes = Column(Integer)
    storage_tariff_kes = Column(Integer)
    value_kes = Column(Integer)
    risk_rating = Column(Text)  # denormalized snapshot from omcs at dispatch time — may drift, by design
    credit_limit_kes = Column(Integer)  # denormalized snapshot from omcs at dispatch time — may drift, by design
    data_quality_flag = Column(Text)

    omc = relationship("OMC", back_populates="dispatches")
    depot_ref = relationship("Depot", back_populates="dispatches")
    product_ref = relationship("Product", back_populates="dispatches")
    invoice = relationship("Invoice", back_populates="dispatch", uselist=False)
