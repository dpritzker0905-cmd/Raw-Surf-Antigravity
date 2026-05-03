"""AI package -- tagging, health monitoring, and ML-powered features."""
from fastapi import APIRouter

from .ai_tagging import router as ai_tagging_router
from .ai_health import router as ai_health_router

router = APIRouter()
router.include_router(ai_tagging_router)
router.include_router(ai_health_router)
