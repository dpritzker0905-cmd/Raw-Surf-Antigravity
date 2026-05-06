"""Commerce package -- ads, pricing config, gear hub."""
from fastapi import APIRouter

from .ad_controls import router as ad_controls_router
from .pricing_config import router as pricing_config_router
from .gear_hub import router as gear_hub_router

router = APIRouter()
router.include_router(ad_controls_router)
router.include_router(pricing_config_router)
router.include_router(gear_hub_router)
