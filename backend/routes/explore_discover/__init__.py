"""Explore & Discovery package — explore, search, geolocation, spot details."""
from fastapi import APIRouter

from .explore import router as explore_router
from .spot_details import router as spot_details_router
from .search import router as search_router
from .geolocation import router as geolocation_router

router = APIRouter()
router.include_router(explore_router)
router.include_router(spot_details_router)
router.include_router(search_router)
router.include_router(geolocation_router)
