"""
FAR-EDGE HOLD (S4, 2026-07-11): the scrubber offers now+336h but stored/estimated coverage ends at
newest-run+~336h ≈ now+330h — the last slider hours 404'd (`no_copernicus_coverage`) and the
client's safe-zero blanked the map (live-caught EURO marine h336). The hold serves the lane's LAST
covered global frame relabeled as an estimate, ONLY past the tail (mid-range holes must still fall
through so real ingest failures are never masked), within a bounded overshoot window.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline.far_edge_hold import try_far_edge_hold

NOW = datetime(2026, 7, 11, 14, 0, 0, tzinfo=timezone.utc)
TAIL = NOW - timedelta(hours=6)  # lane tail 6h short of the target — the observed gap shape


def _mp(vt, layer="waves", coverage_mode="global_tile", is_estimated=True, model="EURO"):
    return SimpleNamespace(
        model=model, domain="marine", layer=layer, coverage_mode=coverage_mode,
        valid_time_start=vt, is_estimated=is_estimated,
        filename=f"euro_marine_{layer}_{vt.strftime('%Y%m%dT%H%M%SZ')}_estimated.json",
    )


class _Store:
    def __init__(self, products, loaded="default"):
        self._products = products
        self._loaded = loaded
        self.loaded_filenames = []

    def get_manifest(self):
        return SimpleNamespace(products=self._products)

    def load_product(self, filename):
        self.loaded_filenames.append(filename)
        if self._loaded == "default":
            return SimpleNamespace(
                grid=SimpleNamespace(vectors=[SimpleNamespace(speed=1.0)]),
                is_estimated=False, is_forecast_authoritative=True,
                estimate_basis=None, warnings=[], coverage_scope=None, product_id=None,
            )
        return self._loaded


def _run(store, model="EURO", domain="marine", layer="waves", target=NOW):
    return asyncio.run(try_far_edge_hold(store, model, domain, layer, target))


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("FAR_EDGE_HOLD", raising=False)
    monkeypatch.delenv("FAR_EDGE_HOLD_MAX_H", raising=False)


def test_holds_last_covered_frame_past_the_tail():
    store = _Store([_mp(TAIL - timedelta(hours=3)), _mp(TAIL)])
    prod = _run(store)
    assert prod is not None
    assert store.loaded_filenames == [_mp(TAIL).filename]  # the LATEST covered frame, not an older one
    assert prod.is_estimated is True and prod.is_forecast_authoritative is False
    assert prod.estimate_basis["type"] == "far_edge_hold"
    assert prod.estimate_basis["gap_hours"] == 6.0
    assert any(w.startswith("far_edge_hold:") for w in prod.warnings)


def test_never_masks_a_mid_range_hole():
    # Coverage EXISTS beyond the target → the miss is a hole the pipeline must heal, not the far edge.
    store = _Store([_mp(TAIL), _mp(NOW + timedelta(hours=6))])
    assert _run(store) is None
    assert store.loaded_filenames == []


def test_bounded_overshoot_window(monkeypatch):
    store = _Store([_mp(NOW - timedelta(hours=30))])
    assert _run(store) is None  # 30h past the tail > default 24h → honest 404
    monkeypatch.setenv("FAR_EDGE_HOLD_MAX_H", "48")
    assert _run(_Store([_mp(NOW - timedelta(hours=30))])) is not None


def test_kill_switch(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD", "0")
    assert _run(_Store([_mp(TAIL)])) is None


def test_marine_only_and_global_tile_only():
    assert _run(_Store([_mp(TAIL)]), domain="wind") is None
    assert _run(_Store([_mp(TAIL, coverage_mode="regional_tile")])) is None


def test_layer_and_model_scoping():
    # A waves tail must not serve a swell_1 request; EURO tail must not serve ICON.
    assert _run(_Store([_mp(TAIL, layer="waves")]), layer="swell_1") is None
    assert _run(_Store([_mp(TAIL, model="EURO")]), model="ICON") is None


def test_unloadable_or_empty_product_falls_through():
    store = _Store([_mp(TAIL)], loaded=None)
    assert _run(store) is None
