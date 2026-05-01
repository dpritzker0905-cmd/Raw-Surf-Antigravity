"""
Sessions package — modular decomposition.
Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter
router = APIRouter()

from .join import router as join_router
from .payments import router as payments_router
from .active import router as active_router
from .pricing import router as pricing_router

router.include_router(join_router)
router.include_router(payments_router)
router.include_router(active_router)
router.include_router(pricing_router)
