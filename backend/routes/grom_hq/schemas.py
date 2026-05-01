"""Grom HQ schemas and imports."""
"""
Grom HQ API Routes
Parental management for Grom accounts
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from database import get_db
from models import Profile, RoleEnum
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import stripe
import os
import json
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter(prefix="/grom-hq", tags=["grom-hq"])

# Configure Stripe
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")


# ============ PYDANTIC MODELS ============

class ParentalControlsUpdate(BaseModel):
    can_post: Optional[bool] = None
    can_stream: Optional[bool] = None
    can_message: Optional[bool] = None
    can_comment: Optional[bool] = None
    view_only: Optional[bool] = None


class UnlinkRequest(BaseModel):
    password: str


class LinkByCodeRequest(BaseModel):
    guardian_code: str


class AgeVerificationRequest(BaseModel):
    return_url: Optional[str] = None


class ToggleCompetitionRequest(BaseModel):
    competes: bool


