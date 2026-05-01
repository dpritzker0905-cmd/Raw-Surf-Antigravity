"""
Surfer gallery package — modular decomposition of the surfer gallery domain.

Modules:
  - schemas.py:       Pydantic models and helpers
  - gallery_core.py:  Locker scanning, gallery listing, visibility, favorites
  - claims.py:        Claim queue actions, downloads, booking additions, public gallery
  - selection.py:     Included photos selection system, session browsing

Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/surfer-gallery", tags=["surfer-gallery"])

from .gallery_core import router as core_router
from .claims import router as claims_router
from .selection import router as selection_router

router.include_router(core_router)
router.include_router(claims_router)
router.include_router(selection_router)
