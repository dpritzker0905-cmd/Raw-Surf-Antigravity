"""
Grom HQ package — modular decomposition of the grom headquarters domain.
Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter
router = APIRouter()

from .parental import router as parental_router
from .verification import router as verification_router
from .monitoring import router as monitoring_router
from .family import router as family_router
from .purchases import router as purchases_router

router.include_router(parental_router)
router.include_router(verification_router)
router.include_router(monitoring_router)
router.include_router(family_router)
router.include_router(purchases_router)
