"""Two-sided guardian link proof: child-generated codes and parent-initiated invites.

A guardian link is CONFIRMED only when both sides took part (policy: minors-guardian, level L1):
  * ``child_code``      the CHILD's own account generates a code and hands it to the adult, who redeems it; or
  * ``parent_invite``   an adult proposes a link to a specific child and the CHILD's account confirms it.

One row = one single-use proof, bound to one child, valid 48 hours. A code is stored only as a keyed hash
(``code_hash``), so a database read never yields a usable code. Neither kind links anything by itself: the link
lives on ``profiles.parent_id`` + ``parent_link_approved`` (the compatibility link every guard reads) and in
``grom_guardians`` (the verified relationship record); both are written in ``services/guardian_links.py``, in the
same transaction that consumes the row.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, String

from database import Base
from .base import generate_uuid


class GuardianLinkCode(Base):
    __tablename__ = 'guardian_link_codes'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    # The child this proof is bound to. A proof never works for any other account.
    grom_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    kind = Column(String(16), nullable=False)  # 'child_code' | 'parent_invite'
    # parent_invite: the adult who proposed the link. child_code: NULL until an adult redeems it.
    guardian_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=True, index=True)
    code_hash = Column(String(64), nullable=True, unique=True)  # child_code only (keyed hash, never the code)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    consumed_by = Column(String(36), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index('ix_guardian_link_codes_open', 'grom_id', 'kind', 'consumed_at', 'revoked_at'),
    )
