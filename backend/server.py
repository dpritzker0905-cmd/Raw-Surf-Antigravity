"""
Raw Surf OS API Server
Refactored to use modular routers for better maintainability
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging
from pathlib import Path
from dotenv import load_dotenv
import json
import stripe

from database import engine, Base
from routes import api_router
from scheduler import start_scheduler, stop_scheduler

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env', override=True)  # Override system env vars with .env values

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
# ── Safety guard: never run live Stripe from this codebase until explicitly approved ──
# If a live key is accidentally set in the Render env, fall back to test mode.
STRIPE_TEST_FALLBACK = 'sk_test_Ee0EXjPggntbOEG89DFJiUT4'
if STRIPE_API_KEY and STRIPE_API_KEY.startswith('sk_live_'):
    logger.critical(
        "[STRIPE] ⚠️  LIVE key detected in STRIPE_API_KEY env var! "
        "Falling back to TEST key. Update STRIPE_API_KEY in Render dashboard to a sk_test_ key."
    )
    STRIPE_API_KEY = STRIPE_TEST_FALLBACK
elif not STRIPE_API_KEY:
    STRIPE_API_KEY = STRIPE_TEST_FALLBACK
stripe.api_key = STRIPE_API_KEY
logger.info(f"[STRIPE] Running in {'TEST' if STRIPE_API_KEY.startswith('sk_test_') else 'LIVE'} mode")


async def ensure_database_tables():
    """
    Startup schema migration - ensures all SQLAlchemy model tables AND columns
    exist in PostgreSQL. Runs on every startup (idempotent - safe to run repeatedly).

    This handles two cases:
    1. New tables: created via create_all()
    2. New columns on existing tables: ALTER TABLE ADD COLUMN IF NOT EXISTS
       This is the fix for 'missing column' errors that cause network-level failures
       when the production DB hasn't had the migration SQL applied manually.
    """
    from sqlalchemy import text, inspect
    import models  # registers all models with Base.metadata

    async with engine.begin() as conn:
        # ── STEP 1: Create any completely missing tables ──────────────────────
        result = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        )
        existing_tables = {row[0] for row in result.fetchall()}
        model_tables = set(Base.metadata.tables.keys())
        missing_tables = model_tables - existing_tables

        if missing_tables:
            logger.warning(f"[DB Migration] Creating {len(missing_tables)} missing tables: {missing_tables}")
            await conn.run_sync(Base.metadata.create_all)
            logger.info(f"[DB Migration] ✓ Tables created: {missing_tables}")
        else:
            logger.info(f"[DB Migration] ✓ All {len(model_tables)} tables present")

        # ── STEP 2: Add any missing columns to existing tables ────────────────
        # This handles the case where new columns are added to a model but the
        # production DB hasn't been manually migrated (ALTER TABLE run).
        columns_added = 0
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                continue  # New table was just created above - skip

            # Get columns that actually exist in the DB for this table
            col_result = await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name=:tname"
                ),
                {"tname": table_name},
            )
            existing_cols = {row[0] for row in col_result.fetchall()}

            for col in table.columns:
                if col.name in existing_cols:
                    continue  # Column already exists - skip

                # Build a safe ALTER TABLE statement from the SQLAlchemy column type
                try:
                    # Compile the column type to a PostgreSQL type string
                    col_type = col.type.compile(dialect=conn.dialect)
                except Exception:
                    col_type = "TEXT"  # Safe fallback for complex types

                nullable_clause = "" if col.nullable else " NOT NULL"
                default_clause = ""
                if col.default is not None and hasattr(col.default, "arg"):
                    arg = col.default.arg
                    if isinstance(arg, (int, float)):
                        default_clause = f" DEFAULT {arg}"
                    elif isinstance(arg, bool):
                        default_clause = f" DEFAULT {'TRUE' if arg else 'FALSE'}"
                    elif isinstance(arg, str):
                        escaped = arg.replace("'", "''")
                        default_clause = f" DEFAULT '{escaped}'"

                alter_sql = (
                    f"ALTER TABLE {table_name} "
                    f"ADD COLUMN IF NOT EXISTS {col.name} {col_type}"
                    f"{default_clause}{nullable_clause}"
                )
                try:
                    await conn.execute(text(alter_sql))
                    columns_added += 1
                    logger.info(f"[DB Migration] ✓ Added column: {table_name}.{col.name} ({col_type})")
                except Exception as col_err:
                    logger.warning(f"[DB Migration] ⚠ Could not add {table_name}.{col.name}: {col_err}")

        if columns_added > 0:
            logger.info(f"[DB Migration] ✓ Added {columns_added} missing columns to existing tables")
        else:
            logger.info("[DB Migration] ✓ All columns present - schema is up to date")

        # ── STEP 3: Widen specific column types that are too narrow ──────────
        # Check and widen avatar_url from VARCHAR(500) to TEXT.
        # VARCHAR(500) cannot store a compressed base64 avatar (~110,000 chars).
        type_result = await conn.execute(
            text(
                "SELECT data_type, character_maximum_length "
                "FROM information_schema.columns "
                "WHERE table_name='profiles' AND column_name='avatar_url'"
            )
        )
        avatar_col = type_result.fetchone()
        if avatar_col and avatar_col[0] == 'character varying':
            await conn.execute(
                text("ALTER TABLE profiles ALTER COLUMN avatar_url TYPE TEXT")
            )
            logger.info("[DB Migration] ✓ Widened profiles.avatar_url: VARCHAR(500) → TEXT")
        else:
            logger.info("[DB Migration] ✓ profiles.avatar_url already TEXT or absent")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Raw Surf OS API...")
    # Database health check - ensure all tables exist
    await ensure_database_tables()
    # Start background scheduler
    start_scheduler()
    yield
    logger.info("Shutting down Raw Surf OS API...")
    # Stop background scheduler
    stop_scheduler()
    await engine.dispose()

app = FastAPI(
    title="Raw Surf OS API",
    description="Comprehensive 15-persona social marketplace for the surf economy",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.netlify\.app|https://.*\.render\.com|http://localhost:.*|http://127\.0\.0\.1:.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the main API router with all sub-routers
app.include_router(api_router)

# Stripe Webhook Handler (kept at root level for proper signature verification)
@app.post("/api/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhooks using standard SDK"""
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy import select
    from database import get_db
    from models import PaymentTransaction, Profile
    
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    endpoint_secret = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
    
    try:
        if endpoint_secret and signature:
            event = stripe.Webhook.construct_event(body, signature, endpoint_secret)
        else:
            event = json.loads(body)
        
        if event.get('type') == 'checkout.session.completed':
            session = event['data']['object']
            session_id = session.get('id')
            metadata = session.get('metadata', {})

            from database import async_session_maker

            # ── Crew share card payment ──────────────────────────────────────────
            if metadata.get('type') == 'crew_share':
                participant_id = metadata.get('participant_id')
                payer_id = metadata.get('payer_id')
                logger.info(f"[Webhook] crew_share payment: participant={participant_id} payer={payer_id}")
                if participant_id and payer_id:
                    from models import DispatchRequestParticipant, DispatchRequest
                    from sqlalchemy import select as sa_select
                    from sqlalchemy.orm import selectinload as sa_load
                    from datetime import datetime, timezone

                    async with async_session_maker() as db:
                        p_result = await db.execute(
                            sa_select(DispatchRequestParticipant)
                            .where(DispatchRequestParticipant.id == participant_id)
                            .options(sa_load(DispatchRequestParticipant.dispatch_request))
                        )
                        participant = p_result.scalar_one_or_none()
                        if participant and not participant.paid:
                            participant.status = 'paid'
                            participant.paid = True
                            participant.paid_at = datetime.now(timezone.utc)
                            participant.payer_name = metadata.get('payer_name', '')
                            participant.payer_username = metadata.get('payer_username', '')
                            participant.payer_avatar_url = metadata.get('payer_avatar_url', '')
                            # Check if all crew paid → mark dispatch fully funded
                            dispatch = participant.dispatch_request
                            if dispatch:
                                all_p_result = await db.execute(
                                    sa_select(DispatchRequestParticipant)
                                    .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
                                )
                                all_ps = all_p_result.scalars().all()
                                paid_count = sum(
                                    1 for p in all_ps
                                    if p.paid or p.id == participant_id
                                )
                                if paid_count >= len(all_ps) and dispatch.deposit_paid:
                                    dispatch.all_participants_paid = True
                                    dispatch.all_participants_paid_at = datetime.now(timezone.utc)
                            await db.commit()
                            logger.info(f"[Webhook] crew_share paid: participant {participant_id}")

            # ── Standard credit purchase / subscription ──────────────────────────
            else:
                async with async_session_maker() as db:
                    result = await db.execute(
                        select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
                    )
                    transaction = result.scalar_one_or_none()
                    
                    if transaction and transaction.payment_status != 'completed':
                        transaction.payment_status = 'completed'
                        transaction.status = 'completed'
                        
                        tx_metadata = json.loads(transaction.transaction_metadata) if transaction.transaction_metadata else {}
                        
                        if 'credits' in tx_metadata:
                            credits_to_add = int(tx_metadata.get('credits', 0))
                            if credits_to_add > 0:
                                profile_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
                                profile = profile_result.scalar_one_or_none()
                                if profile:
                                    profile.credit_balance = (profile.credit_balance or 0) + credits_to_add
                        
                        elif 'tier_name' in tx_metadata:
                            tier_name = tx_metadata.get('tier_name', 'basic')
                            profile_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
                            profile = profile_result.scalar_one_or_none()
                            if profile:
                                profile.subscription_tier = tier_name
                        
                        await db.commit()
                        logger.info(f"Webhook processed: session {session_id} marked as completed")
        
        return {"status": "received"}
        
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Webhook signature verification failed: {str(e)}")
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        logger.error(f"Webhook error: {str(e)}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Webhook error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
