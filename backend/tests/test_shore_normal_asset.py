"""
test_shore_normal_asset.py — pin the runtime lookup for the ETOPO shore-normal asset.

The asset can only ever IMPROVE a rating, never break one, so most of these tests are about the
failure paths: a missing file, a corrupt file, a point with nothing nearby, and the kill switch all
have to degrade to (None, None) so the caller keeps the coarse bathymetry value.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import shore_normal_asset as sna  # noqa: E402
from services.weather_pipeline.shore_normal_fit import MAX_SPREAD_DEG  # noqa: E402


@pytest.fixture
def asset(tmp_path, monkeypatch):
    """Point the module at a throwaway asset and reset its latched state around each test."""
    def _write(entries, **extra):
        path = tmp_path / "shore_normals.json"
        path.write_text(json.dumps({"source": "test", "max_spread_deg": MAX_SPREAD_DEG,
                                    "count": len(entries), "entries": entries, **extra}))
        monkeypatch.setattr(sna, "_ASSET", str(path))
        sna._reset_for_tests()
        return path
    yield _write
    sna._reset_for_tests()


def test_exact_hit_returns_bearing_and_spread(asset):
    asset([[21.6654, -158.0521, 309.6, 5.2]])
    normal, spread = sna.shore_normal_at(21.6654, -158.0521)
    assert normal == pytest.approx(309.6)
    assert spread == pytest.approx(5.2)


def test_nearby_point_hits_but_a_distant_one_does_not(asset):
    """~300 m away is the same break; ~5 km away is somebody else's coast."""
    asset([[21.6654, -158.0521, 309.6, 5.2]])
    assert sna.shore_normal_at(21.6680, -158.0521)[0] == pytest.approx(309.6)
    assert sna.shore_normal_at(21.7200, -158.0521) == (None, None)


def test_nearest_entry_wins_not_first_match(asset):
    """Four pairs in the catalog sit under 50 m apart and Rincon has five breaks inside 3 km —
    scanning order must not decide which geometry a point gets."""
    asset([[10.0000, 20.0000, 100.0, 3.0],
           [10.0030, 20.0000, 200.0, 3.0]])       # ~330 m north
    assert sna.shore_normal_at(10.0028, 20.0000)[0] == pytest.approx(200.0)
    assert sna.shore_normal_at(10.0002, 20.0000)[0] == pytest.approx(100.0)


def test_lookup_crosses_spatial_hash_bucket_edges(asset):
    """The index buckets at 0.1 deg; an entry just over a boundary must still be found."""
    asset([[10.0999, 20.0999, 123.4, 2.0]])
    assert sna.shore_normal_at(10.1001, 20.1001)[0] == pytest.approx(123.4)


def test_missing_asset_is_silent(monkeypatch, tmp_path):
    monkeypatch.setattr(sna, "_ASSET", str(tmp_path / "does_not_exist.json"))
    sna._reset_for_tests()
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)
    assert sna.is_available() is False
    sna._reset_for_tests()


def test_corrupt_asset_is_silent(tmp_path, monkeypatch):
    path = tmp_path / "shore_normals.json"
    path.write_text("{not json at all")
    monkeypatch.setattr(sna, "_ASSET", str(path))
    sna._reset_for_tests()
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)
    assert sna.is_available() is False
    sna._reset_for_tests()


def test_kill_switch_disables_lookup(asset, monkeypatch):
    asset([[21.6654, -158.0521, 309.6, 5.2]])
    monkeypatch.setenv("SHORE_NORMAL_ASSET", "0")
    # ⚠️ `_reset_for_tests`, not `shore_normal_at.cache_clear()`. The memo moved down to the single
    # `_nearest` lookup both accessors now share (so a new geometry source cannot reach the bearing
    # and miss the break depth), and reaching for the cache on a specific accessor breaks whenever
    # that changes. The module's own reset is the stable way to say "forget everything".
    sna._reset_for_tests()
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)
    monkeypatch.setenv("SHORE_NORMAL_ASSET", "1")
    sna._reset_for_tests()
    assert sna.shore_normal_at(21.6654, -158.0521)[0] == pytest.approx(309.6)


def test_none_coordinates_do_not_raise(asset):
    asset([[21.6654, -158.0521, 309.6, 5.2]])
    assert sna.shore_normal_at(None, None) == (None, None)


def test_empty_asset_is_unavailable(asset):
    asset([])
    assert sna.is_available() is False
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)


def test_meta_is_exposed_without_entries(asset):
    asset([[1.0, 2.0, 10.0, 1.0]])
    meta = sna.asset_meta()
    assert meta is not None and "entries" not in meta
    assert meta["max_spread_deg"] == MAX_SPREAD_DEG


# ── the shipped asset itself ────────────────────────────────────────────────────────────────────
SHIPPED = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "services", "weather_pipeline", "data", "shore_normals.json")


@pytest.mark.skipif(not os.path.exists(SHIPPED), reason="asset not built yet")
def test_shipped_asset_respects_its_own_gate():
    """Every shipped entry must be a legal bearing that passed the confidence gate. This is what
    stops a future rebuild from quietly widening the gate and shipping ambiguous coastlines."""
    with open(SHIPPED) as fh:
        doc = json.load(fh)
    assert doc["count"] == len(doc["entries"])
    gate = doc["max_spread_deg"]
    assert gate <= MAX_SPREAD_DEG, "the shipped asset was built with a looser gate than the code"
    for row in doc["entries"]:
        # 4 elements = pre-2026-07-27 asset; 5 adds the nearshore break depth. Both must load.
        assert len(row) in (4, 5), f"unexpected entry arity {len(row)}"
        lat, lng, normal, spread = row[0], row[1], row[2], row[3]
        assert -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0
        assert 0.0 <= normal < 360.0
        assert 0.0 <= spread <= gate
        if len(row) == 5 and row[4] is not None:
            # Loose per-entry sanity only. A steep volcanic coast really can median 234 m of water
            # inside 1 km, so an individual deep value is legitimate (the cap simply will not bind
            # there, exactly as today). The meaningful check is the AGGREGATE one below — a
            # systemic regression to shelf-scale depths is what would silently kill the cap again.
            assert 0.0 < row[4] < 3000.0, f"implausible break depth {row[4]} m"


@pytest.mark.skipif(not os.path.exists(SHIPPED), reason="asset not built yet")
def test_shipped_break_depths_are_surf_zone_scale():
    """Guards the reason the field exists: if a rebuild ever started emitting shelf-scale depths
    the breaking cap would go dead again silently."""
    with open(SHIPPED) as fh:
        doc = json.load(fh)
    depths = [r[4] for r in doc["entries"] if len(r) > 4 and r[4] is not None]
    if not depths:
        pytest.skip("asset predates the break-depth field")
    depths.sort()
    median = depths[len(depths) // 2]
    assert median < 100.0, (
        f"median break depth {median} m is shelf-scale — the cap would never bind")
