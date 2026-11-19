"""Consent to use surf observations for forecast improvement (T1 P3).

Opt-in: no recorded choice means NO. The wording lives HERE, served to the app by GET /surf-observations/consent, so
the owner (or counsel) can change it without a frontend release; any change to the meaning bumps CONSENT_VERSION,
and every recorded choice and every observation names the version it was made under.

The DRAFT wording below is engineering's plain-language draft, not reviewed by counsel (David's call). It promises
only what the code does: off by default; what each used report carries (it is pseudonymous, NOT anonymous); and that
a withdrawal stops every LATER export from using any of the person's reports, earlier ones included (the export checks
the CURRENT choice as well as the one in force when each report was made). It does not promise that exports already
made are changed: nothing purges them on a withdrawal yet.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import SurfTruthConsentEvent

CONSENT_VERSION = "draft-2026-11-18b"     # b: the advisor's 11-18 review; the first draft overstated both promises
CONSENT_TITLE = "Use my wave reports to improve Raw Surf's forecasts"
# Each sentence maps to code. "spot, time to the minute, distances, app version" = surf_truth_export.FIELDS (observer
# role, anchor status and quality flags are covered by "how we rated the report"). "A code instead of your name ... we
# can still trace it back" = the HMAC pseudonyms: pseudonymous, NOT anonymous. "New checks leave out ... earlier ones
# included" = build_export's granted_now filter. "Copies made before ... are not changed" stays true until a purge on
# withdrawal exists; promise more only in the change that builds it, under a new CONSENT_VERSION.
CONSENT_TEXT = ("Off unless you turn it on. When on, the wave heights you report can be used to check and improve our "
                "surf forecasts. Each report is used with its spot, its time to the minute, how far you and your photo "
                "were from the spot, your app version and how we rated the report, under a code instead of your name. "
                "The code is the same for all your reports, and we can still trace it back to your account. Turn it "
                "off any time: from then on, new forecast checks leave out all your reports, earlier ones included. "
                "Copies made before you turned it off are not changed.")
SOURCES = ("blind_height_input", "settings")


async def current(db: AsyncSession, user_id: str) -> dict:
    """The person's current choice: {granted, version, at}. No event: not granted (opt-in)."""
    ev = (await db.execute(select(SurfTruthConsentEvent).where(SurfTruthConsentEvent.profile_id == user_id)
                           .order_by(SurfTruthConsentEvent.at.desc(), SurfTruthConsentEvent.id.desc()).limit(1))
          ).scalar_one_or_none()
    if ev is None:
        return {"granted": False, "version": None, "at": None}
    at = ev.at if ev.at.tzinfo else ev.at.replace(tzinfo=timezone.utc)
    return {"granted": bool(ev.granted), "version": ev.version, "at": at.isoformat()}


async def record(db: AsyncSession, user_id: str, granted: bool, source: str,
                 now: Optional[datetime] = None) -> SurfTruthConsentEvent:
    """Append one choice under the CURRENT wording. Does not commit."""
    if source not in SOURCES:
        raise ValueError(f"unknown consent source {source!r}")
    ev = SurfTruthConsentEvent(profile_id=user_id, granted=bool(granted), version=CONSENT_VERSION, source=source,
                               at=now or datetime.now(timezone.utc))
    db.add(ev)
    return ev


async def granted_now(db: AsyncSession, user_ids) -> set:
    """The subset of `user_ids` whose CURRENT choice is a grant (the newest event per person)."""
    ids = set(user_ids)
    if not ids:
        return set()
    rows = (await db.execute(select(SurfTruthConsentEvent).where(SurfTruthConsentEvent.profile_id.in_(ids)))
            ).scalars().all()
    newest: dict = {}
    for ev in rows:
        at = ev.at if ev.at.tzinfo else ev.at.replace(tzinfo=timezone.utc)
        key = (at, ev.id)
        if ev.profile_id not in newest or key > newest[ev.profile_id][0]:
            newest[ev.profile_id] = (key, ev.granted)
    return {pid for pid, (_k, g) in newest.items() if g}
