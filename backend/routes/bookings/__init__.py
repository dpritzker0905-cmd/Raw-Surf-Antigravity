"""
bookings/__init__.py - Bookings package router composition

Bookings Domain — 7 Focused Modules
=========================================================
  crud.py              — Core CRUD: list, get, settings, share-link, nearby, sessions
  booking_lifecycle.py — Write ops: create, cancel, complete, content-deliver, share-to-feed (v85)
  payments.py          — Stripe checkout, split payments, join booking, enable splitting
  crew_hub.py          — Crew Hub captain command center, crew payments, selfie uploads (v83 split from payments.py)
  invites.py           — Crew invites, join-by-code, invite-by-handle, respond
  lineup.py            — Lineup: open, join, leave, lock, close, status, reservation
  waitlist.py          — Waitlist: join, leave, claim, keep-seat

The combined router is exported as `router` for backward compatibility:
    from .bookings import router as bookings_router  # routes/__init__.py
"""
from fastapi import APIRouter

from .crud import router as _crud_router
from .booking_lifecycle import router as _lifecycle_router
from .payments import router as _payments_router
from .crew_hub import router as _crew_hub_router
from .invites import router as _invites_router
from .lineup import router as _lineup_router
from .waitlist import router as _waitlist_router

# Compose a single combined router from all domain sub-routers
router = APIRouter()
router.include_router(_crud_router)
router.include_router(_lifecycle_router)
router.include_router(_payments_router)
router.include_router(_crew_hub_router)
router.include_router(_invites_router)
router.include_router(_lineup_router)
router.include_router(_waitlist_router)

__all__ = ['router']


