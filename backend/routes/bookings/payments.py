"""
bookings/payments.py — Stripe checkout, crew split payment requests

ROUTES IN THIS DOMAIN (7 total):
#   L1095: /bookings/{booking_id}/send-split-requests -> send_split_payment_requests
#   L1315: /bookings/create-with-stripe -> create_booking_with_stripe
#   L1501: /bookings/payment-success -> booking_payment_success
#   L1962: /bookings/{booking_id}/send-crew-requests -> send_crew_payment_requests
#   L2946: /bookings/{booking_id}/update-splits -> update_payment_splits
#   L3365: /bookings/{booking_id}/crew-hub/handle-expiry -> handle_payment_window_expiry
#   L3512: /bookings/{booking_id}/crew-payment-details -> get_crew_payment_details

STATUS: Stub created by split-bookings.py.
TODO: Move route implementations from _monolith.py into this file.

MIGRATION STEPS:
1. Move the matched routes from _monolith.py here
2. Add required imports from the monolith header
3. Remove moved routes from _monolith.py
4. Verify: python -c "from backend.routes.bookings.payments import router"
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List
import logging

# TODO: Copy remaining imports from _monolith.py as needed
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Routes ────────────────────────────────────────────────────────────────────
# TODO: Move 7 route(s) from _monolith.py to here.
# See route list above for exact line numbers.
