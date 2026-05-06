"""Sessions schemas — Pydantic models and imports."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import json
import os
import stripe

from database import get_db
from models import Profile, SurfSpot, LiveSessionParticipant, Notification, RoleEnum, Post, CreditTransaction, XPTransaction, LiveSession, PaymentTransaction
from utils.credits import deduct_credits, add_credits
from datetime import timedelta

# Import badge check function
from routes.career_hub.gamification import check_badge_milestones
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()

logger = logging.getLogger(__name__)
# Initialize Stripe - read both common env var names as fallback
# STRIPE_SECRET_KEY is standard Stripe name (used in dispatch.py); STRIPE_API_KEY is legacy
STRIPE_API_KEY = (os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY'))
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

class JoinSessionRequest(BaseModel):
    photographer_id: str
    selfie_url: Optional[str] = None
    payment_method: str = 'credits'
    effective_role: Optional[str] = None  # For God Mode persona masking
    resolution: Optional[str] = 'standard'  # CaptureSession: 'web', 'standard', 'high'
    use_account_credits: bool = False  # CaptureSession: Use account credits first
    origin_url: Optional[str] = None  # For Stripe redirect

class SessionParticipantResponse(BaseModel):
    id: str
    surfer_id: str
    surfer_name: Optional[str]
    surfer_avatar: Optional[str]
    selfie_url: Optional[str]
    amount_paid: float
    payment_method: Optional[str]
    status: str
    joined_at: datetime

class ActiveSessionResponse(BaseModel):
    photographer_id: str
    photographer_name: Optional[str]
    spot_id: Optional[str]
    spot_name: Optional[str]
    session_price: float
    participants_count: int
    participants: List[SessionParticipantResponse]

