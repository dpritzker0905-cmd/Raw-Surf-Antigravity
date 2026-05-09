"""
Surf spots package — modular decomposition of the surf_spots domain.

Replaces the 2,933-line surf_spots.py monolith with focused modules:
  - schemas.py:        Pydantic models, Privacy Shield helpers, coastline offset
  - spots.py:          Core CRUD (list, locations, nearby, detail)
  - live.py:           Live photographer lifecycle (go-live, stop, toggle, list)
   - admin_spots.py:    Admin CRUD, hierarchy, merge, seeding
   - spot_dedup.py:     Exact-name and near-name dedup + FK re-parenting
  - spot_seeding.py:   Florida spot seeding, coordinate/image updates
  - admin_sessions.py: Admin session management (simulate, force start/end, cleanup)
  - refinements.py:    Crowdsourced spot location refinement queue
  - spot_of_day.py:    Spot of the Day social discovery engine
  - conditions.py:     Surf conditions auto-fetch + live shooting pulse
  - crowd.py:          Crowd prediction heatmap + optimal surf time

Exports a single `router` so routes/__init__.py can import unchanged.
"""

from fastapi import APIRouter

router = APIRouter()

from .spots import router as spots_router
from .live import router as live_router
from .admin_spots import router as admin_spots_router
from .spot_seeding import router as spot_seeding_router
from .admin_sessions import router as admin_sessions_router
from .refinements import router as refinements_router
from .spot_of_day import router as spot_of_day_router
from .conditions import router as conditions_router
from .crowd import router as crowd_router
from .spot_dedup import router as spot_dedup_router
from .spot_admin import router as spot_admin_router
from .spot_admin import verification_router

router.include_router(spots_router)
router.include_router(live_router)
router.include_router(admin_spots_router)
router.include_router(spot_seeding_router)
router.include_router(admin_sessions_router)
router.include_router(refinements_router)
router.include_router(spot_of_day_router)
router.include_router(conditions_router)
router.include_router(crowd_router)
router.include_router(spot_dedup_router)
router.include_router(spot_admin_router)
router.include_router(verification_router)

