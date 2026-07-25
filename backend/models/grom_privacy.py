"""Guardian relationships for Grom media controls.

The legacy ``profiles.parent_id`` remains the compatibility link. This table
supports multiple verified guardians without allowing client-managed authority.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String

from database import Base


class GromGuardian(Base):
    __tablename__ = 'grom_guardians'

    grom_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), primary_key=True)
    guardian_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
