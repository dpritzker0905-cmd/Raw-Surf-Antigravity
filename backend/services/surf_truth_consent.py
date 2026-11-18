"""Consent to use surf observations for forecast improvement (T1 P3).

Opt-in: no recorded choice means NO. The wording is a LEGAL DOCUMENT managed with the Terms of Service and Privacy
Policy (admin: Compliance > Legal documents > Forecast data consent; `tos_content` with doc_type 'forecast_consent').
Version rule, the same one the ToS editor uses: re-publishing the SAME version is a wording fix and existing consent
stays valid; publishing a NEW version means the meaning changed, so earlier choices no longer count and the person is
asked again. Every recorded choice and every observation names the version it was made under.

The DEFAULT wording below is used only until an admin publishes one. It is engineering's plain-language draft, not
reviewed by counsel (David's call). It promises only what the code does: off by default; a withdrawal stops the export
from using ANY of the person's reports, earlier ones included (the export checks the CURRENT choice as well as the one
in force when each report was made).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import SurfTruthConsentEvent, TosContent

DOC_TYPE = "forecast_consent"
CONSENT_VERSION = "draft-2026-11-18"        # the default's version, until an admin publishes one
CONSENT_TITLE = "Use my wave reports to improve Raw Surf's forecasts"
CONSENT_TEXT = ("Off unless you turn it on. When on, the wave heights you report (with the spot and time, but never "
                "your name) can be used to check and improve our surf forecasts. Turn it off any time: from then "
                "on, none of your reports are used, including earlier ones.")
DEFAULT_SECTIONS = [{"title": CONSENT_TITLE, "body": CONSENT_TEXT}]
SOURCES = ("blind_height_input", "settings")


async def wording(db: AsyncSession) -> dict:
    """The wording in force: {version, title, text, effective_date, published}. The active admin-published
    `forecast_consent` document if there is one, else the built-in default."""
    doc = (await db.execute(select(TosContent).where(TosContent.doc_type == DOC_TYPE, TosContent.is_active.is_(True))
                            .limit(1))).scalar_one_or_none()
    if doc is not None and doc.sections:
        first = doc.sections[0]
        return {"version": doc.version, "title": first.get("title") or CONSENT_TITLE,
                "text": first.get("body") or "", "effective_date": doc.effective_date, "published": True}
    return {"version": CONSENT_VERSION, "title": CONSENT_TITLE, "text": CONSENT_TEXT, "effective_date": None,
            "published": False}


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def current(db: AsyncSession, user_id: str, version: Optional[str] = None) -> dict:
    """The person's choice IN FORCE: {granted, version, at, needs_reconsent}. A grant counts only if it was made under
    the current wording's version (a new version means the meaning changed). No event: not granted (opt-in)."""
    version = version or (await wording(db))["version"]
    ev = (await db.execute(select(SurfTruthConsentEvent).where(SurfTruthConsentEvent.profile_id == user_id)
                           .order_by(SurfTruthConsentEvent.at.desc(), SurfTruthConsentEvent.id.desc()).limit(1))
          ).scalar_one_or_none()
    if ev is None:
        return {"granted": False, "version": None, "at": None, "needs_reconsent": False}
    stale = bool(ev.granted) and ev.version != version
    return {"granted": bool(ev.granted) and not stale, "version": ev.version, "at": _aware(ev.at).isoformat(),
            "needs_reconsent": stale}


async def record(db: AsyncSession, user_id: str, granted: bool, source: str,
                 now: Optional[datetime] = None) -> SurfTruthConsentEvent:
    """Append one choice under the CURRENT wording's version. Does not commit."""
    if source not in SOURCES:
        raise ValueError(f"unknown consent source {source!r}")
    version = (await wording(db))["version"]
    ev = SurfTruthConsentEvent(profile_id=user_id, granted=bool(granted), version=version, source=source,
                               at=now or datetime.now(timezone.utc))
    db.add(ev)
    return ev


async def granted_now(db: AsyncSession, user_ids) -> set:
    """The subset of `user_ids` whose choice in force is a grant under the CURRENT wording's version."""
    ids = set(user_ids)
    if not ids:
        return set()
    version = (await wording(db))["version"]
    rows = (await db.execute(select(SurfTruthConsentEvent).where(SurfTruthConsentEvent.profile_id.in_(ids)))
            ).scalars().all()
    newest: dict = {}
    for ev in rows:
        key = (_aware(ev.at), ev.id)
        if ev.profile_id not in newest or key > newest[ev.profile_id][0]:
            newest[ev.profile_id] = (key, ev.granted and ev.version == version)
    return {pid for pid, (_k, ok) in newest.items() if ok}


async def summary(db: AsyncSession) -> dict:
    """Admin view: how many people have a grant in force under the current version, and how many granted under an
    older version and have not agreed again. Counts only; no identities."""
    version = (await wording(db))["version"]
    rows = (await db.execute(select(SurfTruthConsentEvent))).scalars().all()
    newest: dict = {}
    for ev in rows:
        key = (_aware(ev.at), ev.id)
        if ev.profile_id not in newest or key > newest[ev.profile_id][0]:
            newest[ev.profile_id] = (key, ev)
    latest = [ev for _k, ev in newest.values()]
    return {"version": version,
            "opted_in": sum(1 for e in latest if e.granted and e.version == version),
            "awaiting_reconsent": sum(1 for e in latest if e.granted and e.version != version),
            "opted_out": sum(1 for e in latest if not e.granted)}
