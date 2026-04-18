"""
bookings/invites.py — Crew invites, join-by-code, participant management

ROUTES IN THIS DOMAIN (12 total):
#   L1206: /bookings/{booking_id}/request-join -> request_join_session
#   L1649: /bookings/{booking_id}/join -> join_booking
#   L1839: /bookings/join-by-code -> join_by_invite_code
#   L1866: /bookings/{booking_id}/invite -> invite_friend_to_booking
#   L2094: /bookings/{booking_id}/search-users -> search_users_for_invite
#   L2182: /bookings/{booking_id}/invite-by-handle -> invite_user_by_handle
#   L2435: /bookings/invites/{invite_id}/respond -> respond_to_invite
#   L2777: /bookings/invites/{user_id} -> get_user_invites
#   L3965: /bookings/{booking_id}/lineup/join -> join_lineup
#   L4506: /bookings/{booking_id}/invite-crew -> invite_crew_to_booking
#   L4598: /bookings/{booking_id}/invite-suggestions -> get_invite_suggestions
#   L4811: /bookings/{booking_id}/waitlist/join -> join_booking_waitlist

STATUS: Stub created by split-bookings.py.
TODO: Move route implementations from _monolith.py into this file.

MIGRATION STEPS:
1. Move the matched routes from _monolith.py here
2. Add required imports from the monolith header
3. Remove moved routes from _monolith.py
4. Verify: python -c "from backend.routes.bookings.invites import router"
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
import logging

# TODO: Copy remaining imports from _monolith.py as needed
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ────────────────────────────────────────────────────────────────────
# TODO: Move 12 route(s) from _monolith.py to here.
# See route list above for exact line numbers.
