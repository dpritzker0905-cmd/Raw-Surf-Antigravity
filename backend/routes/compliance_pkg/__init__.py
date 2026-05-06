"""Compliance package — ToS, violations, appeals, GDPR data management."""
from fastapi import APIRouter

from .violations import router as violations_router
from .tos import router as tos_router
from .gdpr import router as gdpr_router

# Re-export a single router that includes all sub-routers
router = APIRouter()
router.include_router(violations_router)
router.include_router(tos_router)
router.include_router(gdpr_router)
