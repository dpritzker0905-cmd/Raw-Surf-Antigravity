"""Subscriptions & Billing package — subscriptions, photo subscriptions, credits."""
from fastapi import APIRouter

from .subscriptions import router as subscriptions_router
from .photo_subscriptions import router as photo_subscriptions_router
from .credits import router as credits_router
from .payments import router as payments_router

router = APIRouter()
router.include_router(subscriptions_router)
router.include_router(photo_subscriptions_router)
router.include_router(credits_router)
router.include_router(payments_router)
