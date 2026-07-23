"""
Invoice model — KPC's bill to the OMC for a dispatch. dispatch_id NULL =
ghost load (dispatch with no matching invoice).
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (Index("idx_invoice_omc", "omc_id"),)

    invoice_id = Column(Text, primary_key=True)
    dispatch_id = Column(Text, ForeignKey("dispatches.dispatch_id"))
    omc_id = Column(Text, ForeignKey("omcs.omc_id"))
    customer_name = Column(Text)
    product = Column(Text, ForeignKey("products.product_id"))
    date = Column(DateTime)
    value_kes = Column(Integer)

    dispatch = relationship("Dispatch", back_populates="invoice")
    omc = relationship("OMC", back_populates="invoices")
    product_ref = relationship("Product", back_populates="invoices")
    payments = relationship("Payment", back_populates="invoice")
