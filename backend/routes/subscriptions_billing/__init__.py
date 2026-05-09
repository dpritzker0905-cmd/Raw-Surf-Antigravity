"""Subscriptions & Billing package — subscriptions, photo subscriptions, credits, payments, credit payments, lifecycle."""
from fastapi import APIRouter

from .subscriptions import router as subscriptions_router
from .photo_subscriptions import router as photo_subscriptions_router
from .credits import router as credits_router
from .payments import router as payments_router
from .subscriptions_credits import router as subscriptions_credits_router
from .subscription_lifecycle import router as subscription_lifecycle_router

router = APIRouter()
router.include_router(subscriptions_router)
router.include_router(photo_subscriptions_router)
router.include_router(credits_router)
router.include_router(payments_router)
router.include_router(subscriptions_credits_router)
router.include_router(subscription_lifecycle_router)

