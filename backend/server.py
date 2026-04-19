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
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY


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
            
            # Handle in separate session
            from database import async_session_maker
            async with async_session_maker() as db:
                result = await db.execute(
                    select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
                )
                transaction = result.scalar_one_or_none()
                
                if transaction and transaction.payment_status != 'completed':
                    transaction.payment_status = 'completed'
                    transaction.status = 'completed'
                    
                    metadata = json.loads(transaction.transaction_metadata) if transaction.transaction_metadata else {}
                    
                    if 'credits' in metadata:
                        credits_to_add = int(metadata.get('credits', 0))
                        if credits_to_add > 0:
                            profile_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
                            profile = profile_result.scalar_one_or_none()
                            if profile:
                                profile.credit_balance = (profile.credit_balance or 0) + credits_to_add
                    
                    elif 'tier_name' in metadata:
                        tier_name = metadata.get('tier_name', 'basic')
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
