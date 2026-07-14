"""
Cold-start hardening (2026-07-06, chip task_e618f9ff).

Every deploy restarts the serve box; requests race the L2 restore. The first mid-tier
grid_series used to burn its 10s per-hour cap on restore-blocked product loads and return
frame_count:0 — which the client treated as "no coverage" until the next gesture. Now:
the restore exposes an in-progress flag; grid_series extends its per-hour budget while it's
set and marks EMPTY responses `warming: true` so the client retries with backoff.
"""
import asyncio

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.store_helpers import restore_from_supabase_helper


@pytest.fixture(autouse=True)
def _clear_flag():
    ProductStore._restore_in_progress = False
    yield
    ProductStore._restore_in_progress = False


# ── per-hour budget ──────────────────────────────────────────────────────────────────────────
def test_per_hour_timeout_extends_during_restore():
    assert gsh._per_hour_timeout() == gsh.PER_HOUR_TIMEOUT
    ProductStore._restore_in_progress = True
    assert gsh._per_hour_timeout() == gsh.PER_HOUR_TIMEOUT_COLD
    assert gsh.PER_HOUR_TIMEOUT_COLD > gsh.PER_HOUR_TIMEOUT
    # The cold budget must stay inside the series deadline (client fetch timeout is 45s).
    assert gsh.PER_HOUR_TIMEOUT_COLD < gsh.OVERALL_DEADLINE


# ── proxy-window alignment (§0f(3), 2026-07-14) ─────────────────────────────────────────────
def test_series_deadline_sits_under_the_netlify_proxy_window():
    """Production serves /api/* through Netlify's CDN proxy (~26s cut). A deadline beyond it
    guarantees a TOTAL loss on slow pages — the proxy kills the response and the client caches
    zero frames — where a deadline under it degrades to a PARTIAL page (measured root of the
    EURO far-tail 'Fetch failed' class). Headroom covers in-flight per-hour builds + transfer."""
    assert gsh.OVERALL_DEADLINE < gsh.NETLIFY_PROXY_WINDOW_S - 4.0
    # And the cold first-hour build (serial, gets its budget in full) must also fit under it.
    assert gsh.PER_HOUR_TIMEOUT_COLD < gsh.OVERALL_DEADLINE


# ── restore flag lifecycle ───────────────────────────────────────────────────────────────────
def test_restore_helper_sets_and_always_clears_the_flag(monkeypatch):
    observed = {}

    def fake_get_storage():
        observed["during"] = getattr(ProductStore, "_restore_in_progress", None)
        return None  # early-return path: "Supabase Storage unavailable"

    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "_get_supabase_storage", fake_get_storage)
    store = object.__new__(ProductStore)  # no __init__ side effects needed for this path
    restored, errors = restore_from_supabase_helper(store)
    assert restored == 0 and errors
    assert observed["during"] is True          # flag visible to racing requests mid-restore
    assert ProductStore._restore_in_progress is False  # ALWAYS cleared (finally)


# ── warming marker ───────────────────────────────────────────────────────────────────────────
def _empty_resolver():
    async def resolve_grid(**kwargs):
        return None  # every hour resolves to nothing (the cold-restore symptom)
    return resolve_grid


def test_empty_series_is_marked_warming_during_restore():
    ProductStore._restore_in_progress = True
    resp = asyncio.run(gsh.build_grid_series(
        _empty_resolver(), None, "GFS", "marine", "waves", "-82,27,-79,29", "0,3"))
    assert resp["frame_count"] == 0
    assert resp.get("warming") is True


def test_empty_series_is_not_marked_warming_when_warm():
    resp = asyncio.run(gsh.build_grid_series(
        _empty_resolver(), None, "GFS", "marine", "waves", "-82,27,-79,29", "0,3"))
    assert resp["frame_count"] == 0
    assert "warming" not in resp
