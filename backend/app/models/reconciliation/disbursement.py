"""
Disbursement model — a mobile-money/bank payout to a beneficiary (outbound
domain equivalent of payment.py). authorization_id NULL is the deliberate
Ghost Payment signal (see scripts/generate_kpc_data.py's
generate_disbursements()) — a disbursement with no backing authorization
at all, not a data-quality defect. One authorization can have several
disbursements (installments), same as payment.py's invoice_id relationship.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Disbursement(Base):
    __tablename__ = "disbursements"
    __table_args__ = (Index("idx_disbursement_authorization", "authorization_id"),)

    disbursement_id = Column(Text, primary_key=True)
    authorization_id = Column(Text, ForeignKey("stipend_authorizations.authorization_id"))
    beneficiary_id = Column(Text, ForeignKey("beneficiaries.beneficiary_id"))
    pillar_id = Column(Text, ForeignKey("pillars.pillar_id"))
    period = Column(Text)
    date = Column(DateTime)
    amount_paid = Column(Integer)
    channel = Column(Text)  # "mobile_money" | "bank"
    disbursing_account = Column(Text)

    authorization = relationship("StipendAuthorization", back_populates="disbursements")
