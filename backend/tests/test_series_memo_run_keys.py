"""GRID_SERIES_MEMO_RUN_KEYS (series_memo_keys.py, dark): the run-keyed series page memo, offline.

Pins: relabelled bytes equal a fresh encode at the new anchor (real encoder); a body whose labels are not where a
series page puts them is refused; pages of the same valid times share across anchor hours (one build); a durable page
survives a manifest write to a model it did not read and is dropped by one it did (GFS for an EURO/ICON page; any
model outside GFS/ICON/EURO); a non-durable page is cleared by any write; a regional 2-deg page is kept; the dynamic
viewport index under the page's own cache keys, the hour-rounded clock at the EURO/ICON viewport limits, the UTC date
for ICON wind and the HRRR cycle for GFS wind each drop a page when they move; `wind_lane=gfs` never shares a page;
the store, the per-hour loop and the live lane report what the deps need; the dynamic lookup keys are the helper's own.
"""
import asyncio
import gzip
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline import series_memo_keys as K
from services.weather_pipeline import series_page_memo as M
from services.weather_pipeline.schemas import CoverageBounds, GridVector, ManifestProduct, PipelineManifest
from services.weather_pipeline.series_response import encode_json

ISO = "%Y-%m-%dT%H:%M:%SZ"
WORLD = "-180,-80,180,85"
REGIONAL = "-10.0000,36.0000,-6.0000,42.0000"      # 4 x 6 deg, on the 2-deg grid (ICON/EURO snap): a mid-tier view
NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
A, B = NOW, NOW + timedelta(hours=1)               # two client anchors inside the skew window
HOURS_A, HOURS_B = "0,3,6", "-1,2,5"              # the same three valid times from each anchor
MID = "gfs_marine_waves_global_mid_{:%Y%m%dT%H%M%SZ}.json"


def _entry(model, vt, filename, run=NOW - timedelta(hours=6)):
    return ManifestProduct(model=model, provider="open-meteo", domain="marine", layer="waves", run_time=run,
                           valid_time_start=vt, valid_time_end=vt, resolution=2.0, freshness_sec=3600,
                           is_forecast_authoritative=True,
                           coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
                           filename=filename, region_id="global_mid", product_id=filename)


def _manifest(extra=(), stamp=0, run=NOW - timedelta(hours=6)):
    vts = [A + timedelta(hours=h) for h in range(-3, 12)]
    products = [_entry("GFS", vt, MID.format(vt), run) for vt in vts]
    products += [_entry("ICON", vt, "icon_" + MID.format(vt)[4:], run) for vt in vts]
    return PipelineManifest(last_manifest_update=NOW + timedelta(seconds=stamp), products=products + list(extra))


class _Store:
    def __init__(self):
        self.manifest = _manifest()

    def get_manifest(self):
        return self.manifest


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(M, "MEMO", M.PageMemo())
    for name in ("GRID_SERIES_RESPONSE_BOUNDS", "GRID_RESPONSE_BOUNDS", "GRID_SERIES_GZIP_LEVEL",
                 "GRID_SERIES_PAGE_MEMO_TTL_S", "GRID_SERIES_PAGE_MEMO_RUN_TTL_S", "GFS_ICON_SERIES_FASTPATH"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GRID_SERIES_PAGE_MEMO", "1")
    monkeypatch.setenv(K.FLAG, "1")
    K._INDEX.update(key=None, by_key={})
    return tmp_path


def _frames(anchor, hours, model="GFS", pid=MID, dynamic=False, scope="global", cache_hit="", dynamic_hour0=None):
    out = []
    for h in hours:
        vt = anchor + timedelta(hours=h)
        out.append({"hour_offset": h, "valid_time": vt.strftime(ISO), "cols": 4, "rows": 2,
                    "bounds": {"west": -10.0, "south": 36.0, "east": -6.0, "north": 42.0},
                    "vectors": [GridVector(lat=36.0 + i, lng=-10.0, speed=1.25 + vt.hour / 10.0, direction=270.0,
                                           period=11.5, is_valid=True) for i in range(8)],
                    "provider": "open-meteo", "is_estimated": False, "rating_mode": False,
                    "model_run_time": None, "model_run_time_status": "missing", "ingested_at": None,
                    "run_time": "2026-10-20T06:00:00Z", "upstream_provider": "noaa", "source_dataset": "ncep",
                    "estimate_basis": {"basis": "trend", "weight": 0.25}, "served_valid_time": None,
                    "frame_offset_hours": 0.0, "frame_substituted": False, "product_id": pid.format(vt),
                    "region_id": "global_mid", "upstream_model": None, "wind_lane": None,
                    "_fact": (pid.format(vt), dynamic, scope, cache_hit)})
        if dynamic_hour0 is not None and len(out) == 1:      # hour 0 served from the dynamic-viewport index
            out[0]["product_id"] = dynamic_hour0
            out[0]["_fact"] = (dynamic_hour0, True, "viewport", "cache_hit")
    return out


def _page(anchor, source, hours, **kw):
    frames = _frames(anchor, hours, **kw)
    for f in frames:
        f.pop("_fact")
    return {"model": "GFS", "domain": "marine", "layer": "waves", "base_time": anchor.strftime(ISO),
            "bounds": frames[0]["bounds"], "cols": 4, "rows": 2, "frame_count": len(frames), "frames": frames,
            "base_time_source": source, "run_census": {"distinct_runs": 1, "mixed_runs": False}}


def _fake_build(calls, gate=None, **frame_kw):
    async def build(resolve_grid, viewport_service, model, domain, layer, bbox, hours, request=None, surf=False,
                    base_time=None, resolved_anchor=None):
        calls.append((bbox, hours, resolved_anchor))
        if gate is not None:
            await gate.wait()
        anchor, source = resolved_anchor
        hs = [int(h) for h in hours.split(",")]
        frames = _frames(anchor, hs, **frame_kw)
        sink = gsh.SERIES_FRAME_SINK.get()
        for f in frames:
            sink.append((False, ""))
            pid, dynamic, scope, cache_hit = f.pop("_fact")
            K.note_frame(SimpleNamespace(product_id=pid, is_dynamic_viewport_product=dynamic, coverage_scope=scope,
                                         cache_hit=cache_hit))
        return {"model": model, "domain": domain, "layer": layer, "base_time": anchor.strftime(ISO),
                "bounds": frames[0]["bounds"], "cols": 4, "rows": 2, "frame_count": len(frames), "frames": frames,
                "base_time_source": source, "run_census": {"distinct_runs": 1, "mixed_runs": False}}
    return build


def _vs(tmp_path):
    return SimpleNamespace(dynamic_index=SimpleNamespace(index_path=tmp_path / "dynamic_products_index.json"))


def _call(store, vs=None, anchor=A, hours=HOURS_A, model="GFS", layer="waves", bbox=WORLD, domain="marine"):
    return M.serve_memo_series(None, vs, store, model, domain, layer, bbox, hours, base_time=anchor.strftime(ISO))


def _outcome(resp):
    return resp.headers["server-timing"].split("memo;desc=")[1].split(";")[0]


def _decoded(resp):
    body = resp.body
    return json.loads(gzip.decompress(body) if resp.headers["content-encoding"] == "gzip" else body)


# ── 1. relabelling is exact ───────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("old,new", [(("client", A, HOURS_A), ("client", B, HOURS_B)),
                                     (("client", B, HOURS_B), ("server", A, HOURS_A)),
                                     (("client_rejected", A, HOURS_A), ("client", A, HOURS_A))])
def test_relabelled_bytes_equal_a_fresh_encode_at_the_new_anchor(old, new):
    src_old, a_old, h_old = old
    src_new, a_new, h_new = new
    before = encode_json(_page(a_old, src_old, [int(h) for h in h_old.split(",")]))
    want = encode_json(_page(a_new, src_new, [int(h) for h in h_new.split(",")]))
    assert K.relabel(before, 3, a_old, src_old, a_new, src_new) == want
    gz = K.relabel_body(gzip.compress(before), True, 3, a_old, src_old, a_new, src_new, 4)
    assert gz[1] is True and gzip.decompress(gz[0]) == want and gz[2] == len(want)


def test_a_body_whose_labels_are_not_where_expected_is_refused():
    page = _page(A, "client", [0, 3, 6])
    page["frames"][0]["estimate_basis"] = {"hour_offset": 9}          # a fourth "hour_offset" key
    assert K.relabel(encode_json(page), 3, A, "client", B, "client") is None
    assert K.relabel(encode_json(_page(A, "client", [0, 3, 6])), 3, B, "client", A, "client") is None, "wrong anchor"
    assert K.relabel(encode_json(_page(A, "client", [0, 3, 6])), 2, A, "client", B, "client") is None, "wrong count"


# ── 2. sharing across anchors ─────────────────────────────────────────────────────────────────────────────────
def test_the_same_valid_times_from_another_anchor_are_relabelled_not_rebuilt(fresh):
    calls, store = [], _Store()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            r1 = await _call(store, _vs(fresh), A, HOURS_A)
            r2 = await _call(store, _vs(fresh), B, HOURS_B)
            r3 = await _call(store, _vs(fresh), B, HOURS_B)
            r4 = await _call(store, _vs(fresh), A, HOURS_A)
        return r1, r2, r3, r4
    r1, r2, r3, r4 = asyncio.run(run())
    assert len(calls) == 1
    assert [_outcome(r) for r in (r1, r2, r3, r4)] == ["miss", "relabel", "hit", "relabel"]
    assert _decoded(r2) == json.loads(encode_json(_page(B, "client", [-1, 2, 5])))
    assert _decoded(r4) == _decoded(r1)


def test_a_request_joining_a_build_for_another_anchor_gets_its_own_labels(fresh):
    calls, store, gate = [], _Store(), asyncio.Event()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls, gate=gate)):
            ta = asyncio.create_task(_call(store, _vs(fresh), A, HOURS_A))
            tb = asyncio.create_task(_call(store, _vs(fresh), B, HOURS_B))
            await asyncio.sleep(0.05)
            gate.set()
            return await ta, await tb
    ra, rb = asyncio.run(run())
    # Which request leads is not deterministic (each first hops to a worker thread for the manifest state).
    assert len(calls) == 1 and sorted([_outcome(ra), _outcome(rb)]) == ["miss", "shared"]
    assert _decoded(ra)["base_time"] == A.strftime(ISO) and [f["hour_offset"] for f in _decoded(ra)["frames"]] == [0, 3, 6]
    assert _decoded(rb)["base_time"] == B.strftime(ISO) and [f["hour_offset"] for f in _decoded(rb)["frames"]] == [-1, 2, 5]


def test_wind_lane_gfs_requests_never_share_a_page(fresh):
    from services.weather_pipeline import wind_lane
    calls, store = [], _Store()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            await _call(store, _vs(fresh))
            tok = wind_lane.request_mode.set("gfs")
            try:
                r = await _call(store, _vs(fresh))
            finally:
                wind_lane.request_mode.reset(tok)
        return r
    assert _outcome(asyncio.run(run())) == "miss" and len(calls) == 2


def test_the_w4_key_also_separates_lane_modes(fresh, monkeypatch):
    monkeypatch.setenv(K.FLAG, "0")
    test_wind_lane_gfs_requests_never_share_a_page(fresh)


# ── 3. durable pages and the manifest ─────────────────────────────────────────────────────────────────────────
def _kept(key_model="GFS"):
    return [(k, page) for k, (_, page) in M.MEMO.entries.items() if k[1] == key_model]


def _write(store, *extra, stamp):
    store.manifest = _manifest(extra=extra, stamp=stamp)


@pytest.mark.parametrize("model,frame_kw,survives_icon,survives_gfs", [
    ("GFS", {}, True, False),
    ("EURO", {"pid": "euro_" + MID[4:]}, True, False),       # EURO reads GFS (the gulf fill's donor)
    ("ICON", {"pid": "icon_" + MID[4:]}, False, False),
])
def test_a_durable_page_survives_writes_to_models_it_did_not_read(fresh, model, frame_kw, survives_icon, survives_gfs):
    calls, store = [], _Store()
    if model == "EURO":
        store.manifest.products += [_entry("EURO", A + timedelta(hours=h), "euro_" + MID[4:].format(A + timedelta(hours=h)))
                                    for h in (0, 3, 6)]
        store.manifest.last_manifest_update += timedelta(seconds=1)
    late = A + timedelta(hours=40)

    async def run():
        out = []
        with patch.object(gsh, "build_grid_series", _fake_build(calls, **frame_kw)):
            await _call(store, _vs(fresh), model=model)
            base = list(store.manifest.products)
            store.manifest = PipelineManifest(last_manifest_update=NOW + timedelta(minutes=1),
                                              products=base + [_entry("ICON", late, "icon_new.json")])
            out.append(_outcome(await _call(store, _vs(fresh), model=model)))
            store.manifest = PipelineManifest(last_manifest_update=NOW + timedelta(minutes=2),
                                              products=base + [_entry("ICON", late, "icon_new.json"),
                                                               _entry("GFS", late, "gfs_new.json")])
            out.append(_outcome(await _call(store, _vs(fresh), model=model)))
        return out
    after_icon, after_gfs = asyncio.run(run())
    assert after_icon == ("hit" if survives_icon else "miss")
    assert after_gfs == ("hit" if survives_gfs else "miss")


def test_a_rerun_of_a_file_the_page_read_drops_it(fresh):
    calls, store = [], _Store()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            await _call(store, _vs(fresh))
            store.manifest = _manifest(stamp=60, run=NOW)       # same filenames, a newer run: re-registered
            return await _call(store, _vs(fresh))
    assert _outcome(asyncio.run(run())) == "miss" and len(calls) == 2


def test_a_change_to_a_model_outside_the_three_drops_every_page(fresh):
    calls, store = [], _Store()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            await _call(store, _vs(fresh))
            consensus = _entry("CONSENSUS", A, "consensus_marine_waves_r_x.json")
            store.manifest = PipelineManifest(last_manifest_update=NOW + timedelta(minutes=3),
                                              products=list(store.manifest.products) + [consensus])
            return await _call(store, _vs(fresh))
    assert _outcome(asyncio.run(run())) == "miss"


def test_a_page_with_a_dynamic_frame_is_kept_only_by_the_w4_rules(fresh):
    calls, store = [], _Store()

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls, dynamic=True)):
            await _call(store, _vs(fresh))
            (key, page), = _kept()
            assert not page.deps.durable and page.cacheable
            assert M.MEMO.entries[key][0] - __import__("time").monotonic() <= 181.0, "the W-4 180 s TTL"
            store.manifest = PipelineManifest(last_manifest_update=NOW + timedelta(minutes=4),
                                              products=list(store.manifest.products) + [_entry("ICON", NOW, "x.json")])
            return await _call(store, _vs(fresh))
    assert _outcome(asyncio.run(run())) == "miss", "a non-durable page is cleared by any manifest write"


def test_a_durable_page_lives_the_run_ttl(fresh):
    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build([])):
            await _call(_Store(), _vs(fresh))
    asyncio.run(run())
    (key, page), = _kept()
    assert page.deps.durable and M.MEMO.entries[key][0] - __import__("time").monotonic() > 3500.0


def test_a_regional_mid_page_is_kept_under_run_keys_but_not_under_w4(fresh, monkeypatch):
    def run_twice():
        calls, store = [], _Store()

        async def run():
            with patch.object(gsh, "build_grid_series", _fake_build(calls, pid="icon_" + MID[4:])):
                await _call(store, _vs(fresh), model="ICON", bbox=REGIONAL)
                return await _call(store, _vs(fresh), model="ICON", bbox=REGIONAL)
        return _outcome(asyncio.run(run())), len(calls)
    assert run_twice() == ("hit", 1)
    monkeypatch.setenv(K.FLAG, "0")
    M.MEMO = M.PageMemo()
    assert run_twice() == ("miss", 2), "W-4 refuses a zoomed 2-deg mid page (the fine tile may land later)"


def test_live_lane_attempts_partial_frames_fetches_and_previews_are_never_durable():
    snap = {"a.json": ("GFS", 1)}
    facts = [("a.json", False, "global", "")]
    assert K.is_durable(facts, {}, 1, snap)
    assert not K.is_durable(facts, {"live_attempted": True}, 1, snap)
    assert not K.is_durable([("a.json", False, "regional_partial", "")], {}, 1, snap)
    assert not K.is_durable([("b.json", False, "global", "")], {}, 1, snap), "not a manifest file"
    assert not K.is_durable(facts, {}, 2, snap) and not K.is_durable(facts, {}, 1, None)
    hit = [("v.json", True, "viewport", "cache_hit")]
    assert K.is_durable(hit, {}, 1, snap, frozenset({"v.json"})), "a fresh index hit the page's rows held"
    assert not K.is_durable(hit, {}, 1, snap), "an entry the build-start rows did not hold"
    for how in ("cache_miss", "stale_cache_hit", "coarse_preview", ""):
        assert not K.is_durable([("v.json", True, "viewport", how)], {}, 1, snap, frozenset({"v.json"})), how


def test_the_stale_age_is_the_lookups_own():
    import inspect
    from services.weather_pipeline import viewport_helper
    assert f"age_sec > {int(K.DYNAMIC_STALE_S)}" in inspect.getsource(viewport_helper.get_cached_dynamic_product_helper)


def test_a_regional_page_whose_hour_0_is_a_fresh_index_hit_is_kept_until_that_entry_turns_stale(fresh):
    calls, store, vs = [], _Store(), _vs(fresh)
    keys = K.dynamic_keys("ICON", "marine", "waves", REGIONAL, K.valid_times(A, (0, 3, 6)))
    now = datetime.now(timezone.utc)
    _index(vs.dynamic_index.index_path, [{"cache_key": keys[0], "product_id": "viewport_fine.json",
                                          "created_at": (now - timedelta(seconds=K.DYNAMIC_STALE_S - 1.5)).isoformat(),
                                          "expires_at": (now + timedelta(hours=3)).isoformat()}])

    async def run():
        out = []
        with patch.object(gsh, "build_grid_series", _fake_build(calls, pid="icon_" + MID[4:],
                                                                dynamic_hour0="viewport_fine.json")):
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
            (_, page), = _kept("ICON")
            assert page.deps.durable
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
            await asyncio.sleep(1.8)          # the entry is now past the lookup's stale age: a rebuild would refresh it
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
        return out
    assert asyncio.run(run()) == ["miss", "hit", "miss"]


# ── 4. the other inputs ───────────────────────────────────────────────────────────────────────────────────────
def _index(path, rows):
    path.write_text(json.dumps(rows))


def test_the_dynamic_index_under_the_page_keys_drops_it_and_other_keys_do_not(fresh):
    calls, store, vs = [], _Store(), _vs(fresh)
    idx = vs.dynamic_index.index_path
    keys = K.dynamic_keys("ICON", "marine", "waves", REGIONAL, K.valid_times(A, (0, 3, 6)))
    later = (NOW + timedelta(hours=3)).isoformat()
    made = datetime.now(timezone.utc).isoformat()

    async def run():
        out = []
        with patch.object(gsh, "build_grid_series", _fake_build(calls, pid="icon_" + MID[4:])):
            _index(idx, [{"cache_key": "viewport_other", "product_id": "o.json", "created_at": made, "expires_at": later}])
            await _call(store, vs, model="ICON", bbox=REGIONAL)
            _index(idx, [{"cache_key": "viewport_other2", "product_id": "o2.json", "created_at": made, "expires_at": later}])
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
            _index(idx, [{"cache_key": keys[1], "product_id": "fine.json", "created_at": made, "expires_at": later}])
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
            out.append(_outcome(await _call(store, vs, model="ICON", bbox=REGIONAL)))
        return out
    assert asyncio.run(run()) == ["hit", "miss", "hit"]
    assert len(calls) == 2


def test_an_expiring_index_entry_under_the_page_keys_drops_it(fresh):
    calls, store, vs = [], _Store(), _vs(fresh)
    keys = K.dynamic_keys("ICON", "marine", "waves", REGIONAL, K.valid_times(A, (0, 3, 6)))
    _index(vs.dynamic_index.index_path, [{"cache_key": keys[0], "product_id": "fine.json",
                                          "created_at": datetime.now(timezone.utc).isoformat(),
                                          "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()}])

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls, pid="icon_" + MID[4:])):
            await _call(store, vs, model="ICON", bbox=REGIONAL)
            await asyncio.sleep(1.2)
            return await _call(store, vs, model="ICON", bbox=REGIONAL)
    assert _outcome(asyncio.run(run())) == "miss"


def _deps(model, domain, vts, round_hour, date=None, layer="waves"):
    return K.PageDeps(model=model, domain=domain, layer=layer, vts=vts, round_hour=round_hour, utc_date=date)


def test_the_clock_crossing_a_euro_or_icon_viewport_limit_drops_the_page():
    r0 = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
    euro_edge = ((r0 + timedelta(hours=241)).strftime(ISO),)
    d = _deps("EURO", "marine", euro_edge, r0)
    assert K.clock_still_valid(d, r0 + timedelta(minutes=20)), "same rounded hour"
    assert not K.clock_still_valid(d, r0 + timedelta(minutes=40)), "rounds to 13:00: 241 h is now inside 240 h"
    inside = ((r0 + timedelta(hours=100)).strftime(ISO),)
    assert K.clock_still_valid(_deps("EURO", "marine", inside, r0), r0 + timedelta(hours=5))
    icon_edge = ((r0 + timedelta(hours=169)).strftime(ISO),)
    assert not K.clock_still_valid(_deps("ICON", "marine", icon_edge, r0), r0 + timedelta(hours=1))
    assert K.clock_still_valid(_deps("GFS", "marine", euro_edge, r0), r0 + timedelta(hours=9)), "GFS has no limit"


def test_the_utc_date_drops_an_icon_wind_page():
    r0 = datetime(2026, 10, 20, 23, tzinfo=timezone.utc)
    d = _deps("ICON", "wind", (r0.strftime(ISO),), r0, date=r0.date(), layer="wind")
    assert K.clock_still_valid(d, r0 + timedelta(minutes=30))
    assert not K.clock_still_valid(d, r0 + timedelta(hours=1, minutes=30))


def test_a_new_hrrr_cycle_drops_a_gfs_wind_page(fresh, monkeypatch):
    from services.weather_pipeline import wind_lane
    calls, store = [], _Store()
    lanes = iter(["cycle-12", "cycle-12", "cycle-13", "cycle-13", "cycle-13"])
    monkeypatch.setattr(wind_lane, "enabled", lambda: True)
    monkeypatch.setattr(wind_lane, "current_lane", lambda: SimpleNamespace(key=next(lanes)))

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            out = []
            for _ in range(3):
                out.append(_outcome(await _call(store, _vs(fresh), domain="wind", layer="wind")))
        return out
    assert asyncio.run(run()) == ["miss", "hit", "miss"]


# ── 5. what the build reports ─────────────────────────────────────────────────────────────────────────────────
def test_the_store_reports_every_file_a_build_reads(tmp_path):
    from services.weather_pipeline.store import ProductStore
    loads = set()
    tok = K.SERIES_LOADS.set(loads)
    try:
        ProductStore(cache_dir=tmp_path).load_product("gfs_marine_waves_absent.json")
    finally:
        K.SERIES_LOADS.reset(tok)
    assert loads == {"gfs_marine_waves_absent.json"}


def test_the_live_lane_attempt_is_reported(monkeypatch):
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
    notes = {}

    async def never(*a, **k):
        raise TimeoutError("offline")

    async def no(*a, **k):
        return False

    async def run():
        tok = K.SERIES_BUILD_NOTES.set(notes)
        try:
            with patch.object(gsh, "live_lane_cannot_beat_stored", no), patch.object(gsh, "has_stored_series_coverage", no), \
                    patch.object(gsh, "_build_openmeteo_marine_series", never):
                async def resolve_grid(**kw):
                    return None
                await gsh._build_grid_series_impl(resolve_grid, object(), "GFS", "marine", "waves", REGIONAL, "0")
        finally:
            K.SERIES_BUILD_NOTES.reset(tok)
    asyncio.run(run())
    assert notes == {"live_attempted": True}


def test_the_real_per_hour_loop_reports_frames_and_its_page_is_durable(fresh):
    vt0 = A

    def product(valid_time, **kw):
        vt = datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
        return SimpleNamespace(
            grid=SimpleNamespace(cols=3, rows=2, bounds=SimpleNamespace(west=-82.0, south=20.0, east=-79.0, north=22.0),
                                 vectors=[GridVector(lat=20.0, lng=-82.0 + i, speed=1.0, is_valid=True) for i in range(6)],
                                 diagnostics={}),
            valid_time=vt, provider="open-meteo", is_estimated=False, run_time=None, upstream_provider="noaa",
            source_dataset="ncep", estimate_basis=None, served_valid_time=None, frame_offset_hours=0.0,
            frame_substituted=False, stale=False, cache_hit=None, product_id=MID.format(vt), region_id="global_mid",
            upstream_model=None, wind_lane=None, is_dynamic_viewport_product=False, coverage_scope="global")

    async def resolve_grid(**kw):
        return product(**kw)

    store = _Store()

    async def run():
        r1 = await M.serve_memo_series(resolve_grid, _vs(fresh), store, "GFS", "marine", "waves", WORLD, HOURS_A,
                                       base_time=vt0.strftime(ISO))
        r2 = await M.serve_memo_series(resolve_grid, _vs(fresh), store, "GFS", "marine", "waves", WORLD, HOURS_B,
                                       base_time=B.strftime(ISO))
        return r1, r2
    r1, r2 = asyncio.run(run())
    (key, page), = _kept()
    assert page.deps.durable and page.deps.files == frozenset(MID.format(A + timedelta(hours=h)) for h in (0, 3, 6))
    assert _outcome(r1) == "miss" and _outcome(r2) == "relabel"
    assert [f["hour_offset"] for f in _decoded(r2)["frames"]] == [-1, 2, 5]


def test_the_memo_keys_are_the_dynamic_lookups_own_keys():
    from services.weather_pipeline import viewport_helper
    seen = []

    class _Index:
        def find_product(self, model, domain, layer, valid_time, cache_key):
            seen.append(cache_key)
            return None

    async def run():
        for vt in (A, A + timedelta(hours=3)):
            await viewport_helper.get_cached_dynamic_product_helper(
                service=SimpleNamespace(dynamic_index=_Index()), model="ICON", domain="marine", layer="waves",
                target_dt=vt, bbox_str="-9.3,36.4,-6.6,41.2")
    try:
        asyncio.run(run())
    except Exception:
        pass       # only the lookup key matters; a miss may continue into code this fake service does not carry
    want = K.dynamic_keys("ICON", "marine", "waves", "-9.3,36.4,-6.6,41.2", K.valid_times(A, (0, 3)))
    assert seen and tuple(seen) == want[:len(seen)]


# ── 6. the pure pieces ────────────────────────────────────────────────────────────────────────────────────────
def test_manifest_diff_and_keeps_through():
    old = {"g.json": ("GFS", 1), "i.json": ("ICON", 2)}
    new = {"g.json": ("GFS", 9), "i.json": ("ICON", 2), "e.json": ("EURO", 3)}
    assert K.manifest_diff(old, new) == ({"GFS", "EURO"}, {"g.json", "e.json"})
    durable = K.PageDeps(durable=True, models=frozenset({"ICON"}), files=frozenset({"i.json"}))
    assert K.keeps_through(durable, {"GFS", "EURO"}, {"g.json", "e.json"})
    assert not K.keeps_through(durable, {"ICON"}, {"i2.json"})
    assert not K.keeps_through(durable, {"GFS"}, {"i.json"}), "a file it read changed"
    assert not K.keeps_through(durable, {"CONSENSUS"}, {"c.json"})
    assert not K.keeps_through(K.PageDeps(durable=False, models=frozenset(), files=frozenset()), set(), set())
    assert not K.keeps_through(None, set(), set())


def test_the_snapshot_sees_a_rerun_of_the_same_filename():
    a, b = _manifest(), _manifest(run=NOW)
    sa, sb = K.manifest_snapshot(a), K.manifest_snapshot(b)
    assert sa.keys() == sb.keys() and K.manifest_diff(sa, sb)[0] == {"GFS", "ICON"}
    assert K.manifest_diff(sa, K.manifest_snapshot(_manifest())) == (set(), set())
