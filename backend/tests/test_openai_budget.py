"""Offline spending safety; also run against isolated PostgreSQL in dedicated CI."""
import asyncio
from datetime import date
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import sys

import httpx
import pytest
from sqlalchemy import insert, select, text, update
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from services import openai_budget as cap
from routes.ai import ai_vision
from scripts.openai_budget import initialize, prior_microdollars


@pytest.fixture
async def ledger(tmp_path, monkeypatch):
    postgres = os.environ.get("OPENAI_BUDGET_POSTGRES_TEST") == "1"
    url = (URL.create("postgresql+asyncpg", username="postgres", host="127.0.0.1", port=5432,
                      database="budget_test") if postgres else
           URL.create("sqlite+aiosqlite", database=str(tmp_path / "budget.db")))
    options = {} if postgres else {"execution_options": {"schema_translate_map": {"ai_budget_private": None}}}
    engine = create_async_engine(url, **options)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        if postgres:
            await conn.execute(text("CREATE SCHEMA IF NOT EXISTS ai_budget_private"))
        await conn.run_sync(cap.metadata.create_all)
        await conn.execute(insert(cap.budget).values(id=cap.BUDGET_ID, initialized=True, reserved_microdollars=0))
    monkeypatch.setattr(cap, "AsyncSessionLocal", factory)
    monkeypatch.setattr(cap, "utc_today", lambda: date(2026, 10, 15))
    monkeypatch.delenv("OPENAI_TEST_BUDGET_ENABLED", raising=False)
    yield engine, factory
    async with engine.begin() as conn:
        await conn.run_sync(cap.metadata.drop_all)
    await engine.dispose()


async def consumed(factory):
    async with factory() as session:
        return (await session.execute(select(cap.budget.c.reserved_microdollars))).scalar_one()


async def set_ledger(factory, amount, initialized=True):
    async with factory() as session:
        await session.execute(update(cap.budget).values(reserved_microdollars=amount, initialized=initialized))
        await session.commit()


async def test_concurrent_last_reservation_cannot_overshoot(ledger):
    _, factory = ledger
    await set_ledger(factory, 9_650_000)

    async def attempt():
        try:
            await cap.reserve_openai_request("gpt-5.4-mini", 2000)
            return True
        except cap.BudgetUnavailable:
            return False

    assert sum(await asyncio.gather(*(attempt() for _ in range(20)))) == 1
    assert await consumed(factory) == 10_000_000


async def test_different_callers_share_total_and_stop_early(ledger):
    _, factory = ledger
    for index in range(28):
        await cap.reserve_openai_request("gpt-4o" if index % 2 else "gpt-5.4-mini", 100)
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request("gpt-4o", 100)
    assert await consumed(factory) == 9_800_000


async def test_committed_debit_survives_new_connection_pool(ledger):
    engine, factory = ledger
    await cap.reserve_openai_request("gpt-5.4-mini", 2000)
    await engine.dispose()
    assert await consumed(factory) == 350_000


async def test_operator_toggle_preserves_spending_on_reenable(ledger, monkeypatch):
    _, factory = ledger
    await set_ledger(factory, 10_000_000)
    monkeypatch.setenv("OPENAI_TEST_BUDGET_ENABLED", "false")
    await cap.reserve_openai_request("gpt-5.4-mini", 2000)
    assert await consumed(factory) == 10_000_000
    monkeypatch.delenv("OPENAI_TEST_BUDGET_ENABLED")
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request("gpt-5.4-mini", 2000)


@pytest.mark.parametrize("mode", ["0", "off", "yes", ""])
async def test_invalid_mode_never_disables_cap(ledger, monkeypatch, mode):
    monkeypatch.setenv("OPENAI_TEST_BUDGET_ENABLED", mode)
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request("gpt-5.4-mini", 2000)
    assert await consumed(ledger[1]) == 0


@pytest.mark.parametrize("model,tokens", [("unknown", 1), ("gpt-4o", 101), ("gpt-5.4-mini", 2001),
                                         ("gpt-5.4-mini", 0), ("gpt-4o", True)])
async def test_unpriced_or_unbounded_request_is_denied(ledger, model, tokens):
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request(model, tokens)
    assert await consumed(ledger[1]) == 0


async def test_price_expiry_blocks_without_debit(ledger, monkeypatch):
    monkeypatch.setattr(cap, "utc_today", lambda: date(2026, 11, 15))
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request("gpt-4o", 100)
    assert await consumed(ledger[1]) == 0


@pytest.mark.parametrize("state", ["closed", "missing-row", "missing-table", "db-outage"])
async def test_unknown_budget_fails_closed(ledger, monkeypatch, state):
    engine, factory = ledger
    if state == "closed":
        await set_ledger(factory, 10_000_000, initialized=False)
    elif state == "missing-row":
        async with engine.begin() as conn:
            await conn.execute(cap.budget.delete())
    elif state == "missing-table":
        async with engine.begin() as conn:
            await conn.run_sync(cap.metadata.drop_all)
    else:
        monkeypatch.setattr(cap, "AsyncSessionLocal", lambda: (_ for _ in ()).throw(RuntimeError("private database error")))
    with pytest.raises(cap.BudgetUnavailable) as error:
        await cap.reserve_openai_request("gpt-5.4-mini", 2000)
    assert "private database error" not in error.value.detail


async def test_initialize_once_with_prior_debit_and_never_reset(ledger):
    _, factory = ledger
    await set_ledger(factory, 10_000_000, initialized=False)
    await initialize(factory, prior_microdollars("1.2500001"))
    assert await consumed(factory) == 1_250_001
    await cap.reserve_openai_request("gpt-4o", 100)
    with pytest.raises(ValueError, match="refusing to reset"):
        await initialize(factory, 0)
    assert await consumed(factory) == 1_600_001


@pytest.mark.parametrize("amount", ["nan", "Infinity", "-0.01", "10.00001", "bad"])
def test_invalid_opening_spend_is_refused(amount):
    with pytest.raises(ValueError):
        prior_microdollars(amount)


async def test_budget_deny_reaches_vision_before_network(ledger, monkeypatch):
    await set_ledger(ledger[1], 10_000_000)
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    client = AsyncMock()
    monkeypatch.setattr(ai_vision.httpx, "AsyncClient", client)
    with pytest.raises(cap.BudgetUnavailable):
        await ai_vision.analyze_image_with_vision("https://example.com/photo.png")
    client.assert_not_called()
    assert ai_vision._slots._value == 2


@pytest.mark.parametrize("failure", ["timeout", "provider-error", "invalid-output"])
async def test_uncertain_or_invalid_provider_outcome_never_refunds(ledger, monkeypatch, failure):
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    original = httpx.AsyncClient

    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("offline", request=request)
        return httpx.Response(500 if failure == "provider-error" else 200, json={})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(Exception):
        await ai_vision.analyze_image_with_vision("https://example.com/photo.png")
    assert await consumed(ledger[1]) == 350_000


async def test_reservation_is_committed_before_provider_attempt(ledger, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    original = httpx.AsyncClient

    async def handler(request):
        # Independent connection can see the debit while the network call is executing.
        assert await consumed(ledger[1]) == 350_000
        assert json.loads(request.content)["model"] == "gpt-5.4-mini-2026-03-17"
        assert json.loads(request.content)["service_tier"] == "default"
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"refusal": "offline"}}]})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(Exception) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/photo.png")
    assert error.value.status_code == 422


async def test_ambiguous_commit_never_contacts_provider_or_refunds(ledger, monkeypatch):
    factory = ledger[1]
    real = factory()

    class AmbiguousCommit:
        async def __aenter__(self):
            await real.__aenter__()
            return self

        async def __aexit__(self, *args):
            return await real.__aexit__(*args)

        async def execute(self, *args):
            return await real.execute(*args)

        async def commit(self):
            await real.commit()
            raise RuntimeError("lost commit acknowledgement")

    monkeypatch.setattr(cap, "AsyncSessionLocal", AmbiguousCommit)
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    client = AsyncMock()
    monkeypatch.setattr(httpx, "AsyncClient", client)
    with pytest.raises(cap.BudgetUnavailable):
        await ai_vision.analyze_image_with_vision("https://example.com/photo.png")
    client.assert_not_called()
    assert await consumed(factory) == 350_000


async def test_moderation_denied_without_network_or_retry(ledger, monkeypatch):
    from services.ai_moderation import moderate_review_content
    await set_ledger(ledger[1], 10_000_000)
    create = AsyncMock()
    constructor = lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=constructor))
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    result = await moderate_review_content("A real review with enough content")
    assert "budget unavailable" in result["error"]
    create.assert_not_awaited()


async def test_moderation_reserves_once_and_disables_sdk_retries(ledger, monkeypatch):
    from services.ai_moderation import moderate_review_content
    options = {}
    create = AsyncMock(side_effect=RuntimeError("private provider error"))

    def constructor(**kwargs):
        options.update(kwargs)
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=constructor))
    monkeypatch.setenv("OPENAI_API_KEY", "offline-fixture")
    result = await moderate_review_content("A normal review to moderate")
    assert options["max_retries"] == 0 and options["base_url"] == "https://api.openai.com/v1"
    assert create.await_count == 1 and await consumed(ledger[1]) == 350_000
    assert create.call_args.kwargs["model"] == "gpt-4o-2024-08-06"
    assert create.call_args.kwargs["service_tier"] == "default"
    assert "private provider error" not in result["error"]


async def test_postgres_migration_starts_closed_and_private(ledger):
    engine, factory = ledger
    if engine.dialect.name != "postgresql":
        pytest.skip("Dedicated PostgreSQL job verifies migration privileges")
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).parents[1] / "alembic/versions/6b8bb9b66da7_add_private_persistent_openai_testing_.py"
    spec = importlib.util.spec_from_file_location("budget_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    async with engine.begin() as conn:
        await conn.run_sync(cap.metadata.drop_all)
        await conn.execute(text("DROP SCHEMA ai_budget_private"))

        def migrate(sync_conn):
            with Operations.context(MigrationContext.configure(sync_conn)):
                module.upgrade()

        await conn.run_sync(migrate)
        assert (await conn.execute(text("SELECT relrowsecurity FROM pg_class WHERE oid = 'ai_budget_private.openai_budget'::regclass"))).scalar()
        assert not (await conn.execute(text("""SELECT EXISTS(SELECT FROM pg_class c,
            LATERAL aclexplode(c.relacl) a WHERE c.oid='ai_budget_private.openai_budget'::regclass
            AND a.grantee=0)"""))).scalar()
        assert not (await conn.execute(text("""SELECT EXISTS(SELECT FROM pg_namespace n,
            LATERAL aclexplode(n.nspacl) a WHERE n.nspname='ai_budget_private' AND a.grantee=0)"""))).scalar()
        await conn.execute(text("CREATE ROLE budget_test_reader NOLOGIN"))
        await conn.execute(text("GRANT USAGE ON SCHEMA ai_budget_private TO budget_test_reader"))
        await conn.execute(text("GRANT SELECT ON ai_budget_private.openai_budget TO budget_test_reader"))
        await conn.execute(text("SET LOCAL ROLE budget_test_reader"))
        assert (await conn.execute(text("SELECT count(*) FROM ai_budget_private.openai_budget"))).scalar() == 0
        await conn.execute(text("RESET ROLE"))
    assert await consumed(factory) == 10_000_000
    with pytest.raises(cap.BudgetUnavailable):
        await cap.reserve_openai_request("gpt-4o", 100)
