"""THE DAY-14 END (2026-10-24): the marine heatmap's last scrubber hours, and the ICON/EURO tails as static frames.

The scrubber ends at NOW + 336 h (/capabilities); every stored marine lane ends at RUN + 336 h. Measured live 2026-10-24
~05Z at now + 336 h (one /grid each, /api/health green before and after):
  GFS   world box -> a 19x9 = 171-vector upstream fetch (the stored 2-deg frame has 15,023 nodes): the "empty" day 14
  ICON  world box -> far-edge hold of the 10-deg global_coarse frame (+11 h) although a 2-deg mid frame of that hour is stored
  EURO  world box -> the same coarse hold (one probe 404'd while the core lane rewrote the EURO tail)
Fixes, all DARK: FAR_EDGE_HOLD_PREFER_MID, FAR_EDGE_HOLD_BEFORE_UPSTREAM (serve), GFS_WORLD_FULL_HORIZON (ingest), and
FRAME_TAIL_DOWNLOAD (the pilots publisher builds the core lane's ICON/EURO tails too; no served number moves).
"""
import asyncio
import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services.weather_pipeline import far_edge_hold as feh  # noqa: E402
from services.weather_pipeline import marine_mid_res_ingestion as mmr  # noqa: E402

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
NOW = datetime(2026, 11, 7, 4, 0, 0, tzinfo=timezone.utc)
TAIL = datetime(2026, 11, 6, 18, 0, 0, tzinfo=timezone.utc)      # every stored lane's last frame, measured


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("FAR_EDGE_HOLD", "FAR_EDGE_HOLD_MAX_H", "FAR_EDGE_HOLD_PREFER_MID", "FAR_EDGE_HOLD_BEFORE_UPSTREAM",
              "FAR_EDGE_HOLD_UPSTREAM_MIN_RES", "GFS_WORLD_FULL_HORIZON", "FRAME_TAIL_DOWNLOAD", "FRAME_TAIL_DOWNLOAD_MAX",
              "FRAME_SETS"):
        monkeypatch.delenv(k, raising=False)


# ── the far-edge hold: the 2-deg tier before the 10-deg one ──────────────────────────────────────────────────────────────

def _mp(vt, region_id, model="ICON", is_estimated=True, layer="waves"):
    return SimpleNamespace(model=model, domain="marine", layer=layer, coverage_mode="global_tile", region_id=region_id,
                           valid_time_start=vt, is_estimated=is_estimated,
                           filename=f"{model.lower()}_marine_{layer}_{region_id}_{vt:%Y%m%dT%H%M%SZ}_estimated.json")


class _Store:
    def __init__(self, products):
        self._products, self.loaded = products, []

    def get_manifest(self):
        return SimpleNamespace(products=self._products)

    def load_product(self, filename):
        self.loaded.append(filename)
        return SimpleNamespace(grid=SimpleNamespace(vectors=[SimpleNamespace(speed=1.0)]), is_estimated=True,
                               is_forecast_authoritative=False, estimate_basis=None, warnings=[], coverage_scope=None,
                               product_id=None)


def _hold(store, target=NOW, model="ICON"):
    return asyncio.run(feh.try_far_edge_hold(store, model, "marine", "waves", target))


def test_the_plain_hold_takes_whichever_tier_the_manifest_lists_first_the_live_defect():
    coarse, mid = _mp(TAIL, "global_coarse"), _mp(TAIL, "global_mid")
    store = _Store([coarse, mid])
    assert _hold(store) is not None and store.loaded == [coarse.filename]    # live: 37x17 served, 181x83 stored


def test_prefer_mid_holds_the_2deg_frame_of_the_same_hour(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD_PREFER_MID", "1")
    coarse, mid = _mp(TAIL, "global_coarse"), _mp(TAIL, "global_mid")
    store = _Store([coarse, mid])
    prod = _hold(store)
    assert store.loaded == [mid.filename] and prod.estimate_basis["gap_hours"] == 10.0


def test_prefer_mid_takes_an_older_mid_frame_inside_the_bound_and_never_one_outside(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD_PREFER_MID", "1")
    coarse, mid = _mp(TAIL, "global_coarse"), _mp(TAIL - timedelta(hours=6), "global_mid")
    store = _Store([coarse, mid])
    assert _hold(store).estimate_basis["gap_hours"] == 16.0 and store.loaded == [mid.filename]
    old_mid = _mp(TAIL - timedelta(hours=20), "global_mid")      # 30 h before the target > the 24 h bound
    store = _Store([coarse, old_mid])
    assert _hold(store) is not None and store.loaded == [coarse.filename]


def test_prefer_mid_keeps_every_rail_of_the_hold(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD_PREFER_MID", "1")
    # a mid-range hole (coverage beyond the target) is never masked, whichever tier
    assert _hold(_Store([_mp(TAIL, "global_mid"), _mp(NOW + timedelta(hours=3), "global_coarse")])) is None
    monkeypatch.setenv("FAR_EDGE_HOLD", "0")
    assert _hold(_Store([_mp(TAIL, "global_mid")])) is None


# ── the hold before the on-demand upstream fetch ─────────────────────────────────────────────────────────────────────────

def test_upstream_resolution_mirrors_the_marine_200_point_rule():
    assert feh.upstream_resolution(-180, -85, 180, 85) == 20.0      # the world box: the 19x9 grid measured live
    assert feh.upstream_resolution(-100, -10, -40, 50) == 5.0      # a 60 x 60 deg box
    assert feh.upstream_resolution(-82, 25, -72, 35) == 1.0         # a 10 x 10 deg coast
    assert feh.upstream_resolution(170, -10, -170, 10) == 2.0       # dateline-crossing 20 x 20
    assert feh.upstream_resolution(None, 0, 1, 1) is None


def _before(store, box, domain="marine"):
    return asyncio.run(feh.hold_before_upstream(store, "GFS", domain, "waves", NOW, *box))


def test_hold_before_upstream_is_dark_by_default():
    store = _Store([_mp(TAIL, "global_mid", model="GFS", is_estimated=False)])
    assert _before(store, (-180, -85, 180, 85)) is None and store.loaded == []


def test_hold_before_upstream_holds_a_world_box_and_leaves_fine_boxes_to_the_live_fetch(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD_BEFORE_UPSTREAM", "1")
    world = _before(_Store([_mp(TAIL, "global_mid", model="GFS", is_estimated=False)]), (-180, -85, 180, 85))
    assert world is not None and world.is_estimated is True and world.is_forecast_authoritative is False
    assert "far_edge_hold_before_upstream:20deg" in world.warnings
    fine = _Store([_mp(TAIL, "global_mid", model="GFS", is_estimated=False)])
    assert _before(fine, (-82, 25, -72, 35)) is None and fine.loaded == []          # 1-deg live grid beats a 2-deg hold
    assert _before(_Store([_mp(TAIL, "global_mid", model="GFS")]), (-180, -85, 180, 85), domain="wind") is None
    monkeypatch.setenv("FAR_EDGE_HOLD_UPSTREAM_MIN_RES", "30")
    assert _before(_Store([_mp(TAIL, "global_mid", model="GFS")]), (-180, -85, 180, 85)) is None


def test_hold_before_upstream_never_answers_inside_stored_coverage(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_HOLD_BEFORE_UPSTREAM", "1")
    store = _Store([_mp(TAIL, "global_mid", model="GFS"), _mp(NOW + timedelta(hours=3), "global_mid", model="GFS")])
    assert _before(store, (-180, -85, 180, 85)) is None


def test_the_resolver_tries_the_hold_before_the_preview_the_upstream_fetch_and_a_cached_upstream_grid():
    """Order, measured offline 2026-10-24 (two synthetic backends, flags off/on): a cached upstream world grid is served at
    Steps 1&2 and the 10-deg tail frame by Step 3.7's instant preview, both AHEAD of Step 4, so the hold must come first."""
    src = (Path(mmr.__file__).parent / "grid_resolver.py").read_text(encoding="utf-8")
    call = "hold_before_upstream(store, model, domain, layer, target_dt"
    cached = src.index("product = await viewport_service.get_cached_dynamic_product(")
    first = src.index(call)
    second = src.index(call, first + 1)
    preview = src.index("# Step 3.7: Instant coarse preview for marine")
    fetch = src.index("product = await viewport_service.fetch_viewport_grid_upstream(\n                    model=model")
    assert cached < first < preview and first < second < preview < fetch
    assert src.count(call) == 2


# ── GFS world tiers to f384 ──────────────────────────────────────────────────────────────────────────────────────────────

def test_gfs_world_fetch_days_is_dark_and_only_ever_widens(monkeypatch):
    assert mmr.gfs_world_fetch_days(14) == 14
    monkeypatch.setenv("GFS_WORLD_FULL_HORIZON", "1")
    assert mmr.gfs_world_fetch_days(14) == 16 and mmr.gfs_world_fetch_days(2) == 16
    assert mmr.gfs_world_fetch_days(17) == 17


def _points(n_times, n_points=3):
    base = datetime(2026, 10, 24, 0, tzinfo=timezone.utc)
    times = [(base + timedelta(hours=3 * i)).strftime("%Y-%m-%dT%H:%M") for i in range(n_times)]
    return [{"latitude": float(k), "longitude": 0.0, "__model_run_time": base.isoformat(),
             "hourly_units": {"time": "iso8601"},
             "hourly": {"time": list(times), "wave_height": [1.0 + i for i in range(n_times)], "note": "scalar"}}
            for k in range(n_points)]


def test_trim_points_to_days_returns_exactly_a_14_day_fetch_and_copies():
    pts = _points(16 * 8 + 1)
    out = mmr.trim_points_to_days(pts, 14)
    assert all(len(p["hourly"]["time"]) == 14 * 8 + 1 == len(p["hourly"]["wave_height"]) for p in out)
    assert out[0]["hourly"]["time"][-1] == "2026-11-07T00:00"            # f336 from the 2026-10-24T00Z cycle
    assert out[0]["hourly"]["note"] == "scalar"
    assert len(pts[0]["hourly"]["time"]) == 129                           # the shared pass's points are untouched
    short = _points(40)                                                   # a soft-deadline truncation: nothing to cut
    assert mmr.trim_points_to_days(short, 14) == short


@pytest.mark.asyncio
async def test_the_flagship_pass_downloads_16_days_once_and_trims_its_regional_tiles(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_marine_service as noaa_marine

    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_MID_RES_FORECAST_DAYS", "14")
    monkeypatch.setenv("GFS_MARINE_FLAGSHIP_FORECAST_DAYS", "14")
    monkeypatch.setenv("GFS_WORLD_FULL_HORIZON", "1")
    scheduler = WeatherPipelineScheduler(store=ProductStore(cache_dir=tmp_path))
    calls, saved = [], {}

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        calls.append((forecast_days, set(bboxes)))
        return {rid: _points(forecast_days * 8 + 1) for rid in bboxes}

    async def fake_regional(sched, env, run_time, model, layers, region_id, region, results, step, label):
        saved[region_id] = len(results[0]["hourly"]["time"])
        return 1

    async def fake_mid(sched, env, run_time, results, resolution, step):
        saved["global_mid"] = len(results[0]["hourly"]["time"])
        return 1

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    monkeypatch.setattr(mmr, "_save_marine_regional", fake_regional)
    monkeypatch.setattr(mmr, "save_gfs_marine_global_mid", fake_mid)
    await scheduler.ingest_gfs_marine_pilot()
    assert calls == [(16, set(REGIONAL_CONFIGS) | {"global_mid"})]       # ONE pass, the fold intact
    assert saved["global_mid"] == 129                                     # the world tile keeps f000..f384
    assert {saved[r] for r in REGIONAL_CONFIGS} == {113}                  # every regional tile exactly as a 14-day fetch


# ── the ICON/EURO tails as static frames (pilots publisher) ──────────────────────────────────────────────────────────────

ICON = {"model": "ICON", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
GFS = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
RUN = "2026-10-23T12:00:00Z"


def _product(target, valid, run=RUN, estimated=False, cols=6, rows=4):
    vecs = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = -60.0 + r * 40.0, -180.0 + c * 72.0
            if (r + c) % 5 == 0:
                vecs.append({"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0,
                             "gust": None, "value": None, "is_valid": False, "dir_confidence": None})
                continue
            h, d = round(1.0 + 0.1 * r + 0.01 * c, 4), round((30.0 * c + 7.0 * r) % 360.0, 2)
            rad = math.radians(d)
            vecs.append({"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4),
                         "v": round(-h * math.cos(rad), 4), "period": round(8.0 + r, 2), "gust": None, "value": None,
                         "is_valid": True, "dir_confidence": 0.9})
    return {"model": target["model"], "provider": "estimated" if estimated else "open-meteo", "domain": "marine",
            "layer": target["layer"], "run_time": run, "model_run_time": run, "model_run_time_status": "known",
            "ingested_at": None if estimated else run, "valid_time": valid, "is_forecast_authoritative": not estimated,
            "is_estimated": estimated, "estimate_basis": {"type": "icon_persistence_gfs_blend"} if estimated else None,
            "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft", "region_id": "global_mid",
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -180.0, "south": -62.0, "east": 180.0, "north": 61.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


AUTH = ["2026-10-30T06:00:00Z", "2026-10-30T09:00:00Z", "2026-10-30T12:00:00Z", "2026-10-30T15:00:00Z"]
TAILS = ["2026-11-06T12:00:00Z", "2026-11-06T15:00:00Z", "2026-11-06T18:00:00Z"]


def _name(target, vt, est):
    return (f"{target['model'].lower()}_marine_{target['layer']}_global_mid_{vt.replace('-', '').replace(':', '')}"
            f"{'_estimated' if est else ''}.json")


def _stores(tmp, target=ICON, bucket_run=RUN, auth_local=True):
    """(runner disk, products bucket): the authoritative entries on disk, the estimated tail only in the bucket."""
    disk, bucket = tmp / "disk", tmp / "bucket"
    disk.mkdir(parents=True, exist_ok=True)
    bucket.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt, est in [(v, False) for v in AUTH] + [(v, True) for v in TAILS]:
        name = _name(target, vt, est)
        body = json.dumps(_product(target, vt, run=(bucket_run if est else RUN), estimated=est))
        (bucket / name).write_text(body)
        if not est and auth_local:
            (disk / name).write_text(body)
        entries.append({**target, "filename": name, "valid_time_start": vt, "model_run_time": RUN, "run_time": RUN,
                        "ingested_at": None if est else RUN, "is_estimated": est})
    (disk / "manifest.json").write_text(json.dumps({"products": entries}))
    return disk, bucket


def _publish(source, out, target=ICON):
    return pub.publish_frame_sets(source, pub.LocalSink(out), sets=[target], log=lambda *_: None)


def test_without_the_flag_the_tail_stays_not_local_and_nothing_is_downloaded(tmp_path):
    disk, _bucket = _stores(tmp_path)
    stats = _publish(pub.LocalCache(disk), tmp_path / "out")[fs.set_key(ICON)]
    assert (stats["built"], stats["not_local"]) == (4, 3) and "tail_downloaded" not in stats


def test_tail_downloads_build_the_tail_through_the_same_parity_gate(tmp_path):
    disk, bucket = _stores(tmp_path)
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), log=lambda *_: None)
    stats = _publish(src, tmp_path / "out")[fs.set_key(ICON)]
    assert (stats["built"], stats["not_local"], stats["refused"], stats["parity_bad"]) == (7, 0, 0, 0)
    assert stats["tail_downloaded"] == 3 and src.stats["downloaded"] == 3 and src.stats["wire_bytes"] > 0
    latest = json.loads((tmp_path / "out" / fs.LATEST).read_text())["sets"][fs.set_key(ICON)]
    index = json.loads((tmp_path / "out" / latest["index"]).read_text())
    built_tail = [f for f in index["frames"] if f["is_estimated"]]
    assert [f["valid_time"] for f in built_tail] == TAILS and all(f["path"] for f in built_tail)
    assert all(f["meta"]["product_id"].endswith("_estimated.json") for f in built_tail)
    # the next cycle with the same products carries every frame: no download at all
    src2 = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), log=lambda *_: None)
    stats2 = _publish(src2, tmp_path / "out")[fs.set_key(ICON)]
    assert (stats2["carried"], stats2["tail_downloaded"], src2.stats["downloaded"]) == (7, 0, 0)


def test_a_tail_of_another_run_than_the_manifest_names_is_refused_as_stale(tmp_path):
    disk, bucket = _stores(tmp_path, bucket_run="2026-10-24T00:00:00Z")
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), log=lambda *_: None)
    stats = _publish(src, tmp_path / "out")[fs.set_key(ICON)]
    assert (stats["built"], stats["stale_local"]) == (4, 3)


def test_only_icon_euro_world_tails_are_ever_downloaded_never_authoritative_products(tmp_path):
    disk, bucket = _stores(tmp_path / "icon", auth_local=False)        # authoritative entries NOT on disk
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), log=lambda *_: None)
    assert src.prefetch(ICON) == 3 and sorted(src._got) == sorted(_name(ICON, v, True) for v in TAILS)
    gdisk, gbucket = _stores(tmp_path / "gfs", target=GFS)
    gsrc = pub.TailDownloads(pub.LocalCache(gdisk), pub.local_product_fetcher(gbucket), log=lambda *_: None)
    assert gsrc.prefetch(GFS) == 0 and gsrc.stats["downloaded"] == 0
    assert pub.TailDownloads.wants({"model": "EURO", "domain": "marine", "layer": "waves", "region_id": "global_mid"})
    assert not pub.TailDownloads.wants({"model": "ICON", "domain": "marine", "layer": "waves", "region_id": "uk_ireland"})


def test_the_download_cap_and_a_failed_download_leave_entries_to_grid(tmp_path):
    disk, bucket = _stores(tmp_path)
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), cap=1, log=lambda *_: None)
    stats = _publish(src, tmp_path / "out")[fs.set_key(ICON)]
    assert (src.stats["downloaded"], src.stats["download_capped"], stats["not_local"]) == (1, 2, 2)

    def broken(_name):
        raise ConnectionError("reset")
    disk2, _b = _stores(tmp_path / "two")
    src2 = pub.TailDownloads(pub.LocalCache(disk2), broken, log=lambda *_: None)
    stats2 = _publish(src2, tmp_path / "out2")[fs.set_key(ICON)]
    assert (src2.stats["download_failed"], stats2["not_local"], stats2["built"]) == (3, 3, 4)


def test_main_wraps_the_source_only_with_the_flag(tmp_path, monkeypatch, capsys):
    disk, bucket = _stores(tmp_path)
    monkeypatch.setenv("FRAME_SETS", fs.set_key(ICON))
    args = ["--store-dir", str(disk), "--out-dir", str(tmp_path / "off"), "--only", "frames", "--tail-store-dir", str(bucket)]
    pub.main(args)
    off = json.loads(capsys.readouterr().out.strip().splitlines()[-1])["frame_sets"]
    assert off[fs.set_key(ICON)]["not_local"] == 3 and "__tail_downloads__" not in off
    monkeypatch.setenv("FRAME_TAIL_DOWNLOAD", "1")
    args[3] = str(tmp_path / "on")
    pub.main(args)
    on = json.loads(capsys.readouterr().out.strip().splitlines()[-1])["frame_sets"]
    assert on[fs.set_key(ICON)]["built"] == 7 and on["__tail_downloads__"]["downloaded"] == 3


# ── the flags are declared where they are flipped ────────────────────────────────────────────────────────────────────────

def _wf(name):
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def test_gfs_world_full_horizon_is_one_repo_variable_in_both_fetch_lanes_default_off():
    pat = re.compile(r"^\s+GFS_WORLD_FULL_HORIZON: \$\{\{ vars\.GFS_WORLD_FULL_HORIZON \|\| '0' \}\}", re.M)
    for lane in ("forecast-ingest.yml", "forecast-ingest-pilots.yml"):
        assert len(pat.findall(_wf(lane))) == 1, lane


def test_the_publish_step_declares_the_tail_download_dark():
    wf = _wf("forecast-ingest-pilots.yml")
    step = wf[wf.index("- name: Publish static forecast frames (dark)"):wf.index("run: python scripts/publish_frame_images.py")]
    assert "FRAME_TAIL_DOWNLOAD: ${{ vars.FRAME_TAIL_DOWNLOAD || '0' }}" in step
    assert "FRAME_TAIL_DOWNLOAD_MAX: ${{ vars.FRAME_TAIL_DOWNLOAD_MAX || '240' }}" in step


def test_the_serve_flags_are_registered_dark():
    import ast
    src = (Path(mmr.__file__).parents[2] / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    reg = next(ast.literal_eval(n.value) for n in ast.walk(ast.parse(src))
               if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in n.targets))
    for flag in ("FAR_EDGE_HOLD_PREFER_MID", "FAR_EDGE_HOLD_BEFORE_UPSTREAM", "GFS_WORLD_FULL_HORIZON"):
        assert reg[flag][0] == "0", flag
    assert os.environ.get("FAR_EDGE_HOLD_PREFER_MID") is None
