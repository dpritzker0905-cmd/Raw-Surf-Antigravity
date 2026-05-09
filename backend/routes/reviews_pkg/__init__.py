"""Reviews package -- photographer and session reviews, moderation, discovery."""
from fastapi import APIRouter

from .reviews import router as reviews_router
from .review_moderation import router as review_moderation_router
from .review_discovery import router as review_discovery_router

router = APIRouter()
router.include_router(reviews_router)
router.include_router(review_moderation_router)
router.include_router(review_discovery_router)
