"""
OMC model — customer/OMC master data. Assumed pre-existing/curated, so
identity fields are NOT NULL (unlike the raw transactional tables:
dispatch.py, invoice.py, payment.py, depot_ledger.py).
"""
from sqlalchemy import Boolean, Column, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class OMC(Base):
    __tablename__ = "omcs"

    omc_id = Column(Text, primary_key=True)
    customer_name = Column(Text, nullable=False)
    kra_pin = Column(Text, nullable=False)  # TEXT not INTEGER: real KRA PINs are alphanumeric (e.g. P051234567A)
    payment_terms_days = Column(Integer)
    credit_limit_kes = Column(Integer)
    risk_rating = Column(Text)
    contact_email = Column(Text)
    phone = Column(Text)
    is_active = Column(Boolean, default=True)

    dispatches = relationship("Dispatch", back_populates="omc")
    invoices = relationship("Invoice", back_populates="omc")
    payments = relationship("Payment", back_populates="omc")
