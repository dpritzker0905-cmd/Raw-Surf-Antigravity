"""Plan memoization must not pin a full manifest generation per inactive frame."""
import gc
import math
import threading
import weakref

import pytest

from services.weather_pipeline import bight_hs_consensus as B
from services.weather_pipeline import consensus_serve as S
from tests.test_bight_hs_consensus import FakeStore, SC, _product, _gfs_field, _euro_field


@pytest.fixture(autouse=True)
def equal_weight(monkeypatch):
    monkeypatch.setenv("SURF_BIGHT_HS_EURO_WEIGHT", "0.5")


def served(view, filename, product):
    result = view._bight_frame(B, filename, product, None)
    assert result.grid.diagnostics["bight_hs_consensus"]["cells"]["blended"] > 0
    changed = [(g, v) for g, v in zip(product.grid.vectors, result.grid.vectors) if g.speed != v.speed]
    assert changed, "raw-GFS fallback is not composition parity"
    for g, v in changed:
        expected = (math.hypot(g.u, g.v) + _euro_field(g.lat, g.lng)[0]) / 2
        assert v.speed == pytest.approx(expected, abs=0.0002)
    return result.model_dump_json()


def fixture_store():
    gfs = _product("GFS", SC, 0.5, _gfs_field)
    euro = _product("EURO", SC, 0.5, _euro_field)
    raw = FakeStore([(gfs, 0.5), (euro, 0.5)])
    return raw, S.ServedStore(raw), gfs


def test_inactive_frame_plans_release_historical_manifests():
    raw, view, product = fixture_store()
    refs = []
    outputs = []
    for generation in range(8):
        raw.manifest = raw.manifest.model_copy(deep=True)
        refs.append(weakref.ref(raw.manifest.products[0]))
        outputs.append(served(view, f"frame-{generation}", product))
    gc.collect()
    assert len(set(outputs)) == 1, "cache changes must preserve actual Bight composition"
    assert sum(ref() is not None for ref in refs) == 1, "inactive plans retained obsolete manifest generations"


def test_plan_cache_preserves_identity_and_length_invalidation(monkeypatch):
    raw, view, product = fixture_store()
    builds = []
    original = B.bight_cells
    monkeypatch.setattr(B, "bight_cells", lambda p: builds.append(1) or original(p))
    first = served(view, "same-frame", product)
    assert served(view, "same-frame", product) == first
    assert len(builds) == 1
    raw.manifest.products = list(raw.manifest.products)
    assert served(view, "same-frame", product) == first
    assert len(builds) == 2
    raw.manifest.products.append(raw.manifest.products[0].model_copy(deep=True))
    assert served(view, "same-frame", product) == first
    assert len(builds) == 3
    assert not hasattr(raw, "_bight_plan_source"), "view state must not be forwarded to the raw store"


def test_old_inflight_plan_cannot_repopulate_new_generation(monkeypatch):
    raw, view, product = fixture_store()
    started, release = threading.Event(), threading.Event()
    original = B.bight_cells
    results, errors = [], []

    def blocked_cells(p):
        if threading.current_thread().name == "old-plan":
            started.set()
            assert release.wait(5), "test failed to release old plan"
        return original(p)

    def old_request():
        try:
            results.append(served(view, "old-frame", product))
        except BaseException as exc:
            errors.append(exc)

    monkeypatch.setattr(B, "bight_cells", blocked_cells)
    thread = threading.Thread(target=old_request, name="old-plan")
    thread.start()
    try:
        assert started.wait(5)
        raw.manifest = raw.manifest.model_copy(deep=True)
        current = served(view, "new-frame", product)
    finally:
        release.set()
        thread.join(5)
    assert not thread.is_alive()
    assert not errors
    assert results == [current]
    assert {key[0] for key in view._bight_plans} == {"new-frame"}


def test_same_generation_still_obeys_frame_entry_bound(monkeypatch):
    raw, view, product = fixture_store()
    monkeypatch.setattr(S, "MERGED_CACHE_MAX", 2)
    for i in range(7):
        served(view, f"frame-{i}", product)
    assert len(view._bight_plans) == 4
