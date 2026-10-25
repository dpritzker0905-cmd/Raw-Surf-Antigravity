"""User-block enforcement: ONE place that answers "is there a block between these two users?".

The block/unblock routes (`routes/social/blocks.py`) write `UserBlock` rows. Until this module existed no
other surface read them, so the safety control was cosmetic (audit 2026-10-18 F-09). Every surface that lets
one account reach another (direct messages, comments, reactions, follows, friend requests, profile and post
views, search, feeds) calls a helper here instead of re-deriving the query.

Semantics, decided once:
  * ACTIONS (message, comment, react, follow, friend-request) are refused with 403 when a block exists in
    EITHER direction: the blocker has not agreed to hear from the blocked user, and the blocked user must not
    be able to reach the blocker through a side door either.
  * VIEWS (a profile page, a single post, a profile's posts) answer 404 - never 403 - to the blocked viewer so a
    block is not leaked. The blocker can still open the blocked user's page (to unblock them).
  * LISTS (search, feeds, comment threads) hide the other side in BOTH directions, matching the
    `all_excluded_ids` contract the block routes already publish.

Cost: every helper is one indexed query on `user_blocks` (blocker_id / blocked_id are both indexed), never one
query per row. List surfaces fetch the viewer's excluded-id set once and filter in SQL with `NOT IN`.
"""
from __future__ import annotations

from typing import Iterable, Optional, Set, Tuple

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from models import UserBlock

# One wording for every refused action: it names the effect, not who blocked whom.
BLOCKED_ACTION_DETAIL = "This action is not available between these accounts."
BLOCKED_VIEW_DETAIL = "Not found"


async def blocked_directions(
    db: AsyncSession, a: Optional[str], b: Optional[str]
) -> Tuple[bool, bool]:
    """Return ``(a_blocked_b, b_blocked_a)`` using a single indexed query."""
    if not a or not b or a == b:
        return False, False
    rows = (
        await db.execute(
            select(UserBlock.blocker_id, UserBlock.blocked_id).where(
                or_(
                    and_(UserBlock.blocker_id == a, UserBlock.blocked_id == b),
                    and_(UserBlock.blocker_id == b, UserBlock.blocked_id == a),
                )
            )
        )
    ).all()
    a_blocked_b = any(r[0] == a and r[1] == b for r in rows)
    b_blocked_a = any(r[0] == b and r[1] == a for r in rows)
    return a_blocked_b, b_blocked_a


async def is_blocked_either_way(db: AsyncSession, a: Optional[str], b: Optional[str]) -> bool:
    """True when ``a`` blocked ``b`` or ``b`` blocked ``a``."""
    a_blocked_b, b_blocked_a = await blocked_directions(db, a, b)
    return a_blocked_b or b_blocked_a


async def has_blocked_viewer(db: AsyncSession, owner_id: Optional[str], viewer_id: Optional[str]) -> bool:
    """True when ``owner_id`` has blocked ``viewer_id`` (the one direction that hides content)."""
    owner_blocked_viewer, _ = await blocked_directions(db, owner_id, viewer_id)
    return owner_blocked_viewer


async def assert_not_blocked(db: AsyncSession, a: Optional[str], b: Optional[str]) -> None:
    """Refuse an ACTION between ``a`` and ``b`` with 403 when a block exists either way."""
    if await is_blocked_either_way(db, a, b):
        raise HTTPException(status_code=403, detail=BLOCKED_ACTION_DETAIL)


async def assert_visible_to(
    db: AsyncSession, owner_id: Optional[str], viewer_id: Optional[str], detail: str = BLOCKED_VIEW_DETAIL
) -> None:
    """Refuse a VIEW of ``owner_id``'s content to a viewer they blocked, with 404 (no leak).

    ``detail`` must be the surface's OWN not-found wording so the blocked response is byte-identical to the
    response for a record that does not exist.

    An anonymous viewer (``viewer_id`` None) cannot be matched to a block and is not affected.
    """
    if viewer_id and await has_blocked_viewer(db, owner_id, viewer_id):
        raise HTTPException(status_code=404, detail=detail)


async def excluded_user_ids(db: AsyncSession, user_id: Optional[str]) -> Set[str]:
    """Every user that ``user_id`` blocked or that blocked ``user_id`` - one query, for list filtering."""
    if not user_id:
        return set()
    rows = (
        await db.execute(
            select(UserBlock.blocker_id, UserBlock.blocked_id).where(
                or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id)
            )
        )
    ).all()
    out: Set[str] = set()
    for blocker_id, blocked_id in rows:
        out.add(blocked_id if blocker_id == user_id else blocker_id)
    out.discard(user_id)
    return out


async def users_who_blocked(db: AsyncSession, viewer_id: Optional[str]) -> Set[str]:
    """Owners who blocked ``viewer_id`` - the set whose CONTENT must be hidden from the viewer."""
    if not viewer_id:
        return set()
    rows = (
        await db.execute(select(UserBlock.blocker_id).where(UserBlock.blocked_id == viewer_id))
    ).all()
    return {r[0] for r in rows}


def not_in_ids(column, ids: Iterable[str]):
    """SQL clause keeping rows whose ``column`` is not in ``ids``; a no-op clause when ``ids`` is empty."""
    id_list = list(ids)
    if not id_list:
        return true()  # keeps the call site branch-free
    return column.notin_(id_list)
