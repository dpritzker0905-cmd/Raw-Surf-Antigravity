#!/usr/bin/env python3
"""
migrate_bookings.py — Automated Strangler Fig migration for bookings monolith.

Reads _monolith.py and splits routes into:
  - crud.py        (lines 167-1094)
  - payments.py    (lines 1095-3775)
  - lineup.py      (lines 3776-4507)
  - invites.py     (lines 1866-2564)  [subset within payments range]
  - waitlist.py    (lines 4811-5172)

Domain boundaries (from route analysis):
  CRUD:      L167-L1094   get/list/create/cancel/complete/share/nearby
  PAYMENTS:  L1095-L3775  splits, Stripe, crew pay, escrow, nudge, crew hub
  INVITES:   L1866-L2564  invite, join-by-code, respond (within payments)
  LINEUP:    L3776-L4507  lineup open/join/leave/lock/close/status/remove
  WAITLIST:  L4811-L5172  waitlist join/leave/claim + keep-seat

Strategy:
  - Each domain file gets its own copy of the shared header imports
  - All Pydantic models stay in crud.py (they're needed by payments too,
    so we import them there with `from .crud import *` or inline repeats)
  - _monolith.py is kept as-is (do NOT delete) - __init__.py switches to
    the new routers once all tests pass
"""

import os
import sys

MONOLITH = os.path.join(os.path.dirname(__file__), '_monolith.py')
OUTDIR = os.path.dirname(__file__)

# ── Shared header ──────────────────────────────────────────────────────────────
SHARED_HEADER = '''"""
{module_doc}
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import math
import logging
import os
import stripe

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    Notification, RoleEnum, PaymentTransaction,
    Conversation, ConversationParticipant, Message
)
from utils.credits import deduct_credits, add_credits, transfer_credits, refund_credits
from websocket_manager import broadcast_earnings_update

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

'''

def read_monolith():
    with open(MONOLITH, 'r', encoding='utf-8') as f:
        return f.readlines()

def extract_lines(lines, start_line, end_line):
    """Extract lines from monolith (1-indexed, inclusive)"""
    return ''.join(lines[start_line-1:end_line])

def write_domain_file(filename, doc, content):
    outpath = os.path.join(OUTDIR, filename)
    header = SHARED_HEADER.format(module_doc=doc)
    with open(outpath, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write(content)
    print(f"  Wrote {outpath} ({len(content)} bytes)")

def main():
    print("Reading monolith...")
    lines = read_monolith()
    total = len(lines)
    print(f"  {total} lines read")

    # ── Domain line ranges (from route analysis above) ──────────────────────────
    # Each tuple: (start_line, end_line) inclusive in _monolith.py
    #
    # Note: invites routes are embedded within the payments region (lines 1866-2564)
    # We extract by grouping FUNCTION bodies: a function starts at its @router
    # decorator and ends just before the next @router decorator or EOF.

    # We'll use a function-body extractor approach
    route_starts = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('@router.') and ('get(' in stripped or 'post(' in stripped
                or 'put(' in stripped or 'delete(' in stripped or 'patch(' in stripped):
            route_starts.append(i)

    route_starts.append(total + 1)  # sentinel

    def get_routes_in_range(start_l, end_l):
        """Return all lines belonging to routes whose @decorator falls in [start_l, end_l]"""
        chunks = []
        for idx, rs in enumerate(route_starts[:-1]):
            next_rs = route_starts[idx + 1]
            if start_l <= rs <= end_l:
                chunks.append(''.join(lines[rs-1:next_rs-1]))
        return '\n'.join(chunks)

    # ── Helper/model/class extraction ──────────────────────────────────────────
    # Lines 43-165: shared helpers (check_time_slot_conflict) + Pydantic models
    shared_helpers = extract_lines(lines, 43, 165)

    # ── 1. CRUD (lines 167-1094 route starters + L2364 share-link + L2565 nearby) ──
    # Routes in CRUD domain:
    # L167  /bookings
    # L258  /photographers/directory  
    # L360  /bookings/user/{user_id}
    # L453  /bookings/{booking_id} PATCH
    # L495  /bookings/create
    # L737  /bookings/{booking_id}/cancel
    # L874  /bookings/{booking_id}/complete
    # L977  /bookings/{booking_id}/content-delivered
    # L1018 /bookings/{booking_id}/share-to-feed
    # L2364 /bookings/{booking_id}/share-link
    # L2565 /bookings/nearby
    # L2672 /sessions/user/{user_id}
    # L2707 /sessions/leave/{session_id}
    crud_route_lines = [167, 258, 360, 453, 495, 737, 874, 977, 1018, 2364, 2565, 2672, 2707]
    crud_body_model_lines = [446]  # BookingSettingsUpdate at L446

    # ── 2. PAYMENTS (L1095-L3775, excludes invites block) ──────────────────────
    payment_route_lines = [
        1095,   # /bookings/{booking_id}/send-split-requests
        1315,   # /bookings/create-with-stripe
        1501,   # /bookings/payment-success
        1649,   # /bookings/{booking_id}/join
        1781,   # /bookings/{booking_id}/enable-splitting
        1839,   # /bookings/join-by-code (invite-adjacent)
        2822,   # /bookings/{booking_id}/crew-status
        2868,   # /bookings/{booking_id}/nudge
        2909,   # /bookings/{booking_id}/nudge-all
        2946,   # /bookings/{booking_id}/update-splits
        3003,   # /bookings/{booking_id}/crew-hub-status
        3078,   # /bookings/{booking_id}/crew-hub/update-splits
        3133,   # /bookings/{booking_id}/crew-hub/captain-hold
        3264,   # /bookings/{booking_id}/crew-hub/captain-cover-remaining
        3365,   # /bookings/{booking_id}/crew-hub/handle-expiry
        3429,   # /bookings/{booking_id}/crew-hub/cancel-refund
        3512,   # /bookings/{booking_id}/crew-payment-details
        3596,   # /bookings/{booking_id}/crew-pay
        3733,   # /bookings/{booking_id}/participant-selfie
        2777,   # /bookings/invites/{user_id} (list pending)
    ]

    # ── 3. INVITES ──────────────────────────────────────────────────────────────
    invite_route_lines = [
        1206,   # /bookings/{booking_id}/request-join
        1866,   # /bookings/{booking_id}/invite
        1962,   # /bookings/{booking_id}/send-crew-requests
        2094,   # /bookings/{booking_id}/search-users
        2182,   # /bookings/{booking_id}/invite-by-handle
        2435,   # /bookings/invites/{invite_id}/respond
        4506,   # /bookings/{booking_id}/invite-crew
        4598,   # /bookings/{booking_id}/invite-suggestions
    ]

    # ── 4. LINEUP ───────────────────────────────────────────────────────────────
    lineup_route_lines = [
        3776,   # /bookings/lineups
        3904,   # /bookings/{booking_id}/lineup/open
        3965,   # /bookings/{booking_id}/lineup/join
        4067,   # /bookings/{booking_id}/lineup/leave
        4167,   # /bookings/{booking_id}/lineup/lock
        4248,   # /bookings/{booking_id}/lineup/close
        4308,   # /bookings/{booking_id}/lineup/status
        4406,   # /bookings/{booking_id}/lineup/remove-member
        4723,   # /bookings/{booking_id}/reservation-settings PATCH
        4786,   # /bookings/{booking_id}/reservation-settings GET
    ]

    # ── 5. WAITLIST ──────────────────────────────────────────────────────────────
    waitlist_route_lines = [
        4811,   # /bookings/{booking_id}/waitlist/join
        4895,   # /bookings/{booking_id}/waitlist
        4952,   # /bookings/{booking_id}/waitlist/leave
        4979,   # /bookings/{booking_id}/waitlist/claim
        5048,   # /bookings/{booking_id}/keep-seat
        5136,   # /bookings/{booking_id}/keep-seat-status
    ]

    def extract_by_start_lines(starts):
        """Extract route bodies for routes whose @decorator is at specified start lines"""
        chosen = set(starts)
        chunks = []
        for idx, rs in enumerate(route_starts[:-1]):
            if rs in chosen:
                next_rs = route_starts[idx + 1]
                chunk = ''.join(lines[rs-1:next_rs-1])
                chunks.append(chunk)
        return '\n\n'.join(chunks)

    # Also need to grab any class/model definitions between routes
    def extract_lines_between_routes(start_route_line, end_route_line):
        """Get lines between two route markers that aren't part of a route body"""
        result = []
        # Find idx of start_route in route_starts
        for i, rs in enumerate(route_starts[:-1]):
            if rs == start_route_line:
                # Lines from prev_route_end to this route start
                # (i.e., model classes defined before the route)
                break
        return result

    print("\nExtracting domains...")

    # CRUD
    crud_content = "# ═══ SHARED HELPERS & MODELS ═══════════════════════════════════════════\n\n"
    crud_content += shared_helpers
    crud_content += "\n\n# ═══ ROUTES ══════════════════════════════════════════════════════════════\n\n"
    crud_content += extract_by_start_lines(crud_route_lines)
    write_domain_file('crud.py',
        "bookings/crud.py — Core booking CRUD: list, get, create, cancel, complete, share, sessions",
        crud_content)

    # PAYMENTS
    pay_content = "# ═══ PYDANTIC MODELS (payments domain) ══════════════════════════════════\n\n"
    pay_content += "# Import shared models from crud domain\nfrom .crud import (\n    CrewMember,\n    CreateUserBookingRequest,\n    CreateBookingWithStripeRequest,\n    JoinBookingRequest,\n    InviteFriendRequest,\n    InviteByHandleRequest,\n    InviteResponse,\n    BookingSettingsUpdate,\n    check_time_slot_conflict,\n)\n\n"
    pay_content += "# ═══ ROUTES ══════════════════════════════════════════════════════════════\n\n"
    pay_content += extract_by_start_lines(payment_route_lines)
    write_domain_file('payments.py',
        "bookings/payments.py — Stripe checkout, crew pay, split payments, crew hub, escrow",
        pay_content)

    # INVITES
    inv_content = "# Import shared models from crud domain\nfrom .crud import (\n    InviteFriendRequest,\n    InviteByHandleRequest,\n    InviteResponse,\n    check_time_slot_conflict,\n)\n\n"
    inv_content += "# ═══ ROUTES ══════════════════════════════════════════════════════════════\n\n"
    inv_content += extract_by_start_lines(invite_route_lines)
    write_domain_file('invites.py',
        "bookings/invites.py — Crew invites, join-by-code, invite-by-handle, respond",
        inv_content)

    # LINEUP
    lineup_content = "# ═══ ROUTES ══════════════════════════════════════════════════════════════\n\n"
    lineup_content += extract_by_start_lines(lineup_route_lines)
    write_domain_file('lineup.py',
        "bookings/lineup.py — Lineup: open, join, leave, lock, close, status, remove, reservation settings",
        lineup_content)

    # WAITLIST
    wl_content = "# ═══ ROUTES ══════════════════════════════════════════════════════════════\n\n"
    wl_content += extract_by_start_lines(waitlist_route_lines)
    write_domain_file('waitlist.py',
        "bookings/waitlist.py — Waitlist: join, leave, claim, keep-seat",
        wl_content)

    print("\nMigration complete. Files written:")
    for f in ['crud.py', 'payments.py', 'invites.py', 'lineup.py', 'waitlist.py']:
        path = os.path.join(OUTDIR, f)
        size = os.path.getsize(path)
        print(f"  {f}: {size:,} bytes")

    print("\nNOTE: _monolith.py is untouched. Update __init__.py to switch routers.")

if __name__ == '__main__':
    main()
