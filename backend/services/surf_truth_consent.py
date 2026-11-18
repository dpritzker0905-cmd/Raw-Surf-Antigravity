"""Consent to use surf observations for forecast improvement (T1 P3).

Opt-in: no recorded choice means NO. The wording is a LEGAL DOCUMENT managed with the Terms of Service and Privacy
Policy (admin: Compliance > Legal documents > Forecast data consent; `tos_content` with doc_type 'forecast_consent').
Version rule: a version names ONE wording. People agreed to the text, so the text under a version never changes: the
admin save refuses a different text under a version already published, or under the built-in default's version
(advisor hold on #1026: the ToS editor's "same version = wording fix" let the text change under consent already
given). Any change, a typo fix included, is a NEW version, so earlier choices no longer count and the person is asked
again. Every recorded choice and every observation names the version it was made under.

The DEFAULT wording below is used only until an admin publishes one. It is engineering's plain-language draft, not
reviewed by counsel (David's call). It promises only what the code does: off by default; what each used report
carries (it is pseudonymous, NOT anonymous); and that a withdrawal stops every LATER export from using any of the
person's reports, earlier ones included (the export checks the CURRENT choice as well as the one in force when each
report was made); and that exports made before a withdrawal are deleted within 7 days (services/surf_truth_retention).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import SurfTruthConsentEvent, TosContent
from services import legal_identity

DOC_TYPE = "forecast_consent"
CONSENT_VERSION = "draft-2026-11-18e"     # the default's version until an admin publishes one. b: the advisor's 11-18
#                                           review (the first draft overstated both promises); c: retention now purges
#                                           older exports after a withdrawal, so the text can promise it; d: the
#                                           2026-11-18 legal research (names the controller, the Art. 7(3) sentence,
#                                           withdrawal by "this same switch", distances only in bands); e: the
#                                           controller and the privacy link come from Company details (tokens)
CONSENT_TITLE = "Use my wave reports to improve Raw Surf's forecasts"

# COMPANY DETAILS (owner, 2026-11-18): "{company}" and "{privacy_url}" are filled from Compliance > Legal documents >
# Company details (services/legal_identity; defaults "Raw Surf Adventures Inc." and the app's /privacy page) when the
# wording is served. The VERSION people agree to names the FILLED text: when a token is in the wording, the served
# version is "<version>+<8 hex of the filled text>", so renaming the company is a new version and asks everyone again.
#
# DRAFT MARKERS: an admin-published text may still carry "[COMPANY]" or "[PRIVACY NOTICE LINK]" (or a token whose
# company detail is empty). Such a wording is NOT FINAL: a grant is refused (WordingNotFinal; the route answers 409),
# the admin cannot make such a text active, and the app hides the switch. A withdrawal is always accepted.
COMPANY_PLACEHOLDER = "[COMPANY]"
PRIVACY_NOTICE_PLACEHOLDER = "[PRIVACY NOTICE LINK]"
PLACEHOLDERS = (COMPANY_PLACEHOLDER, PRIVACY_NOTICE_PLACEHOLDER)

# DRAFT wording, not reviewed by counsel. It adopts the 2026-11-18 research's proposed text with ONE switch for
# "measure and improve" (owner, 2026-11-18: "one switch"), so "improve" is defined narrowly and the text says what
# stays after a withdrawal. Each sentence maps to code:
# - "spot, time to the minute, roughly how far ... in wide bands, app version" = surf_truth_export.FIELDS (observer
#   role, anchor status and quality flags are covered by "how we rated the report"); the bands are
#   surf_truth_export.DISTANCE_BANDS, none narrower than 1 km (California's precise-geolocation radius is 1,850 ft).
# - "a code instead of your name ... we can trace it back" = the HMAC pseudonyms: pseudonymous, NOT anonymous.
# - "Checks and corrections already made stay" = Art. 7(3): withdrawal does not undo processing before it.
# - "new checks leave out all your reports, earlier ones included" = build_export's granted_now filter.
# - "copies ... are deleted within 7 days" = surf_truth_retention: a withdrawal is a revocation, so the daily job
#   replaces every export cut before it.
# - "this same switch" = Art. 7(3) "as easy to withdraw as to give": the switch that records the grant also withdraws.
CONSENT_TEXT = ("Help check our forecasts. Off unless you turn it on. When on, {company} uses the "
                "wave heights you report to measure how far off our surf forecasts are and to correct them. Each "
                "report is used with its spot, its time to the minute, roughly how far you and your photo were from "
                "the spot (in wide bands, never closer than 1 km), your app version and how we rated the report. We "
                "use a code instead of your name; it is the same for all your reports, and we can trace it back to "
                "your account. Turn it off any time with this same switch. Checks and corrections already made stay, "
                "but new checks leave out all your reports, earlier ones included, and copies made before you turned "
                "it off are deleted within 7 days. Privacy notice: {privacy_url}")
DEFAULT_SECTIONS = [{"title": CONSENT_TITLE, "body": CONSENT_TEXT}]
SOURCES = ("blind_height_input", "settings")


class WordingNotFinal(ValueError):
    """The wording in force still carries a draft placeholder, so nobody can agree to it yet."""


def unfilled(text: Optional[str], details: Optional[dict] = None) -> list:
    """What still keeps `text` from being final: draft markers, and (given the company details) any token whose
    detail is empty. An empty list = the wording is final."""
    left = [p for p in PLACEHOLDERS if p in (text or "")]
    if details is not None:
        left += [token for token, key in legal_identity.TOKENS.items() if token in (text or "") and not details.get(key)]
    return left


def _served(version: str, title: str, text: str, details: dict) -> tuple[str, str, str]:
    """Fill the tokens; a wording that used any token is served under '<version>+<8 hex of the filled words>'."""
    filled_title, filled_text = legal_identity.fill(title, details), legal_identity.fill(text, details)
    if (filled_title, filled_text) == (title, text):
        return version, title, text
    digest = hashlib.sha256(f"{filled_title}\n{filled_text}".encode()).hexdigest()[:8]
    return f"{version}+{digest}", filled_title, filled_text


def default_served_version() -> str:
    """The version the built-in default is served under with the default company details (no admin edits)."""
    return _served(CONSENT_VERSION, CONSENT_TITLE, CONSENT_TEXT, legal_identity.DEFAULTS)[0]


async def wording(db: AsyncSession) -> dict:
    """The wording in force, FILLED from the company details: {version, title, text, effective_date, published,
    final, privacy_url}. The active admin-published `forecast_consent` document if there is one, else the built-in
    default. `version` names the filled words (see _served)."""
    doc = (await db.execute(select(TosContent).where(TosContent.doc_type == DOC_TYPE, TosContent.is_active.is_(True))
                            .limit(1))).scalar_one_or_none()
    details = await legal_identity.current(db)
    if doc is not None and doc.sections:
        first = doc.sections[0]
        base, title, text, effective, published = (doc.version, first.get("title") or CONSENT_TITLE,
                                                   first.get("body") or "", doc.effective_date, True)
    else:
        base, title, text, effective, published = CONSENT_VERSION, CONSENT_TITLE, CONSENT_TEXT, None, False
    final = not unfilled(title + "\n" + text, details)
    version, title, text = _served(base, title, text, details)
    return {"version": version, "title": title, "text": text, "effective_date": effective, "published": published,
            "final": final, "privacy_url": details.get("privacy_url") or None}


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
    """Append one choice under the CURRENT wording's version. Does not commit. A GRANT under a wording that still
    carries a draft placeholder raises WordingNotFinal (consent to a text that does not name the controller is not
    informed); a withdrawal is always recorded."""
    if source not in SOURCES:
        raise ValueError(f"unknown consent source {source!r}")
    words = await wording(db)
    if granted and not words["final"]:
        raise WordingNotFinal("the consent wording is not final (a draft marker, or a company detail is empty)")
    version = words["version"]
    ev = SurfTruthConsentEvent(profile_id=user_id, granted=bool(granted), version=version, source=source,
                               at=now or datetime.now(timezone.utc))
    db.add(ev)
    return ev


async def granted_now(db: AsyncSession, user_ids) -> set:
    """The subset of `user_ids` whose choice in force is a grant under the CURRENT wording's version."""
    ids = set(user_ids)
    if not ids:
        return set()
    words = await wording(db)
    if not words["final"]:
        return set()                     # nobody can hold a grant under a draft wording (record() refuses one)
    version = words["version"]
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
