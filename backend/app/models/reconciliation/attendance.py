"""
Attendance model — the outbound domain's eligibility event (equivalent of
dispatch.py: the raw transactional record everything else chains off of).
Raw transactional data — only the PK is NOT NULL; nulls elsewhere expected.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import relationship

from app.utils.db_connection import Base


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (Index("idx_attendance_period", "period"),)

    attendance_id = Column(Text, primary_key=True)
    beneficiary_id = Column(Text, ForeignKey("beneficiaries.beneficiary_id"))
    officer_id = Column(Text, ForeignKey("officers.officer_id"))
    pillar_id = Column(Text, ForeignKey("pillars.pillar_id"))
    period = Column(Text)  # "YYYY-MM"
    attendance_date = Column(DateTime)
    verified_at = Column(DateTime)
    eligible_amount_kes = Column(Integer)
    status = Column(Text)

    authorization = relationship("StipendAuthorization", back_populates="attendance", uselist=False)
