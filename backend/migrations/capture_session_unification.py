"""
Capture Session Unification Migration
Extends LiveSession to become the unified CaptureSession model.
Adds session_mode field and updates participant role tracking.
"""
import asyncio
from sqlalchemy import text
from database import engine

async def run_migration():
    """Add CaptureSession unification columns to live_sessions and live_session_participants"""
    
    async with engine.begin() as conn:
        # ============ LIVE_SESSIONS UPDATES ============
        # Add session_mode: 'live_join', 'on_demand', 'scheduled'
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS session_mode VARCHAR(30) DEFAULT 'live_join'
            """))
            print("Added session_mode column to live_sessions")
        except Exception as e:
            print(f"session_mode column may already exist: {e}")
        
        # Add dispatch_request_id for On-Demand sessions
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS dispatch_request_id VARCHAR(36) REFERENCES dispatch_requests(id) ON DELETE SET NULL
            """))
            print("Added dispatch_request_id column to live_sessions")
        except Exception as e:
            print(f"dispatch_request_id column may already exist: {e}")
        
        # Add booking_id for Scheduled sessions
        try:
            await conn.execute(text("""
                ALTER TABLE live_sessions 
                ADD COLUMN IF NOT EXISTS booking_id VARCHAR(36) REFERENCES bookings(id) ON DELETE SET NULL
            """))
            print("Added booking_id column to live_sessions")
        except Exception as e:
            print(f"booking_id column may already exist: {e}")
        
        # ============ LIVE_SESSION_PARTICIPANTS UPDATES ============
        # Add participant_role: 'creator' or 'participant'
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS participant_role VARCHAR(30) DEFAULT 'participant'
            """))
            print("Added participant_role column to live_session_participants")
        except Exception as e:
            print(f"participant_role column may already exist: {e}")
        
        # Add photos_credit_remaining: Track how many "free" photos the participant has left
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS photos_credit_remaining INTEGER DEFAULT 0
            """))
            print("Added photos_credit_remaining column to live_session_participants")
        except Exception as e:
            print(f"photos_credit_remaining column may already exist: {e}")
        
        # Add resolution_preference: 'web', 'standard', 'high'
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS resolution_preference VARCHAR(20) DEFAULT 'standard'
            """))
            print("Added resolution_preference column to live_session_participants")
        except Exception as e:
            print(f"resolution_preference column may already exist: {e}")
        
        # Add parent_buyer_id: For Grom accounts where parent is the paying party
        try:
            await conn.execute(text("""
                ALTER TABLE live_session_participants 
                ADD COLUMN IF NOT EXISTS parent_buyer_id VARCHAR(36) REFERENCES profiles(id) ON DELETE SET NULL
            """))
            print("Added parent_buyer_id column to live_session_participants")
        except Exception as e:
            print(f"parent_buyer_id column may already exist: {e}")
        
        print("\nCaptureSession unification migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_migration())
