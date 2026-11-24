"""PostgreSQL-only qualification, invoked explicitly by the paid-seat CI job."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import CreateSchema

from database import Base
from models import LiveSessionParticipant, PaymentTransaction
from scripts.live_seat_readonly_worker import waiting_count
from tests.test_live_seat_recovery import check_outcome
from tests.test_live_session_escrow import seeded_seat_harness


MIGRATION = (Path(__file__).resolve().parents[2] / "supabase" / "migrations"
             / "20261120042000_unique_live_session_active_seat.sql")


@pytest_asyncio.fixture
async def legacy_engine():
    # Connect only to the named disposable service. Never use the application DATABASE_URL.
    port = int(os.environ["LIVE_SEAT_TEST_PORT"])
    admin = await asyncpg.connect(host="127.0.0.1", port=port, user="postgres", database="live_seat_test")
    name = f"seat_case_{uuid4().hex}"
    try:
        # Model DDL revokes table access from these Supabase roles on PostgreSQL.
        for role in ("anon", "authenticated", "service_role"):
            await admin.execute(f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                                "EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        await admin.execute(f'CREATE DATABASE "{name}"')
        engine = create_async_engine(URL.create("postgresql+asyncpg", username="postgres",
                                                host="127.0.0.1", port=port, database=name))
        try:
            async with engine.begin() as conn:
                for schema in sorted({table.schema for table in Base.metadata.tables.values() if table.schema}):
                    await conn.execute(CreateSchema(schema, if_not_exists=True))
                await conn.run_sync(Base.metadata.create_all)
                # Reconstruct the pre-#1110 state so the checked-in SQL supplies the real index.
                await conn.exec_driver_sql("DROP INDEX public.uq_live_session_active_seat")
            yield engine
        finally:
            await engine.dispose()
            await admin.execute(f'DROP DATABASE "{name}"')
    finally:
        await admin.close()


async def test_existing_active_duplicates_stop_migration(legacy_engine):
    async with seeded_seat_harness(legacy_engine) as harness:
        async with harness.maker() as db:
            seats = [LiveSessionParticipant(photographer_id="pro", surfer_id="owner", status="active")
                     for _ in range(2)]
            db.add_all(seats)
            await db.commit()
            with pytest.raises(IntegrityError) as caught:
                async with legacy_engine.begin() as conn:
                    await conn.exec_driver_sql(MIGRATION.read_text(encoding="utf-8"))
            assert caught.value.orig.sqlstate == "23505"
            assert await db.scalar(select(func.count()).select_from(LiveSessionParticipant)) == 2
            seats[0].status = "completed"
            await db.commit()
            async with legacy_engine.begin() as conn:
                await conn.exec_driver_sql(MIGRATION.read_text(encoding="utf-8"))
            db.add(LiveSessionParticipant(photographer_id="pro", surfer_id="owner", status="active"))
            with pytest.raises(IntegrityError) as duplicate:
                await db.commit()
            assert duplicate.value.orig.sqlstate == "23505"
            await db.rollback()


async def test_browser_webhook_sweep_converge(legacy_engine, monkeypatch):
    async with legacy_engine.begin() as conn:
        await conn.exec_driver_sql(MIGRATION.read_text(encoding="utf-8"))
    async with seeded_seat_harness(legacy_engine) as harness:
        await check_outcome(harness, monkeypatch, "race")


async def test_readonly_worker_leaves_eligible_checkout_unclaimed(legacy_engine):
    previous = datetime.now(timezone.utc) - timedelta(hours=1)
    async with seeded_seat_harness(legacy_engine) as harness:
        async with harness.maker() as db:
            transaction = PaymentTransaction(
                id="readonly-test", user_id="owner", session_id="readonly-checkout",
                amount=25, transaction_metadata='{"type":"live_session_join"}',
                created_at=previous, updated_at=previous,
            )
            db.add(transaction)
            await db.commit()
        async with legacy_engine.begin() as connection:
            await connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            assert await connection.run_sync(waiting_count) == 1
        async with harness.maker() as db:
            observed = await db.get(PaymentTransaction, "readonly-test")
            assert (observed.updated_at, observed.payment_status, observed.status) == (previous, "Pending", "Pending")
