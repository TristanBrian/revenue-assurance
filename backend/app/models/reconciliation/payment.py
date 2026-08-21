"""
Payment model — money received against an invoice. invoice_id NULL =
unmatched/unallocated payment. One invoice can have several payments
(installments) — see scripts/etl_pipeline.py's groupby('invoice_id')
aggregation.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (Index("idx_payment_invoice", "invoice_id"),)

    payment_id = Column(Text, primary_key=True)
    invoice_id = Column(Text, ForeignKey("invoices.invoice_id"))
    total_paid_kes = Column(Integer)
    omc_id = Column(Text, ForeignKey("omcs.omc_id"))
    customer_name = Column(Text)
    date = Column(DateTime)
    installment = Column(Integer)

    invoice = relationship("Invoice", back_populates="payments")
    omc = relationship("OMC", back_populates="payments")
