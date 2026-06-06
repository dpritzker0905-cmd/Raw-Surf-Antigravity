import sys
import os
sys.path.append(os.path.abspath("backend"))

import asyncio
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select
from models.profile import Profile
from models.enums import RoleEnum
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def seed_db(db_path):
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    print(f"Seeding database: {db_path}")
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    session_maker = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    
    async with session_maker() as db:
        password_hash = pwd_context.hash("Test123!")
        
        # 1. Seed David Pritzker
        result = await db.execute(select(Profile).where(Profile.id == "12dc6786-124f-40b1-8698-a9409f99736f"))
        profile = result.scalar_one_or_none()
        
        if profile:
            print("David Pritzker profile already exists. Updating...")
            profile.email = "dpritzker0905@gmail.com"
            profile.username = "davidpritzker"
            profile.role = RoleEnum.PHOTOGRAPHER
            profile.subscription_tier = "premium"
            profile.is_admin = True
            profile.password_hash = password_hash
            profile.is_ad_supported = False
        else:
            print("Creating David Pritzker profile...")
            profile = Profile(
                id="12dc6786-124f-40b1-8698-a9409f99736f",
                user_id="12dc6786-124f-40b1-8698-a9409f99736f",
                email="dpritzker0905@gmail.com",
                password_hash=password_hash,
                full_name="David Pritzker",
                username="davidpritzker",
                role=RoleEnum.PHOTOGRAPHER,
                subscription_tier="premium",
                is_admin=True,
                is_ad_supported=False,
                credit_balance=100.0,
                withdrawable_credits=100.0,
                created_at=datetime.now(timezone.utc)
            )
            db.add(profile)

        # 2. Seed Sean Stanhope
        result_sean = await db.execute(select(Profile).where(Profile.id == "a8d52460-cdea-4977-b718-c8722c5c262d"))
        sean = result_sean.scalar_one_or_none()
        
        if sean:
            print("Sean Stanhope profile already exists. Updating...")
            sean.email = "seanstanhope@gmail.com"
            sean.username = "sean"
            sean.role = RoleEnum.GROM
            sean.subscription_tier = "premium"
            sean.password_hash = password_hash
            sean.is_ad_supported = False
        else:
            print("Creating Sean Stanhope profile...")
            sean = Profile(
                id="a8d52460-cdea-4977-b718-c8722c5c262d",
                user_id="a8d52460-cdea-4977-b718-c8722c5c262d",
                email="seanstanhope@gmail.com",
                password_hash=password_hash,
                full_name="Sean Stanhope",
                username="sean",
                role=RoleEnum.GROM,
                subscription_tier="premium",
                is_ad_supported=False,
                credit_balance=50.0,
                created_at=datetime.now(timezone.utc)
            )
            db.add(sean)
        
        await db.commit()
        print("Profiles seeded successfully.")
        
    await engine.dispose()

async def main():
    await seed_db("dev.db")
    await seed_db("backend/dev.db")

if __name__ == "__main__":
    asyncio.run(main())
