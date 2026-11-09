"""The serving view must not retain full grids beyond the raw store's vector budget."""
from datetime import timedelta

import pytest

from services.weather_pipeline import consensus_serve as S
from tests.test_bight_hs_consensus import FakeStore, _product, _gfs_field, _euro_field, SC, T0, _dump


@pytest.fixture
def scene(monkeypatch):
    monkeypatch.setenv("SURF_BIGHT_HS_CONSENSUS", "1")
    monkeypatch.setenv("CONSENSUS_SERVE", "0")
    products = []
    for i in range(4):
        when = T0 + timedelta(hours=6*i)
        products += [(_product("GFS", SC, .25, _gfs_field, valid_time=when), .25),
                     (_product("EURO", SC, .25, _euro_field, valid_time=when), .25)]
    raw = FakeStore(products)
    names = [n for n,p in raw.files.items() if p.model == "GFS"]
    count = len(raw.files[names[0]].grid.vectors)
    monkeypatch.setattr(S, "MERGED_CACHE_VECTOR_BUDGET", count * 2, raising=False)
    return raw, names, count


def retained_vectors(view):
    return sum(len(p.grid.vectors) for p in view._merged.values() if p is not S._NO_BLEND)


def test_served_cache_obeys_vector_budget(scene):
    raw, names, count = scene
    view = S.served_store(raw)
    for name in names:
        out = view.load_product(name)
        assert out.grid.diagnostics.get("bight_hs_consensus"), "composition not exercised"
    assert retained_vectors(view) <= 2*count, "serving cache pins raw vectors after raw-store eviction"


def test_single_oversized_frame_is_served_but_not_cached(scene, monkeypatch):
    raw, names, count = scene
    monkeypatch.setattr(S, "MERGED_CACHE_VECTOR_BUDGET", count-1, raising=False)
    view = S.served_store(raw)
    expected = _dump(view.load_product(names[0]))
    assert _dump(view.load_product(names[0])) == expected
    assert retained_vectors(view) == 0


def test_eviction_and_cache_hit_leave_served_bytes_unchanged(scene):
    raw, names, count = scene
    view = S.served_store(raw)
    original = _dump(view.load_product(names[0]))
    assert _dump(view.load_product(names[0])) == original
    for name in names[1:]: view.load_product(name)
    assert _dump(view.load_product(names[0])) == original
    assert retained_vectors(view) <= 2*count


def test_default_matches_product_store_vector_budget():
    assert S.MERGED_CACHE_VECTOR_BUDGET == 120000


def test_mixed_entries_count_vectors_and_keep_exact_boundary(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(S, "MERGED_CACHE_VECTOR_BUDGET", 4)
    monkeypatch.setattr(S, "MERGED_CACHE_MAX", 3)
    view = S.served_store(SimpleNamespace())
    frame = lambda n: SimpleNamespace(grid=SimpleNamespace(vectors=[None]*n))
    with view._lock:
        view._remember_merged(("consensus",), frame(2))
        view._remember_merged(("bight",), frame(2))
        view._remember_merged(("empty",), S._NO_BLEND)
        assert retained_vectors(view) == 4
        assert len(view._merged) == 3
        view._remember_merged(("empty2",), S._NO_BLEND)
        assert list(view._merged) == [("bight",), ("empty",), ("empty2",)]
        view._remember_merged(("bight",), frame(4))
        assert retained_vectors(view) == 4
        assert len(view._merged) == 3
        view._remember_merged(("large",), frame(5))
        assert ("large",) not in view._merged
        assert retained_vectors(view) == 4
