"""AI package -- tagging, health monitoring, vision analysis, and ML-powered features."""
from fastapi import APIRouter

from .ai_tagging import router as ai_tagging_router
from .ai_health import router as ai_health_router
# ai_vision.py has no router — it provides helper functions imported by ai_tagging.py

router = APIRouter()
router.include_router(ai_tagging_router)
router.include_router(ai_health_router)

