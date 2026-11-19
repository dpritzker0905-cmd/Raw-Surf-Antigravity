"""Retention of the three append-only surf-truth logs: the periods are NOT engineering's to set.

Design: docs/weather-program/T1-LOG-RETENTION-DESIGN-2026-11-18.md (DECISIONS D-T1-LOGS). The 2026-11-18 legal
research (research, not legal advice; counsel has reviewed nothing) found that keeping these logs forever after an
account erasure is not defensible, but that each has a different reason to be kept for SOME time:

- surf_truth_consent_events: proof of consent (GDPR Art. 7(1), 5(2); Cal. Civ. Code 1798.105(c)(2) allows a
  confidential record of deletion requests). Kept after erasure with minimal fields, for a CLAIMS PERIOD COUNSEL NAMES.
- surf_truth_anchor_events: the weakest case for keeping. Reason codes only (services/surf_truth_admin.ANCHOR_REASONS);
  removed at deletion or within a 6-12 month window.
- surf_truth_admin_actions: a security log (GDPR Art. 32; 1798.105(d)(2)). CNIL Deliberation 2021-122 suggests 6-12
  months (up to 3 years with a documented internal-control reason).

Every period below is None, meaning AWAITING AN ANSWER from David or counsel. No code removes a log row today: the
mechanism (per-subject keys plus monthly partitions; see the design) is built only once these are set, so an unset
period can never delete anything early. `awaiting()` lists what is still open, for the admin screen and the memory
audit; a test pins that nothing here invents a number.
"""
from __future__ import annotations

from typing import Optional

# Days after an ACCOUNT ERASURE that a consent event is kept before its subject key is destroyed (claims period).
CONSENT_EVENTS_AFTER_ERASURE_DAYS: Optional[int] = None      # counsel names it; the research gives no number
# Days a consent event is kept at most, erased account or not (None = only the erasure clock above applies).
CONSENT_EVENTS_MAX_DAYS: Optional[int] = None
# Days an anchor event is kept (research: 6-12 months, i.e. 183-365), and whether an erasure removes it at once.
ANCHOR_EVENTS_DAYS: Optional[int] = None
ANCHOR_EVENTS_SHRED_AT_ERASURE: Optional[bool] = None          # research leans yes; David's call
# Days an admin action is kept (research: 6-12 months; up to 3 years with a documented internal-control reason).
ADMIN_ACTIONS_DAYS: Optional[int] = None

PERIODS = {
    "CONSENT_EVENTS_AFTER_ERASURE_DAYS": "consent events: days kept after an account erasure (claims period)",
    "CONSENT_EVENTS_MAX_DAYS": "consent events: longest any record is kept",
    "ANCHOR_EVENTS_DAYS": "anchor events: days kept (research: 183-365)",
    "ANCHOR_EVENTS_SHRED_AT_ERASURE": "anchor events: removed at once when the account is erased?",
    "ADMIN_ACTIONS_DAYS": "admin actions: days kept (research: 183-365, up to 1095 with a documented reason)",
}


def awaiting() -> list:
    """The retention settings still waiting for David's or counsel's answer, as (name, question) pairs."""
    return [(name, question) for name, question in PERIODS.items() if globals()[name] is None]
