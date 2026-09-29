"""The consensus SHADOW at ingest (consensus_ingest, D-009): built from what /point serves, saved as its own model.

The owner chose on 2026-09-29 that the equal GFS/EURO/ICON mean enters as a shadow product (model CONSENSUS) that the
skill ledger grades before any flip, instead of rewriting the GFS tiles. These pin what the shadow must never get
wrong: each member value is the one the POINT RESOLVER serves at that cell (its own product pick, within its own
3 h window); a cell the members cannot all answer is masked, never a GFS value under the consensus name; the build
runs hour-major so a global member file is loaded once per hour for every region; it is registered only when armed;
the ledger grades it only when armed; the boot prefetcher never warms it; and a CONSENSUS point never reaches an
upstream provider.
"""
import asyncio
import inspect
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline import consensus_ingest as ci
from services.weather_pipeline import forecast_skill
from services.weather_pipeline.consensus_product import equal_consensus, member_answer
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct, PipelineManifest)
from services.weather_pipeline.store_helpers import _build_manifest_item, _build_product_filename

T0 = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
RUN = T0 - timedelta(hours=10)
FL = (-81.0, 27.0, -79.0, 29.0)
SC = (-119.0, 32.0, -117.0, 34.0)
WORLD = (-180.0, -80.0, 180.0, 80.0)
_ROOT = Path(__file__).resolve().parents[2]


def _vec(lat, lng, hs, d, tp, valid=True):
    rad = math.radians(d)
    return GridVector(lat=round(lat, 4), lng=round(lng, 4), speed=round(hs, 4), direction=round(d, 2),
                      u=round(-hs * math.sin(rad), 4), v=round(-hs * math.cos(rad), 4), period=round(tp, 2),
                      is_valid=valid)


def _product(model, box, res, field, region_id, coverage_mode, valid_time=T0, run_time=RUN, layer="waves",
             land=lambda lat, lng: False):
    w, s, e, n = box
    cols, rows = int(round((e - w) / res)) + 1, int(round((n - s) / res)) + 1
    vs = [_vec(s + j * res, w + i * res, *field(s + j * res, w + i * res), valid=not land(s + j * res, w + i * res))
          for j in range(rows) for i in range(cols)]
    b = CoverageBounds(west=w, south=s, east=e, north=n)
    return NormalizedProduct(model=model, provider="open-meteo", domain="marine", layer=layer, run_time=run_time,
                             valid_time=valid_time, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=vs), value_kind="height",
                             value_unit="m", display_unit_hint="ft", source_variables=["hs"], freshness_sec=0,
                             region_id=region_id, coverage_mode=coverage_mode)


def _uniform(hs, d, tp):
    return lambda lat, lng: (hs, d, tp)


class FakeStore:
    """The ProductStore surface the shadow build uses, with manifest items built by the production helper."""

    def __init__(self, products):
        self.files, items = {}, []
        for p, res in products:
            fn = _build_product_filename(p)
            p.product_id = fn
            self.files[fn] = p
            items.append(_build_manifest_item(p, fn, res, False))
        self.manifest = PipelineManifest(last_manifest_update=T0, products=items)
        self.loads, self.saved, self.pruned = [], [], []

    def get_manifest(self):
        return self.manifest

    def load_product(self, filename, stride=None):
        self.loads.append(filename)
        p = self.files.get(filename)
        return p.model_copy(deep=True) if p is not None else None

    def save_products_batch(self, batch):
        self.saved.extend(batch)
        return len(batch)

    def prune_superseded_products(self, *args):
        self.pruned.append(args)


def _scene(icon_time=T0, euro_box=FL):
    """GFS + EURO regional tiles for Florida and SoCal, ICON only as a 10-degree global tile."""
    return FakeStore([
        (_product("GFS", FL, 0.25, _uniform(0.8, 90.0, 9.0), "florida_east_coast", "regional_tile"), 0.25),
        (_product("GFS", SC, 0.25, _uniform(1.6, 270.0, 13.0), "us_west_coast_socal", "regional_tile"), 0.25),
        (_product("EURO", euro_box, 0.25, _uniform(1.0, 100.0, 10.0), "florida_east_coast", "regional_tile"), 0.25),
        (_product("EURO", SC, 0.25, _uniform(1.8, 260.0, 14.0), "us_west_coast_socal", "regional_tile"), 0.25),
        (_product("ICON", WORLD, 10.0, _uniform(1.2, 110.0, 11.0), "global_coarse", "global_tile",
                  valid_time=icon_time), 10.0),
    ])


def _build(store):
    frames = ci.primary_frames(store.manifest)
    batches = {}
    for vt, items in ci.frames_by_time(frames).items():
        batch, stats = ci.build_hour(store.manifest, items, store.load_product)
        batches[vt] = (batch, stats)
    return frames, batches


# ── what gets built ──────────────────────────────────────────────────────────────────────────────────

def test_only_the_latest_gfs_regional_waves_run_of_each_region_is_a_primary_frame():
    store = _scene()
    old = _product("GFS", FL, 0.25, _uniform(0.5, 90.0, 9.0), "florida_east_coast", "regional_tile",
                   run_time=RUN - timedelta(hours=6), valid_time=T0 + timedelta(hours=3))
    swell = _product("GFS", FL, 0.25, _uniform(0.5, 90.0, 9.0), "florida_east_coast", "regional_tile", layer="swell_1")
    mid = _product("GFS", WORLD, 10.0, _uniform(0.5, 90.0, 9.0), "global_mid", "global_tile")
    extra = FakeStore([(old, 0.25), (swell, 0.25), (mid, 10.0)])
    store.manifest.products.extend(extra.manifest.products)
    frames = ci.primary_frames(store.manifest)
    assert sorted(frames) == ["florida_east_coast", "us_west_coast_socal"]
    assert [i.run_time for i in frames["florida_east_coast"]] == [RUN]


def test_the_shadow_is_the_equal_mean_of_what_the_point_resolver_serves_each_member_from():
    store = _scene()
    _, batches = _build(store)
    batch, stats = batches[T0]
    assert stats["built"] == 2 and stats["no_blend"] == 0
    by_region = {p.region_id: p for p, _ in batch}
    fl, sc = by_region["florida_east_coast"], by_region["us_west_coast_socal"]
    assert all(v.speed == pytest.approx(1.0) for v in fl.grid.vectors)             # (0.8 + 1.0 + 1.2) / 3
    assert all(v.speed == pytest.approx((1.6 + 1.8 + 1.2) / 3, abs=1e-4) for v in sc.grid.vectors)
    d = fl.grid.diagnostics["consensus"]
    assert set(d["member_sources"]["EURO"]) == {"euro_marine_waves_florida_east_coast_20260929T120000Z.json"}
    assert set(d["member_sources"]["ICON"]) == {"icon_marine_waves_global_coarse_20260929T120000Z.json"}
    assert d["unblended"] == "mask" and d["member_frame_offset_cells"] == {"EURO": 0, "ICON": 0}


def test_at_every_node_the_shadow_answers_what_the_ledger_and_judge_compute_from_served_members():
    """Positive control for ONE composition: the shadow's /point answer at a node equals equal_consensus over the
    three members as the resolver would serve them there (its product pick, then the production sampler)."""
    store = _scene()
    _, batches = _build(store)
    shadow = next(p for p, _ in batches[T0][0] if p.region_id == "florida_east_coast")
    gfs = store.files["gfs_marine_waves_florida_east_coast_20260929T120000Z.json"]
    s, cache = PointSampler(), {}
    choose = {m: ci.make_chooser(store.manifest, m, T0, store.load_product, cache) for m in ("EURO", "ICON")}
    for v in gfs.grid.vectors[::5]:
        members = {"GFS": member_answer(s, gfs, v.lat, v.lng),
                   **{m: member_answer(s, choose[m](v.lat, v.lng), v.lat, v.lng) for m in choose}}
        want = equal_consensus(members)
        got = s.sample_point(shadow, v.lat, v.lng).point
        assert got.speed == pytest.approx(want["hs"], abs=3e-4) and got.direction == pytest.approx(want["dir"], abs=0.05)


def test_the_shadow_carries_its_own_identity_and_provenance():
    store = _scene()
    _, batches = _build(store)
    shadow = batches[T0][0][0][0]
    assert shadow.model == "CONSENSUS" and shadow.provider == "raw-surf" and shadow.product_id is None
    assert shadow.upstream_model == "equal mean of GFS, EURO, ICON" and shadow.source_dataset == "consensus:equal_mean"
    assert shadow.run_time == RUN and shadow.coverage_mode == "regional_tile"
    assert _build_product_filename(shadow).startswith("consensus_marine_waves_")          # never a GFS filename


def test_a_member_frame_within_the_resolvers_window_answers_and_is_counted():
    store = _scene(icon_time=T0 + timedelta(hours=3))                      # the resolver serves up to 3 h away
    _, batches = _build(store)
    fl = next(p for p, _ in batches[T0][0] if p.region_id == "florida_east_coast")
    d = fl.grid.diagnostics["consensus"]
    assert d["cells"]["blended"] == len(fl.grid.vectors) and d["member_frame_offset_cells"]["ICON"] == d["cells"]["blended"]


def test_no_member_within_the_window_means_no_shadow_frame_not_a_gfs_copy():
    store = _scene(icon_time=T0 + timedelta(hours=6))
    _, batches = _build(store)
    batch, stats = batches[T0]
    assert batch == [] and stats["no_blend"] == 2


def test_cells_the_members_cannot_all_answer_are_masked_not_gfs():
    store = _scene(euro_box=(-81.0, 27.0, -80.0, 29.0))                     # EURO covers Florida's west half only
    _, batches = _build(store)
    fl = next(p for p, _ in batches[T0][0] if p.region_id == "florida_east_coast")
    gfs = store.files["gfs_marine_waves_florida_east_coast_20260929T120000Z.json"]
    for before, after in zip(gfs.grid.vectors, fl.grid.vectors):
        if before.lng > -80.0:
            assert after.is_valid is False and not PointSampler()._is_vector_valid(after, "marine", "waves")
        else:
            assert after.is_valid and after.speed == pytest.approx(1.0)
    assert fl.grid.diagnostics["consensus"]["masked"] == sum(v.lng > -80.0 for v in gfs.grid.vectors)


def test_the_build_is_hour_major_so_a_shared_member_file_loads_once_per_hour():
    store = _scene()
    _build(store)
    icon = "icon_marine_waves_global_coarse_20260929T120000Z.json"
    assert store.loads.count(icon) == 1                                    # both regions, one load


# ── the job, the switch and the lanes ────────────────────────────────────────────────────────────────

class _Sched:
    def __init__(self, store):
        self.store = store


def test_the_job_is_inert_unless_armed(monkeypatch):
    monkeypatch.delenv("CONSENSUS_INGEST", raising=False)
    store = _scene()
    assert asyncio.run(ci.ingest_consensus_shadow_impl(_Sched(store))) == 0
    assert store.loads == [] and store.saved == []


def test_the_armed_job_saves_every_region_and_prunes_superseded_consensus_runs(monkeypatch):
    monkeypatch.setenv("CONSENSUS_INGEST", "1")
    store = _scene()
    assert asyncio.run(ci.ingest_consensus_shadow_impl(_Sched(store))) == 2
    assert {p.model for p, _ in store.saved} == {"CONSENSUS"}
    assert sorted(store.pruned) == [("CONSENSUS", "marine", "waves", "florida_east_coast", RUN),
                                    ("CONSENSUS", "marine", "waves", "us_west_coast_socal", RUN)]


def test_the_pilots_lane_registers_the_job_last_in_the_marine_group_and_only_when_armed():
    src = (Path(__file__).resolve().parents[1] / "scheduler" / "forecast.py").read_text(encoding="utf-8")
    euro, shadow, wind = (src.index('("EURO Marine Pilot"'), src.index('("Consensus Marine Shadow"'),
                          src.index('("GFS Wind Pilot"'))
    assert euro < shadow < wind
    assert "if consensus_ingest_enabled() else []" in src[shadow:shadow + 200]


def test_the_ledger_grades_the_shadow_lane_only_when_armed(monkeypatch):
    monkeypatch.delenv("FORECAST_SKILL_COMPARE_MODELS", raising=False)
    monkeypatch.delenv("CONSENSUS_INGEST", raising=False)
    assert forecast_skill.compare_models("GFS") == ["ICON", "EURO"]
    monkeypatch.setenv("CONSENSUS_INGEST", "1")
    assert forecast_skill.compare_models("GFS") == ["ICON", "EURO", "CONSENSUS"]
    assert forecast_skill.source_for("CONSENSUS", "GFS") == "raw_surf:CONSENSUS"
    assert "CONSENSUS" not in forecast_skill.compare_models("CONSENSUS")


def test_the_boot_prefetcher_never_warms_a_shadow_product():
    from services.weather_pipeline import prefetcher
    assert ci.is_shadow("consensus") and ci.is_shadow("CONSENSUS") and not ci.is_shadow("GFS")
    src = inspect.getsource(prefetcher)
    loop = src[src.index("for p in manifest.products:"):src.index("candidates.append(p)")]
    assert "if is_shadow(p.model):" in loop


def test_all_three_lanes_declare_the_switch_at_the_same_value():
    values = {}
    for wf in ("forecast-ingest-pilots.yml", "forecast-ingest.yml", "precompute.yml"):
        d = yaml.safe_load((_ROOT / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["CONSENSUS_INGEST"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "CONSENSUS_INGEST" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    # ARMED by the owner's merge of the arming PR (D-009): all three lanes move together, never one alone.
    assert set(values.values()) == {"1"}, values


def test_a_consensus_point_reads_the_shadow_and_never_calls_an_upstream():
    from services.weather_pipeline.point_resolution import PointResolutionService

    class NoUpstream:
        async def fetch_point(self, *a, **k):
            raise AssertionError("a CONSENSUS point reached the upstream provider")

    store = _scene()
    _, batches = _build(store)
    shadow = next(p for p, _ in batches[T0][0] if p.region_id == "florida_east_coast")
    fn = _build_product_filename(shadow)
    shadow.product_id = fn
    store.files[fn] = shadow
    store.manifest.products.append(_build_manifest_item(shadow, fn, 0.25, False))
    svc = PointResolutionService(store=store, sampler=PointSampler(), provider=NoUpstream())
    hit = asyncio.run(svc.resolve_point("CONSENSUS", "marine", "waves", 28.0, -80.0, T0.isoformat()))
    assert hit.point.speed == pytest.approx(1.0) and hit.product_id == fn
    miss = asyncio.run(svc.resolve_point("CONSENSUS", "marine", "waves", 10.0, -150.0, T0.isoformat()))
    # No shadow covers the open Pacific: an honest 404, with the provider never called (NoUpstream would raise).
    assert miss.status_code == 404 and b'"reason":"no_backend_coverage"' in bytes(miss.body)


def test_a_chooser_that_returns_the_wrong_lane_is_refused_not_blended():
    from services.weather_pipeline.consensus_product import build_equal_mean_from_choosers
    store = _scene()
    gfs = store.files["gfs_marine_waves_florida_east_coast_20260929T120000Z.json"]
    icon = store.files["icon_marine_waves_global_coarse_20260929T120000Z.json"]
    swell = _product("EURO", FL, 0.25, _uniform(1.0, 100.0, 10.0), "florida_east_coast", "regional_tile",
                     layer="swell_1")
    for wrong in (icon, swell):                                   # a mislabelled member, a partition layer
        with pytest.raises(ValueError, match="consensus"):
            build_equal_mean_from_choosers(gfs, {"EURO": lambda la, ln, w=wrong: w, "ICON": lambda la, ln: icon})
    with pytest.raises(ValueError, match="choosers"):
        build_equal_mean_from_choosers(gfs, {"EURO": lambda la, ln: None})


# ── no shadow model reaches an upstream, on ANY domain (2026-09-29, found before arming) ────────────────
# The wind direct-point fallback was the one branch not gated on GFS/ICON/EURO, and the provider maps an unknown model
# to gfs_seamless: the ledger's raw_surf:CONSENSUS lane would have carried REAL GFS wind under the consensus name.

class _CountingUpstream:
    """Records every provider call; raises unless it was given an answer. Carries the real provider's model tables."""
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider as _P
    FORECAST_MODELS, MARINE_MODELS = _P.FORECAST_MODELS, _P.MARINE_MODELS

    def __init__(self, answer=None):
        self.calls, self.answer = [], answer

    async def fetch_point(self, *a, **k):
        self.calls.append(k.get("model") or (a[0] if a else None))
        if self.answer is None:
            raise AssertionError("a shadow model reached the upstream provider")
        return self.answer


def test_a_consensus_wind_point_never_reaches_the_upstream():
    from services.weather_pipeline.point_resolution import PointResolutionService
    up = _CountingUpstream()
    svc = PointResolutionService(store=_scene(), sampler=PointSampler(), provider=up)
    for domain, layer in (("wind", "wind"), ("marine", "waves"), ("weather", "pressure")):
        r = asyncio.run(svc.resolve_point("CONSENSUS", domain, layer, 28.0, -80.0, T0.isoformat()))
        assert getattr(r, "status_code", None) == 404, (domain, r)
    assert up.calls == []


def test_gfs_wind_still_falls_back_to_the_upstream__positive_control():
    from services.weather_pipeline.point_resolution import PointResolutionService
    times = [(T0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(-2, 3)]
    up = _CountingUpstream({"hourly": {"time": times, "wind_speed_10m": [11.0] * 5,
                                       "wind_direction_10m": [270.0] * 5, "wind_gusts_10m": [15.0] * 5}})
    svc = PointResolutionService(store=_scene(), sampler=PointSampler(), provider=up)
    r = asyncio.run(svc.resolve_point("GFS", "wind", "wind", 28.0, -80.0, T0.isoformat()))
    assert up.calls == ["GFS"] and r.point is not None and r.point.speed == pytest.approx(11.0)


def test_the_three_fallbacks_read_one_membership():
    from services.weather_pipeline import point_resolution as pr
    src = inspect.getsource(pr)
    assert pr.UPSTREAM_MODELS == ("GFS", "ICON", "EURO")
    assert src.count("model.upper() in UPSTREAM_MODELS") == 3
    assert 'model.upper() in ("GFS", "ICON", "EURO")' not in src


def test_the_ledgers_consensus_lane_makes_no_upstream_call_and_scores_no_borrowed_wind(monkeypatch):
    """The real consumer, end to end: calibrate_spots for the CONSENSUS lane at a buoy the shadow covers."""
    from services.weather_pipeline import buoy_calibration as bc
    from services.weather_pipeline.point_resolution import PointResolutionService
    store = _scene()
    shadow = next(p for p, _ in _build(store)[1][T0][0] if p.region_id == "florida_east_coast")
    fn = _build_product_filename(shadow)
    shadow.product_id = fn
    store.files[fn] = shadow
    store.manifest.products.append(_build_manifest_item(shadow, fn, 0.25, False))
    up = _CountingUpstream()

    async def coords(client=None):
        return {"41009": (28.5, -80.2)}

    async def latest(bid, client=None):
        return {"time": T0.isoformat(), "wvht_m": 1.1, "dpd_s": 9.0, "wspd_kt": 12.0, "wdir_deg": 250.0}

    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", coords)
    monkeypatch.setattr(bc, "fetch_ndbc_latest", latest)
    svc = PointResolutionService(store=store, sampler=PointSampler(), provider=up)
    spots = [{"id": "s1", "name": "Cocoa", "noaa_buoy_id": "41009", "latitude": 28.3, "longitude": -80.6}]
    asyncio.run(bc.calibrate_spots(svc, spots, "CONSENSUS", T0.isoformat()))
    assert up.calls == []                                      # neither the waves nor the wind resolve went out
