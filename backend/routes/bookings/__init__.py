"""
bookings/__init__.py - Bookings package router composition

Architecture: Strangler Fig Pattern
====================================
The bookings domain has been migrated from a 5,172-line monolith (bookings.py)
into this package. The original file is preserved as _monolith.py and the
router is re-exported unchanged, so all existing imports continue to work:

    from .bookings import router as bookings_router  # in routes/__init__.py

FUTURE SPLIT PLAN (execute one group at a time, test after each):
------------------------------------------------------------------
1. crud.py        - Core CRUD: GET/POST bookings, cancel, complete (lines 167-977)
2. payments.py    - Stripe + crew pay + split payments (lines 1095-3733)
3. lineup.py      - Lineup open/join/leave/lock/close/status (lines 3776-4507)
4. invites.py     - Crew invites, join-by-code, respond (lines 1866-2565)
5. waitlist.py    - Waitlist join/leave/claim + keep-seat (lines 4811-5172)

To split a domain:
    1. Create the sub-file (e.g., crud.py) with its own APIRouter
    2. Move the relevant route functions to that file
    3. Import the sub-router here and include it into the main router
    4. Remove the moved routes from _monolith.py
    5. Run the test suite and smoke-test locally

CURRENT STATE: All routes live in _monolith.py (zero behavior change from
the original bookings.py).
"""
from ._monolith import router

__all__ = ['router']
