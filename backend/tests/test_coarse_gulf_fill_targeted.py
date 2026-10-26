"""MARINE_GULF_FILL_MID_TARGETED: on the 2-deg world grid, fill a masked EURO/ICON cell only from the same-layer GFS 2-deg value at
the SAME node, and only where that node is sea.

WHY THIS EXISTS (2026-10-23, the owner's decision 09:56 EDT)
------------------------------------------------------------
The fill was built for the 10-deg tier (coarse_gulf_fill docstring). On the 2-deg global_mid its 8-deg reach from GFS 10-deg cells
painted coast, land and ice (live 2026-10-22: EURO 2,465 of 4,689 masked cells, ICON 1,708 of 3,788). Switching it off would
blank real sea: EURO's own 2-deg grid masks 870 GFS-sea nodes (Gulf of Mexico 15/59, Mediterranean 44/113, Baltic 26/45, ...).
The owner: "build the targeted fill dark (only fill EURO/ICON 2-deg cells where GFS 2-deg is sea, stop painting land/ice), then
show me the before/after before switching it on". These tests pin the rule, its donor, its provenance, that the 10-deg tier is
untouched, the flag order, and the /capabilities report.
"""
import asyncio
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import coarse_gulf_fill as gf
from services.weather_pipeline.capabilities import get_weather_capabilities
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

_VT = "2026-10-23T00:00:00Z"
_VT_DT = datetime(2026, 10, 23, tzinfo=timezone.utc)
_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=84.0)
SEA_GULF = (26.0, -90.0)        # masked by EURO, sea in GFS 2-deg: must be filled from GFS 2-deg
INLAND_TX = (32.0, -98.0)       # masked by EURO and by GFS 2-deg (land): must stay masked
COAST_NEAR = (30.0, -84.0)      # masked by EURO; GFS 2-deg is sea only one node away (28, -84): no reach, stays masked
OPEN_SEA = (0.0, 0.0)           # valid in EURO: untouched


def _vec(latlng, speed, valid=True, direction=200.0, period=9.0):
    la, lo = latlng
    if not valid:
        return GridVector(lat=la, lng=lo, speed=0.0, is_valid=False)
    return GridVector(lat=la, lng=lo, speed=speed, direction=direction, u=-0.5, v=0.7, period=period, is_valid=True)


def _product(model, region, layer, vectors, cols, filename):
    grid = NormalizedGrid(bounds=_WORLD, cols=cols, rows=83, vectors=vectors)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer, run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=_WORLD, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=2.0 if region == "global_mid" else 10.0, region_id=region, product_id=filename)


def _recipient(model="EURO", layer="waves", region="global_mid"):
    vecs = [_vec(SEA_GULF, 0, False), _vec(INLAND_TX, 0, False), _vec(COAST_NEAR, 0, False), _vec(OPEN_SEA, 1.5)]
    return _product(model, region, layer, vecs, 181 if region == "global_mid" else 37, f"{model.lower()}_{layer}_{region}.json")


class _Store:
    """The donors the fill can reach: GFS global_mid (2-deg) and global_coarse (10-deg), for waves and swell_1."""

    def __init__(self, mid_vt=_VT):
        self.products, self.items = {}, []
        for layer, mid_speed, coarse_speed in (("waves", 1.25, 3.0), ("swell_1", 0.75, 2.0)):
            mid = [_vec(SEA_GULF, mid_speed, direction=111.0, period=7.5), _vec(INLAND_TX, 0, False),
                   _vec((28.0, -84.0), 0.9), _vec(COAST_NEAR, 0, False)]
            coarse = [_vec((25.0, -90.0), coarse_speed), _vec((30.0, -95.0), coarse_speed), _vec((30.0, -85.0), coarse_speed)]
            for region, vecs, vt in (("global_mid", mid, mid_vt), ("global_coarse", coarse, _VT)):
                name = f"gfs_marine_{layer}_{region}.json"
                self.products[name] = _product("GFS", region, layer, vecs, 181 if region == "global_mid" else 37, name)
                self.items.append(types.SimpleNamespace(model="GFS", domain="marine", layer=layer, region_id=region,
                                                        valid_time_start=vt, filename=name))

    def get_manifest(self):
        return types.SimpleNamespace(products=self.items)

    def load_product(self, filename):
        return self.products.get(filename)


def _fill(product, store=None):
    return asyncio.run(gf.fill_coarse_enclosed_sea_from_gfs_served(product, store or _Store(), product.model, "marine",
                                                                    product.layer))


def _by_node(product):
    return {(v.lat, v.lng): v for v in product.grid.vectors}


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    for k in ("MARINE_GULF_FILL_MID", "MARINE_GULF_FILL_MID_TARGETED", "MARINE_COARSE_GULF_FILL", "MARINE_TARGETED_DONOR_CACHE",
              "MARINE_GULF_FILL_DONOR_SERVED_TIME"):
        monkeypatch.delenv(k, raising=False)
    gf._DONOR_LRU.clear()
    gf.TARGETED_NO_FILL.clear()
    gf._LAST_NO_FILL.clear()
    gf.DONOR_STATS.clear()


@pytest.mark.parametrize("model", ["EURO", "ICON"])
def test_targeted_fills_only_where_the_gfs_2deg_node_is_sea_with_its_own_values(monkeypatch, model):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    src = _recipient(model)
    out = _fill(src)
    cells = _by_node(out)
    gulf = cells[SEA_GULF]
    assert gulf.is_valid and (gulf.speed, gulf.direction, gulf.period) == (1.25, 111.0, 7.5)   # the GFS 2-deg value, not 10-deg
    assert not cells[INLAND_TX].is_valid                       # land in GFS too: no paint
    assert not cells[COAST_NEAR].is_valid                      # no reach: a sea node next door does not fill it
    assert cells[OPEN_SEA].speed == 1.5
    assert out.coarse_fill == {"donor_model": "GFS", "layer": "waves", "mode": "targeted", "donor_region": "global_mid",
                               "donor_product": "gfs_marine_waves_global_mid.json", "filled_period": "GFS peak (PERPW), the donor's",
                               "cells_filled": 1, "cells_masked": 3, "cells_total": 4}
    assert all(not v.is_valid for v in src.grid.vectors[:3])   # the input (possibly the cache's) is never written to


def test_today_s_fill_paints_land_the_targeted_one_does_not(monkeypatch):
    legacy = _by_node(_fill(_recipient()))
    assert legacy[INLAND_TX].is_valid and legacy[INLAND_TX].speed == 3.0     # the 8-deg reach from a 10-deg cell
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    assert not _by_node(_fill(_recipient()))[INLAND_TX].is_valid


def test_the_donor_is_the_same_layer(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_recipient(layer="swell_1"))
    assert _by_node(out)[SEA_GULF].speed == 0.75 and out.coarse_fill["donor_product"] == "gfs_marine_swell_1_global_mid.json"


def test_the_10deg_tier_keeps_today_s_fill_under_the_targeted_flag(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_recipient(region="global_coarse"))
    assert out.coarse_fill["cells_filled"] == 3 and "mode" not in out.coarse_fill   # every masked cell, from the 10-deg donor


def test_fill_off_wins_over_targeted_and_a_missing_donor_is_stamped_logged_and_counted(monkeypatch, caplog):
    """The 2026-10-23 review: a silent missing donor blanks real sea for that frame. Now it is served as stored WITH a stamp,
    a WARNING once per change, and a count."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    stale = _Store(mid_vt="2026-10-23T09:00:00Z")              # GFS 2-deg 9 h away: no honest donor
    src = _recipient()
    with caplog.at_level("WARNING"):
        a, b = _fill(src, stale), _fill(src, stale)
    for out in (a, b):
        assert out is not src and out.grid is src.grid      # stamped on a copy; the grid (maybe the cache's) is untouched
        assert (out.coarse_fill["mode"], out.coarse_fill["donor"], out.coarse_fill["cells_filled"]) == ("targeted", "missing", 0)
        assert sum(1 for v in out.grid.vectors if not v.is_valid) == 3
    assert src.coarse_fill is None
    assert sum("targeted fill skipped (missing" in r.message for r in caplog.records) == 1     # logged once per change
    assert gf.TARGETED_NO_FILL[("EURO", "waves", "missing")] == 2
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    assert _fill(src) is src and gf.gulf_fill_mid_mode() == "off"


def test_capabilities_report_the_mode(monkeypatch):
    def rows():
        return [r for r in get_weather_capabilities() if r.get("domain") == "marine" and r.get("model") in ("EURO", "ICON")]
    assert rows() and all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (True, "legacy") for r in rows())
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    assert all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (True, "targeted") for r in rows())   # the client guard stays
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "0")
    assert all((r["gulf_fill_mid"], r["gulf_fill_mid_mode"]) == (False, "off") for r in rows())
    assert all("gulf_fill_mid_mode" not in r for r in get_weather_capabilities() if r.get("model") == "GFS")


def test_a_recipient_off_the_gfs_lattice_is_never_misaligned(monkeypatch):
    """Exact-node matching assumes EURO_MID_RES == ICON_MID_RES == GFS_MID_RES and one origin. A recipient on another lattice is
    served as stored with a lattice_mismatch stamp, never filled from the nearest GFS node."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    vecs = [_vec((25.0, -89.0), 0, False), _vec((0.0, 1.0), 1.5)]          # odd nodes: a 1-deg or shifted lattice
    src = _product("EURO", "global_mid", "waves", vecs, 181, "euro_waves_shifted.json")
    out = _fill(src)
    assert out.coarse_fill["donor"] == "lattice_mismatch" and out.coarse_fill["cells_filled"] == 0
    assert not out.grid.vectors[0].is_valid


class _CountingStore(_Store):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.loads = []

    def load_product(self, filename):
        self.loads.append(filename)
        return super().load_product(filename)


def test_one_compact_donor_per_gfs_file_is_shared_by_euro_and_icon_and_the_lru_is_bounded(monkeypatch):
    """The review's blocker: the first cut loaded the full GFS 2-deg product for EVERY frame. Now one compact donor per GFS file,
    shared across models and frames, in a bounded LRU."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _CountingStore()
    for model in ("EURO", "ICON", "EURO", "ICON"):
        out = _fill(_recipient(model), store)
        assert out.coarse_fill["cells_filled"] == 1
    assert store.loads == ["gfs_marine_waves_global_mid.json"]             # built once, then served from the LRU
    monkeypatch.setenv("MARINE_TARGETED_DONOR_CACHE", "1")
    _fill(_recipient(layer="swell_1"), store)                                # a second GFS file evicts the first (size 1)
    assert len(gf._DONOR_LRU) == 1 and next(iter(gf._DONOR_LRU))[0] == "gfs_marine_swell_1_global_mid.json"


def test_a_newer_gfs_run_under_the_same_filename_is_a_new_donor(monkeypatch):
    """GFS filenames are keyed by valid time: a newer run rewrites the same name. The LRU keys by the manifest's run too."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _CountingStore()
    assert _by_node(_fill(_recipient(), store))[SEA_GULF].speed == 1.25
    item = next(i for i in store.items if i.filename == "gfs_marine_waves_global_mid.json")
    item.run_time = "2026-10-23T06:00:00Z"
    newer = store.products["gfs_marine_waves_global_mid.json"]
    newer.grid.vectors[0] = _vec(SEA_GULF, 2.5, direction=111.0, period=7.5)
    assert _by_node(_fill(_recipient(), store))[SEA_GULF].speed == 2.5 and len(store.loads) == 2


# -- The donor's read path (the second review, 2026-10-23): disk, cold L2, refusals, staleness, the production lattice ----------

import json as _json  # noqa: E402


def _lattice_vectors(sea_speed, land=(), extra=None, all_masked=False):
    """A full global_mid lattice (181 x 83: lat -80..84, lng -180..180 every 2 deg, both -180 and 180), sea except `land`."""
    out = []
    for r in range(83):
        for c in range(181):
            la, lo = -80.0 + 2 * r, -180.0 + 2 * c
            if all_masked or (la, lo) in land:
                out.append({"lat": la, "lng": lo, "speed": 0.0, "is_valid": False})
            else:
                s = (extra or {}).get((la, lo), sea_speed)
                out.append({"lat": la, "lng": lo, "speed": s, "direction": 90.0, "u": -s, "v": 0.0, "period": 9.0, "is_valid": True})
    return out


class _DiskStore:
    """A ProductStore-shaped store (cache_dir + manifest) whose load_product must never be needed for a donor."""

    def __init__(self, tmp_path, run="2026-10-23T00:00:00Z", resolution=None, file_run=None, raw=None, vectors=None, write=True):
        self.cache_dir, self.loads = tmp_path, []
        self.name = "gfs_marine_waves_global_mid_disk.json"
        self.item = types.SimpleNamespace(model="GFS", domain="marine", layer="waves", region_id="global_mid", valid_time_start=_VT,
                                          filename=self.name, run_time=run, model_run_time=run, resolution=resolution)
        if write:
            body = raw if raw is not None else _json.dumps({"model": "GFS", "run_time": file_run or run, "model_run_time": file_run or run,
                                                             "grid": {"cols": 181, "rows": 83, "vectors": vectors or _lattice_vectors(1.0)}})
            (tmp_path / self.name).write_text(body)

    def get_manifest(self):
        return types.SimpleNamespace(products=[self.item])

    def load_product(self, filename):
        self.loads.append(filename)
        return None


def _full_recipient(masked_nodes, model="EURO", resolution=2.0):
    vecs = [GridVector(lat=v["lat"], lng=v["lng"], speed=0.0, is_valid=False) if (v["lat"], v["lng"]) in masked_nodes
            else GridVector(lat=v["lat"], lng=v["lng"], speed=1.5, direction=90.0, u=-1.5, v=0.0, period=9.0, is_valid=True)
            for v in _lattice_vectors(1.0)]
    p = _product(model, "global_mid", "waves", vecs, 181, f"{model.lower()}_waves_full.json")
    p.resolution = resolution
    return p


def test_the_disk_path_reads_the_file_and_never_loads_the_product_into_l1(monkeypatch, tmp_path):
    from services.weather_pipeline.store import ProductStore
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _DiskStore(tmp_path)
    before = dict(ProductStore._product_cache)
    out = _fill(_full_recipient({(26.0, -90.0)}), store)
    assert out.coarse_fill["cells_filled"] == 1 and store.loads == [] and dict(ProductStore._product_cache) == before


def test_the_cold_path_fetches_to_disk_without_parsing_into_l1_and_a_refused_read_is_stamped(monkeypatch, tmp_path):
    from services.weather_pipeline import store_helpers
    from services.weather_pipeline.store import ProductStore
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _DiskStore(tmp_path, write=False)
    fetched = []

    def fake_fetch(st, filename, now=None):
        fetched.append(filename)
        (st.cache_dir / filename).write_text(_json.dumps({"grid": {"cols": 181, "rows": 83, "vectors": _lattice_vectors(1.0)}}))
        return True
    monkeypatch.setattr(store_helpers, "fetch_l2_to_disk", fake_fetch)
    before = dict(ProductStore._product_cache)
    out = _fill(_full_recipient({(26.0, -90.0)}), store)
    assert out.coarse_fill["cells_filled"] == 1 and fetched == [store.name] and store.loads == []
    assert dict(ProductStore._product_cache) == before                         # nothing parsed into L1, nothing evicted
    gf._DONOR_LRU.clear()
    (tmp_path / store.name).unlink()
    monkeypatch.setattr(store_helpers, "fetch_l2_to_disk", lambda st, f, now=None: False)
    out = _fill(_full_recipient({(26.0, -90.0)}), store)
    assert (out.coarse_fill["donor"], out.coarse_fill["cells_filled"]) == ("unreadable", 0)


def test_a_file_of_another_run_is_used_but_never_cached(monkeypatch, tmp_path):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _DiskStore(tmp_path, run="2026-10-23T06:00:00Z", file_run="2026-10-23T00:00:00Z")
    out = _fill(_full_recipient({(26.0, -90.0)}), store)
    assert out.coarse_fill["cells_filled"] == 1 and len(gf._DONOR_LRU) == 0


def test_the_manifest_resolution_guards_the_lattice_and_the_production_shape_fills_with_none(monkeypatch, tmp_path):
    """Stored global_mid files carry no resolution: the manifest's is used. A 1-deg recipient against a 2-deg GFS is refused;
    resolution None on a full lattice (the production shape) fills exactly, with -180 and 180 kept apart."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_full_recipient({(26.0, -90.0)}, resolution=1.0), _DiskStore(tmp_path, resolution=2.0))
    assert out.coarse_fill["donor"] == "lattice_mismatch"
    gf._DONOR_LRU.clear()
    vecs = _lattice_vectors(1.0, extra={(0.0, -180.0): 3.25, (0.0, 180.0): 0.5})
    out = _fill(_full_recipient({(0.0, -180.0), (0.0, 180.0)}, resolution=None), _DiskStore(tmp_path, vectors=vecs))
    cells = _by_node(out)
    assert (cells[(0.0, -180.0)].speed, cells[(0.0, 180.0)].speed) == (3.25, 0.5)


@pytest.mark.parametrize("kind", ["corrupt_json", "no_sea_node"])
def test_a_corrupt_or_empty_donor_is_stamped_counted_and_logged_once(monkeypatch, tmp_path, caplog, kind):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    raw = "{not json" if kind == "corrupt_json" else _json.dumps(
        {"grid": {"cols": 181, "rows": 83, "vectors": _lattice_vectors(1.0, all_masked=True)}})
    store = _DiskStore(tmp_path, raw=raw)
    with caplog.at_level("WARNING"):
        a = _fill(_full_recipient({(26.0, -90.0)}), store)
        b = _fill(_full_recipient({(26.0, -90.0)}), store)
    for out in (a, b):
        assert (out.coarse_fill["donor"], out.coarse_fill["cells_filled"]) == ("unreadable", 0)
    assert gf.TARGETED_NO_FILL[("EURO", "waves", "unreadable")] == 2
    assert sum("targeted fill skipped (unreadable" in r.message for r in caplog.records) == 1


def test_an_unreadable_manifest_says_so_and_the_warning_rearms_after_a_good_fill(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")

    class _NoManifest(_DiskStore):
        def get_manifest(self):
            raise OSError("manifest.json: permission denied")
    with caplog.at_level("WARNING"):
        out = _fill(_full_recipient({(26.0, -90.0)}), _NoManifest(tmp_path))
        assert out.coarse_fill["donor"] == "manifest_unreadable" and "permission denied" in out.coarse_fill["detail"]
        assert _fill(_full_recipient({(26.0, -90.0)}), _DiskStore(tmp_path)).coarse_fill["cells_filled"] == 1
        _fill(_full_recipient({(26.0, -90.0)}), _NoManifest(tmp_path))
    assert sum("manifest_unreadable" in r.message for r in caplog.records) == 2       # re-armed by the good fill


def test_the_lru_default_holds_two_48_frame_pages(monkeypatch):
    monkeypatch.delenv("MARINE_TARGETED_DONOR_CACHE", raising=False)
    assert gf._donor_cache_size() >= 96


def test_the_stats_report_hits_builds_and_no_fill_reasons(monkeypatch, tmp_path):
    """/admin/surf-forecast/status reads targeted_fill_stats(): the baseline and flip-watch numbers."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    store = _DiskStore(tmp_path)
    for _ in range(3):
        _fill(_full_recipient({(26.0, -90.0)}), store)
    _fill(_recipient(), _Store(mid_vt="2026-10-23T09:00:00Z"))               # no donor within 3 h
    s = gf.targeted_fill_stats()
    assert s["mode"] == "targeted" and s["donor_lru"]["builds"] == 1 and s["donor_lru"]["hits"] == 2
    assert s["donor_lru"]["size"] == 1 and s["donor_lru"]["capacity"] >= 96 and s["donor_lru"]["build_ms_mean"] is not None
    assert s["no_fill"] == {"EURO/waves/missing": 1}


# -- THE DONOR TIME (MARINE_GULF_FILL_DONOR_SERVED_TIME, 2026-10-26, dark) ---------------------------------------------------------
# The fill runs in the route AFTER resolve_grid set valid_time to the ASK (the echo contract) and recorded the frame's own instant
# in served_valid_time (stamp_frame_honesty), so a HELD frame was filled from GFS at the asked hour. Measured offline on real CDN
# fields (log/2026-10-25-claude-day14-evidence.md): ICON 11-08T18Z held for an ask at 11-09T02Z, filled from GFS 03Z, 9 h apart.
_HELD, _ASK = "2026-11-08T18:00:00Z", "2026-11-09T02:00:00Z"
_HELD_DT, _ASK_DT = datetime(2026, 11, 8, 18, tzinfo=timezone.utc), datetime(2026, 11, 9, 2, tzinfo=timezone.utc)


class _TwoInstants(_Store):
    """GFS donors at the held frame's own hour (speed 1.25 at 2 deg, 3.0 at 10 deg) and at the ask's nearest hour (4.0 / 5.0)."""

    def __init__(self):
        super().__init__(mid_vt=_HELD)
        self.items = [i for i in self.items if not (i.region_id == "global_coarse")]
        for name in [n for n in self.products if "global_coarse" in n]:
            coarse = self.products.pop(name)
            held = f"gfs_marine_{coarse.layer}_global_coarse_held.json"
            self.products[held] = coarse
            self.items.append(types.SimpleNamespace(model="GFS", domain="marine", layer=coarse.layer, region_id="global_coarse",
                                                    valid_time_start=_HELD, filename=held))
        for region, speed, cols in (("global_mid", 4.0, 181), ("global_coarse", 5.0, 37)):
            vecs = ([_vec(SEA_GULF, speed, direction=222.0, period=12.0), _vec(INLAND_TX, 0, False), _vec((28.0, -84.0), speed),
                     _vec(COAST_NEAR, 0, False)] if region == "global_mid"
                    else [_vec((25.0, -90.0), speed), _vec((30.0, -95.0), speed), _vec((30.0, -85.0), speed)])
            name = f"gfs_marine_waves_{region}_ask.json"
            self.products[name] = _product("GFS", region, "waves", vecs, cols, name)
            self.items.append(types.SimpleNamespace(model="GFS", domain="marine", layer="waves", region_id=region,
                                                    valid_time_start="2026-11-09T03:00:00Z", filename=name))


def _held(region="global_mid", served=_HELD):
    """A frame as resolve_grid hands it to the route: valid_time = the ASK, served_valid_time = the frame's own instant."""
    p = _recipient("ICON", "waves", region)
    p.valid_time = _ASK_DT
    p.served_valid_time = served
    return p


def test_the_donor_time_is_the_ask_by_default_and_the_frame_s_own_instant_under_the_flag(monkeypatch):
    held = _held()
    assert gf.donor_time(held) == _ASK_DT                      # today's order: valid_time (the ask) first
    monkeypatch.setenv("MARINE_GULF_FILL_DONOR_SERVED_TIME", "1")
    assert gf.donor_time(held) == _HELD
    assert gf.donor_time(_held(served=None)) == _ASK_DT        # no served time recorded: the ask, never None


def test_flag_off_keeps_today_s_asked_hour_donor_the_control(monkeypatch):
    """The control: with the flag off a held 2-deg frame is filled from GFS at the ASKED hour, as it is served today."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    out = _fill(_held(), _TwoInstants())
    assert _by_node(out)[SEA_GULF].speed == 4.0 and out.coarse_fill["donor_product"] == "gfs_marine_waves_global_mid_ask.json"


def test_flag_on_fills_a_held_2deg_frame_from_gfs_at_the_frame_s_own_hour(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    monkeypatch.setenv("MARINE_GULF_FILL_DONOR_SERVED_TIME", "1")
    out = _fill(_held(), _TwoInstants())
    gulf = _by_node(out)[SEA_GULF]
    assert (gulf.speed, gulf.direction, gulf.period) == (1.25, 111.0, 7.5)       # the 18Z donor's own values
    assert out.coarse_fill["donor_product"] == "gfs_marine_waves_global_mid.json"


def test_flag_on_moves_the_10deg_fill_to_the_frame_s_own_hour_too(monkeypatch):
    off = _fill(_held("global_coarse"), _TwoInstants())
    assert _by_node(off)[SEA_GULF].speed == 5.0                                   # the 03Z coarse donor (control)
    monkeypatch.setenv("MARINE_GULF_FILL_DONOR_SERVED_TIME", "1")
    on = _fill(_held("global_coarse"), _TwoInstants())
    assert _by_node(on)[SEA_GULF].speed == 3.0 and on.coarse_fill["cells_filled"] == off.coarse_fill["cells_filled"]


def test_a_frame_served_at_its_own_ask_is_unchanged_by_the_flag(monkeypatch):
    """Not held, not substituted (served == asked): the same donor either way, so the flag moves only mixed-instant frames."""
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    exact = lambda: _held(served="2026-11-09T02:00:00Z")   # noqa: E731
    before = _by_node(_fill(exact(), _TwoInstants()))[SEA_GULF].speed
    monkeypatch.setenv("MARINE_GULF_FILL_DONOR_SERVED_TIME", "1")
    assert _by_node(_fill(exact(), _TwoInstants()))[SEA_GULF].speed == before == 4.0
