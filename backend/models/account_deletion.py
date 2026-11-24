"""A deletion request with a 30-day restore window (David, 2026-11-18: "hold a deleted account ... eligible for a restore,
for 30 days"). One row per account; services/account_deletion.py owns the rules."""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, DDL, String, event

from database import Base


def _now():
    return datetime.now(timezone.utc)


class AccountDeletion(Base):
    __tablename__ = 'account_deletions'
    profile_id = Column(String(36), primary_key=True)
    status = Column(String(12), nullable=False, default='pending', index=True)   # pending|restored|purged|cancelled
    requested_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    purge_after = Column(DateTime(timezone=True), nullable=False, index=True)
    restore_token_hash = Column(String(64), nullable=True)        # SHA-256 of the emailed token; never the token
    restored_at = Column(DateTime(timezone=True), nullable=True)
    purged_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)   # the suspension was lifted by something else
    # Recorded, never inferred from the suspension text (advisor hold on #1062): a restore lifts ONLY the suspension
    # the deletion request itself imposed.
    prior_suspended = Column(Boolean, nullable=False, default=False)   # already suspended/banned when requested
    moderation_hold = Column(Boolean, nullable=False, default=False)   # moderation touched it during the window


# Locked like the MFA tables (advisor hold on #1062): only the backend's service role may read or write.
for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
):
    event.listen(AccountDeletion.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))

class ModerationHold(Base):
    """Moderation state that outlives the erasure. `open_case_flagged_at` records that the day-30 erasure was skipped
    because a moderation case was open. (Violation rows are kept, with no expiry: David, 2026-11-19, "Keep the ban
    evidence, only wipe GPS and notes".)"""
    __tablename__ = 'moderation_holds'
    profile_id = Column(String(36), primary_key=True)
    open_case_flagged_at = Column(DateTime(timezone=True), nullable=True)


for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
):
    event.listen(ModerationHold.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))

import services.account_deletion  # noqa: E402,F401 - registers the cancel/hold database hook with the models
