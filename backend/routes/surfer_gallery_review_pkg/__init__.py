"""
Surfer Gallery Review package — AI-powered photo matching and claiming.

Modules:
  - schemas.py:       Pydantic models and helper functions
  - entitlements.py:  Session entitlement checks, resolution upsell/upgrade
  - claims.py:        Proposed matches, single/batch claim, dismiss, confirm identity
  - ai_matching.py:   AI session listing, photo analysis, batch analysis
  - self_claim.py:    "That's me!" self-claim endpoint

Exports a single `router` for backward-compatible registration.
"""
from fastapi import APIRouter

router = APIRouter()

from .entitlements import router as entitlements_router
from .claims import router as claims_router
from .ai_matching import router as ai_matching_router
from .self_claim import router as self_claim_router

router.include_router(entitlements_router)
router.include_router(claims_router)
router.include_router(ai_matching_router)
router.include_router(self_claim_router)
