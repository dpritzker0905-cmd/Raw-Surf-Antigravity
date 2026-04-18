"""
bookings/__init__.py - Bookings package router composition

Architecture: Strangler Fig Pattern — MIGRATION COMPLETE
=========================================================
The bookings domain has been fully migrated from a 5,171-line monolith
into 5 focused domain modules:

  crud.py       — Core CRUD: list, get, create, cancel, complete, share
  payments.py   — Stripe checkout, crew pay, splits, crew hub, escrow
  invites.py    — Crew invites, join-by-code, invite-by-handle, respond
  lineup.py     — Lineup: open, join, leave, lock, close, status, reservation
  waitlist.py   — Waitlist: join, leave, claim, keep-seat

The combined router is exported as `router` for backward compatibility — all
existing imports in routes/__init__.py continue to work without change:

    from .bookings import router as bookings_router  # routes/__init__.py

ROLLBACK PLAN:
  If any domain causes issues, revert to _monolith.py by changing the
  last line of this file to:
      from ._monolith import router

DOMAIN ROUTING TABLE (57 total routes):
  crud.py       (13 routes): /bookings, /bookings/user, /bookings/create,
                              /bookings/{id}/cancel|complete|content-delivered|share-to-feed|share-link,
                              /bookings/nearby, /bookings/{id} PATCH, /sessions/*,
                              /photographers/directory
  payments.py   (19 routes): /bookings/{id}/send-split-requests, /bookings/create-with-stripe,
                              /bookings/payment-success, /bookings/{id}/join|enable-splitting|join-by-code,
                              /bookings/{id}/crew-status|nudge|nudge-all|update-splits,
                              /bookings/{id}/crew-hub/*, /bookings/{id}/crew-payment-details|crew-pay,
                              /bookings/{id}/participant-selfie, /bookings/invites/{user_id}
  invites.py    (8 routes):  /bookings/{id}/request-join|invite|send-crew-requests|search-users,
                              /bookings/{id}/invite-by-handle|invite-crew|invite-suggestions,
                              /bookings/invites/{invite_id}/respond
  lineup.py     (10 routes): /bookings/lineups, /bookings/{id}/lineup/*,
                              /bookings/{id}/reservation-settings GET+PATCH
  waitlist.py   (6 routes):  /bookings/{id}/waitlist/join|leave|claim,
                              /bookings/{id}/waitlist, /bookings/{id}/keep-seat|keep-seat-status
"""
from fastapi import APIRouter

from .crud import router as _crud_router
from .payments import router as _payments_router
from .invites import router as _invites_router
from .lineup import router as _lineup_router
from .waitlist import router as _waitlist_router

# Compose a single combined router from all domain sub-routers
router = APIRouter()
router.include_router(_crud_router)
router.include_router(_payments_router)
router.include_router(_invites_router)
router.include_router(_lineup_router)
router.include_router(_waitlist_router)

__all__ = ['router']
