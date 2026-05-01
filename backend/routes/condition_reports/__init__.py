"""
Condition reports package — modular decomposition.
Exports a single `router` for backward compatibility.
"""
from fastapi import APIRouter
router = APIRouter()

from .feed import router as feed_router
from .crud import router as crud_router
from .admin import router as admin_router

router.include_router(feed_router)
router.include_router(crud_router)
router.include_router(admin_router)
