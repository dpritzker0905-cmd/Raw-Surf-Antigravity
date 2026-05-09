"""Reviews package -- photographer and session reviews, moderation."""
from fastapi import APIRouter

from .reviews import router as reviews_router
from .review_moderation import router as review_moderation_router

router = APIRouter()
router.include_router(reviews_router)
router.include_router(review_moderation_router)
