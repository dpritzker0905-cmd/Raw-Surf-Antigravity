"""xp.py -- the ONE place XP is granted.

WHY (2026-10-24). XP used to be written four different ways, none of them safe or consistent:

  * `XPTransaction` rows (the ledger: stats, badges, the XP leaderboard) were built inline by half a dozen routes
    with free-text reasons and amounts typed at the call site;
  * `Profile.xp_total` (the cache the Grom HQ, the impact leaderboard, the dispatch roster and the photographer
    dashboard read) was bumped directly by the on-demand code WITHOUT a ledger row, so the two never agreed;
  * two public routes let the CLIENT name the amount: one for any signed-in user, one for any photographer id.

Now a grant is a server decision. The amount comes from XP_RULES by a stable reason code, never from a request;
a grant tied to a reference (a dispatch, a review) happens once however many times the action is replayed; and
every grant writes the ledger row AND moves the cache in the same transaction, so `xp_total` equals the ledger
sum for everything granted through here. The caller owns the commit.

Adding a way to earn XP = adding a rule here and calling `grant_xp` from the server action that earned it.
There is deliberately no route that takes an amount (tests/test_xp_single_path.py).
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select

from models import Profile, XPTransaction

HOT_STREAK_THRESHOLD = 3   # consecutive on-demand months before the multiplier applies
HOT_STREAK_MULTIPLIER = 2


@dataclass(frozen=True)
class XPRule:
    amount: int
    once_per_reference: bool = True   # a replay of the same (user, reason, reference) grants nothing
    hot_streak: bool = False          # doubled while the user is on an on-demand hot streak


# Reason codes are stable identifiers (the leaderboard category filters match on the substrings "session" and
# "photo", so codes for those families keep the word). Amounts are the ones the routes already paid.
XP_RULES = {
    "on_demand_connect": XPRule(50, hot_streak=True),   # photographer reaches an on-demand request
    "on_demand_requested": XPRule(25),                  # the surfer whose request was answered
    "review_given": XPRule(10),                         # leaving a review
}


async def grant_xp(db, user_id: str, reason: str, *, reference_type: Optional[str] = None,
                   reference_id: Optional[str] = None, streak: int = 0) -> int:
    """Grant the rule's XP to `user_id` and return the amount granted (0 when it was already granted).

    The ledger row and the `Profile.xp_total` cache move together; the caller commits. `streak` is the user's
    current on-demand streak, read by the caller BEFORE it advances the streak.
    """
    rule = XP_RULES.get(reason)
    if rule is None:
        raise ValueError(f"unknown XP reason {reason!r}")
    if rule.once_per_reference and reference_id is not None:
        already = await db.execute(
            select(XPTransaction.id).where(
                XPTransaction.user_id == user_id,
                XPTransaction.reason == reason,
                XPTransaction.reference_type == reference_type,
                XPTransaction.reference_id == reference_id,
            ).limit(1))
        if already.first() is not None:
            return 0
    amount = rule.amount * (HOT_STREAK_MULTIPLIER if rule.hot_streak and streak >= HOT_STREAK_THRESHOLD else 1)
    db.add(XPTransaction(user_id=user_id, amount=amount, reason=reason,
                         reference_type=reference_type, reference_id=reference_id))
    profile = await db.get(Profile, user_id)
    if profile is not None:
        profile.xp_total = (profile.xp_total or 0) + amount
    return amount
