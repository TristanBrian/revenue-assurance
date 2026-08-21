"""
StipendAuthorization model — an officer's sign-off on eligible attendance
(outbound domain equivalent of invoice.py). attendance_id NULL would be
the outbound "ghost load" case; unlike inbound, the generator doesn't
currently produce that variant (see disbursement.py's Ghost Payment note
for the outbound anomaly this domain actually injects instead).
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class StipendAuthorization(Base):
    __tablename__ = "stipend_authorizations"
    __table_args__ = (Index("idx_authorization_beneficiary", "beneficiary_id"),)

    authorization_id = Column(Text, primary_key=True)
    attendance_id = Column(Text, ForeignKey("attendance.attendance_id"))
    beneficiary_id = Column(Text, ForeignKey("beneficiaries.beneficiary_id"))
    pillar_id = Column(Text, ForeignKey("pillars.pillar_id"))
    period = Column(Text)
    date = Column(DateTime)
    amount_authorized = Column(Integer)
    authorized_by = Column(Text, ForeignKey("officers.officer_id"))

    attendance = relationship("Attendance", back_populates="authorization")
    disbursements = relationship("Disbursement", back_populates="authorization")
