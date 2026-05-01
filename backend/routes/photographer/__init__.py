"""
Photographer package -- modular decomposition of the photographer domain.

Replaces the 3,392-line photographer.py monolith with focused modules:
  - schemas.py:       Pydantic models, enums, and shared helpers
  - pricing.py:       Pricing CRUD, gallery pricing tiers, earnings dashboard
  - availability.py:  Calendar, availability windows, block/unblock, slot generation
  - bookings.py:      Booking CRUD, status management, detail editing
  - participants.py:  Live session participant listing and identification notes
  - sessions.py:      Session lifecycle (go-live, end-session, history)
  - discovery.py:     Public photographer discovery (live, featured)
  - on_demand.py:     On-demand toggle, status, stats, XP/gamification
  - settings.py:      On-demand configuration and watermark customization

Exports a single `router` so routes/__init__.py can import unchanged.
"""

from fastapi import APIRouter

router = APIRouter()

from .pricing import router as pricing_router
from .availability import router as availability_router
from .bookings import router as bookings_router
from .participants import router as participants_router
from .sessions import router as sessions_router
from .discovery import router as discovery_router
from .on_demand import router as on_demand_router
from .settings import router as settings_router

router.include_router(pricing_router)
router.include_router(availability_router)
router.include_router(bookings_router)
router.include_router(participants_router)
router.include_router(sessions_router)
router.include_router(discovery_router)
router.include_router(on_demand_router)
router.include_router(settings_router)
