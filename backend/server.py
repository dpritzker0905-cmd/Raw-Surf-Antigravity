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
    Startup health check - ensures all SQLAlchemy model tables exist in PostgreSQL.
    Creates missing tables without affecting existing ones.
    """
    from sqlalchemy import text
    import models  # Import all models to register them with Base
    
    async with engine.begin() as conn:
        # Get existing tables
        result = await conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
        )
        existing_tables = {row[0] for row in result.fetchall()}
        
        # Get all model tables
        model_tables = set(Base.metadata.tables.keys())
        
        # Find missing tables
        missing_tables = model_tables - existing_tables
        
        if missing_tables:
            logger.warning(f"[DB Health] Missing tables detected: {missing_tables}")
            # Create only missing tables
            await conn.run_sync(Base.metadata.create_all)
            logger.info(f"[DB Health] Created {len(missing_tables)} missing tables: {missing_tables}")
        else:
            logger.info(f"[DB Health] All {len(model_tables)} tables present ✓")


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
    allow_origins=["*"],
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
