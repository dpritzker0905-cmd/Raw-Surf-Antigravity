"""Split dispatch_monolith.py.bak into sub-modules."""
import os

MONOLITH = os.path.join(os.path.dirname(__file__), '..', 'dispatch_monolith.py.bak')
OUT_DIR = os.path.dirname(__file__)

with open(MONOLITH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

SHARED_IMPORTS = '''"""
{docstring}

Part of the dispatch package -- extracted from dispatch.py monolith.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import math
import os
import json
import stripe
from utils.geo import haversine_distance

from database import get_db
from models import (
    Profile, DispatchRequest, DispatchRequestParticipant,
    DispatchNotification, DispatchRequestStatusEnum, SurfSpot,
    Booking, BookingParticipant, CreditTransaction, RoleEnum, Notification,
    PaymentTransaction, SessionSnapshot, CancellationExceptionRequest,
    Surfboard
)
from utils.parental_alerts import check_and_send_spending_alert
from services.onesignal_service import onesignal_service

from .schemas import (
    CreateDispatchRequest, AcceptDispatchRequest, UpdateGPSLocation,
    CancelDispatchRequest, UpdateSessionLocationRequest, UpdateSelfieRequest,
    BoostRequestCreate, DispatchCheckoutRequest, ExceptionRequestBody,
    ExceptionResolveBody, CrewPaymentRequest, CrewCheckoutRequest,
    CoverRemainingRequest, RemindCrewRequest,
    get_available_pros, _get_surfer_board_description
)

logger = logging.getLogger("routes.dispatch")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")

router = APIRouter(prefix="/dispatch", tags=["dispatch"])
'''


def write_module(filename, docstring, body_lines):
    header = SHARED_IMPORTS.format(docstring=docstring)
    path = os.path.join(OUT_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write('\n')
        for line in body_lines:
            f.write(line)
    print(f"  [OK] {filename}: {len(body_lines)} lines")


# -- Schemas + Helpers (no router needed) --
schemas_body = lines[0:211]  # Includes imports, schemas, helper functions
path = os.path.join(OUT_DIR, 'schemas.py')
with open(path, 'w', encoding='utf-8') as f:
    f.write('"""Dispatch schemas and shared helpers."""\n')
    for line in schemas_body:
        f.write(line)
print(f"  [OK] schemas.py: {len(schemas_body)} lines")


# -- Sessions (core request lifecycle): L213-1030 --
sessions_body = lines[212:1030]
write_module('sessions.py', 'Core dispatch session lifecycle -- create, pay, checkout, payment-success.', sessions_body)

# -- Lifecycle (accept/decline/arrive/complete/cancel): L1031-1890 --
lifecycle_body = lines[1030:1890]
write_module('lifecycle.py', 'Session lifecycle -- accept, decline, update-location, arrived, complete, cancel.', lifecycle_body)

# -- Exceptions: L1889-2116 --
exceptions_body = lines[1888:2116]
write_module('exceptions.py', 'Cancellation exception requests and resolution.', exceptions_body)

# -- Status/queries: L2117-2700 --
status_body = lines[2116:2700]
write_module('status.py', 'Dispatch status queries -- get dispatch, active, photographer pending, crew-status, verify-payment.', status_body)

# -- Crew: L2701-3200 --
crew_body = lines[2700:3200]
write_module('crew.py', 'Crew management -- invites, decline, crew pay, crew checkout, tracking.', crew_body)

# -- Boost & Stats: L3244-3492 --
boost_body = lines[3243:3492]
write_module('boost.py', 'Request boost and photographer on-demand stats/history.', boost_body)

# -- Crew Progress: L3493-end --
progress_body = lines[3492:]
write_module('progress.py', 'Crew payment progress -- cover remaining, remind crew.', progress_body)

# Count routes
monolith_count = sum(1 for l in lines if '@router.' in l and ('get(' in l or 'post(' in l or 'put(' in l or 'patch(' in l or 'delete(' in l))
print(f"\nMonolith route count: {monolith_count}")
print("Split complete!")
