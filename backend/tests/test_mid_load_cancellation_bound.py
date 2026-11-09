"""Offline regression: canceling a waiter must not release a running loader's slot."""
import asyncio
import threading
from types import SimpleNamespace

import pytest

from services.weather_pipeline import mid_res_tier as tier
from services.weather_pipeline.schemas import CoverageBounds


@pytest.mark.parametrize("stop", ["cancel", "timeout"])
def test_load_slot_is_owned_until_thread_finishes(monkeypatch, stop):
    async def scenario():
        started = threading.Event()
        release = threading.Event()
        second_started = threading.Event()
        calls = []

        class Store:
            def load_product(self, filename):
                calls.append(filename)
                if filename == "first.json":
                    started.set()
                    assert release.wait(5), "test worker was not released"
                else:
                    second_started.set()
                return None

        monkeypatch.setattr(tier, "_CLIP_CACHE", {}, raising=False)
        sem = asyncio.Semaphore(1)
        monkeypatch.setattr(tier, "_LOAD_SEM", sem, raising=False)
        monkeypatch.setenv("MARINE_MID_RES_TIER", "1")
        monkeypatch.setenv("MARINE_MID_RES_MAX_SPAN", "400")
        monkeypatch.setenv("MARINE_MID_RES_MIN_SPAN", "0")
        async def request(name):
            item = SimpleNamespace(filename=name, coverage=CoverageBounds(west=-180,south=-80,east=180,north=85))
            return await tier.try_serve_mid_res_tier(
                Store(), model="GFS", domain="marine", layer="waves", bbox="-86,25,-74,32",
                req_w=-86, req_s=25, req_e=-74, req_n=32,
                mid_auth=[(item, 0)], mid_est=[], current_product=None)

        first = asyncio.create_task(request("first.json"))
        second = None
        try:
            for _ in range(200):
                if started.is_set(): break
                await asyncio.sleep(.005)
            assert started.is_set()
            if stop == "cancel":
                first.cancel()
                with pytest.raises(asyncio.CancelledError): await first
            else:
                with pytest.raises(asyncio.TimeoutError): await asyncio.wait_for(first, .01)
            second = asyncio.create_task(request("second.json"))
            await asyncio.sleep(.08)
            assert not second_started.is_set(), "a canceled waiter released the slot while its loader was still running"
            assert calls == ["first.json"]
        finally:
            release.set()
            await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
            for _ in range(200):
                if not sem.locked(): break
                await asyncio.sleep(.005)
        assert calls == ["first.json", "second.json"]
        assert sem._value == 1
    asyncio.run(scenario())


def test_queued_cancellation_starts_no_worker():
    async def scenario():
        sem = asyncio.Semaphore(0)
        store = SimpleNamespace(load_product=lambda *a, **k: pytest.fail("queued worker started"))
        task = asyncio.create_task(tier._load_mid_candidate(store, "x", 1, None, False, sem))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert sem._value == 0
        assert not tier._MID_LOAD_TASKS
    asyncio.run(scenario())


@pytest.mark.parametrize("abandon", [False, True])
def test_loader_failure_releases_slot_and_is_retrieved(abandon):
    async def scenario():
        started, release = threading.Event(), threading.Event()
        sem = asyncio.Semaphore(1)
        errors = []
        asyncio.get_running_loop().set_exception_handler(lambda loop, context: errors.append(context))
        def load(*a, **k):
            started.set()
            assert release.wait(5)
            raise ValueError("expected loader failure")
        task = asyncio.create_task(tier._load_mid_candidate(SimpleNamespace(load_product=load), "x", 1, None, False, sem))
        try:
            for _ in range(200):
                if started.is_set(): break
                await asyncio.sleep(.005)
            assert started.is_set()
            if abandon:
                task.cancel()
                with pytest.raises(asyncio.CancelledError): await task
            release.set()
            if not abandon:
                with pytest.raises(ValueError, match="expected loader failure"): await task
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            for _ in range(200):
                if not tier._MID_LOAD_TASKS: break
                await asyncio.sleep(.005)
        assert sem._value == 1
        assert not tier._MID_LOAD_TASKS
        assert not errors
    asyncio.run(scenario())


def test_strided_fallback_retains_slot_after_cancellation(monkeypatch):
    async def scenario():
        started, release = threading.Event(), threading.Event()
        sem = asyncio.Semaphore(1)
        calls = []
        strided = SimpleNamespace(grid=SimpleNamespace(diagnostics={"load_stride":2}))
        def load(name, **kw):
            calls.append((name, kw))
            if kw: return strided
            started.set()
            assert release.wait(5)
            return None
        monkeypatch.setattr(tier, "_identity_clip_bounds", lambda *a: None)
        task = asyncio.create_task(tier._load_mid_candidate(SimpleNamespace(load_product=load), "x", 2, "box", True, sem))
        try:
            for _ in range(200):
                if started.is_set(): break
                await asyncio.sleep(.005)
            assert started.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            assert sem.locked()
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)
            for _ in range(200):
                if not tier._MID_LOAD_TASKS: break
                await asyncio.sleep(.005)
        assert calls == [("x", {"stride":2}), ("x", {})]
        assert sem._value == 1
        assert not tier._MID_LOAD_TASKS
    asyncio.run(scenario())
