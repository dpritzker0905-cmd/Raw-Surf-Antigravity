"""consensus_flip_sweep (consensus PR C): its two arms differ by the switch alone, and every control REFUSES the
failure it names.

The integration tests run the REAL `precompute_spot_ratings` (frame building, run interning) with a fake resolver that
reads the REAL `consensus_serve.enabled()` / `keep_gfs_regions()`, so the arms' env handling, the observer, the run
expansion and the pairing are exercised end to end; only the rating arithmetic is stubbed. Each refusal has a test that
breaks exactly the thing it guards and reads the refusal back.
"""
import asyncio
import inspect
import logging
import os
import re
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from scripts import consensus_flip_sweep as S
from services.weather_pipeline import consensus_serve
from services.weather_pipeline import spot_ratings_precompute as pc

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SWEEP_WORKFLOW = os.path.join(REPO, ".github", "workflows", "consensus-flip-sweep.yml")
BASE = datetime(2026, 10, 2, 0, tzinfo=timezone.utc)
RUN = "2026-10-01T18:00:00Z"

# lat -> (region served there, coverage); the third spot sits under the global tier, which the flip never swaps
SPOTS = [{"id": "fl", "name": "Sebastian Inlet", "latitude": 27.86, "longitude": -80.45},
         {"id": "hi", "name": "Pipeline", "latitude": 21.66, "longitude": -158.05},
         {"id": "gl", "name": "Somewhere Remote", "latitude": -40.0, "longitude": 100.0},
         {"id": "dp", "name": "Galveston", "latitude": 29.3, "longitude": -94.8}]
# "direct": a coarse-gap spot answered by a LIVE upstream point, whose run can change between calls (run 36967271748)
REGION_AT = {27.86: "florida_east_coast", 21.66: "hawaii", -40.0: None, 29.3: "direct"}
REGIONS = {"gfs_marine_waves_florida_east_coast": "florida_east_coast", "gfs_marine_waves_hawaii": "hawaii",
           "gfs_marine_waves_global_mid": "global_mid"}
ENV_A = {"CONSENSUS_SERVE": "0", "CONSENSUS_SERVE_KEEP_GFS": "", "RATING_LOCAL_SIZE": "0", "RATING_TIDE": "0"}
ENV_B = dict(ENV_A, CONSENSUS_SERVE="1", CONSENSUS_SERVE_KEEP_GFS="hawaii")
KEEP = S.keep_set("hawaii")


@pytest.fixture(autouse=True)
def clean_switch(monkeypatch):
    for k in ("CONSENSUS_SERVE", "CONSENSUS_SERVE_KEEP_GFS"):
        monkeypatch.delenv(k, raising=False)


class FakeResolver:
    """Answers like a ServedStore-backed resolver: a regional GFS frame outside the kept regions is swapped (consensus
    1.3x the offshore height, source_dataset 'consensus:equal_mean') exactly when the real switch is on."""
    calls = 0

    def __init__(self, drift_per_call=0.0, unswapped_noise=False, never_swap=False):
        self.drift, self.noise, self.never_swap = drift_per_call, unswapped_noise, never_swap

    async def resolve_point(self, *, model, domain, layer, lat, lng, valid_time_str):
        FakeResolver.calls += 1
        region = REGION_AT[lat]
        if region == "direct":
            return SimpleNamespace(product_id=None, hs=1.0 + 0.1 * (FakeResolver.calls % 3), source_dataset=None,
                                   run_time=f"2026-10-02T{FakeResolver.calls % 24:02d}:00:00Z",
                                   source="backend_direct_point", coverage_status="coarse_gap_direct_point")
        swapped = (not self.never_swap and consensus_serve.enabled() and region is not None
                   and region not in consensus_serve.keep_gfs_regions())
        hs = 1.0 + self.drift * FakeResolver.calls
        if swapped:
            hs *= 1.3
        elif self.noise and consensus_serve.enabled() and region is None:
            hs *= 1.1                      # something other than the switch moves this spot in arm B
        return SimpleNamespace(product_id=f"gfs_marine_waves_{region or 'global_mid'}", hs=hs, run_time=RUN,
                               source_dataset=S.SWAPPED_DATASET if swapped else "ncep_gfswave", source="regional")


async def fake_rate(resolver, spot, model, valid_time, reference_size_m=None):
    m = await resolver.resolve_point(model=model, domain="marine", layer="waves", lat=spot["latitude"],
                                     lng=spot["longitude"], valid_time_str=valid_time)
    h = round(m.hs * 0.8, 3)
    score = round(40 + 20 * h, 1)
    return {"spot_id": spot["id"], "name": spot["name"], "latitude": spot["latitude"], "longitude": spot["longitude"],
            "score": score, "level": "fair" if score < 60 else "fair_good", "surf_height_m": h,
            "offshore_hs_m": round(m.hs, 3), "run_time": m.run_time, "wind_run_time": None}


def sweep_arms(monkeypatch, env_a=ENV_A, env_b=ENV_B, **resolver_kw):
    FakeResolver.calls = 0
    monkeypatch.setattr(pc, "_make_point_resolver", lambda: FakeResolver(**resolver_kw))
    monkeypatch.setattr(pc, "rate_one_spot", fake_rate)
    return asyncio.run(S.run_arms(SPOTS, [0, 24], env_a, env_b, BASE, REGIONS))


def sweep(monkeypatch, env_a=ENV_A, env_b=ENV_B, **resolver_kw):
    arms = sweep_arms(monkeypatch, env_a, env_b, **resolver_kw)
    rows, counts = S.pair(arms["A"], arms["B"], KEEP)
    return rows, counts, S.null_control(arms["A"], arms["A2"])


# ── the lane: flags come from precompute.yml, and the arms differ by the switch alone ───────────────────────────────
def test_lane_env_reads_the_precompute_lane_and_collects_no_secret():
    env = S.lane_env()
    assert env["CONSENSUS_SERVE"] == "0" and env["RATING_LOCAL_SIZE"] == "1"
    assert not {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "WEATHER_PROXY_URL"} & set(env)
    assert not any("${{" in v for v in env.values())


def test_lane_env_refuses_an_ambiguous_or_switchless_lane(tmp_path):
    twice = tmp_path / "twice.yml"
    twice.write_text("    CONSENSUS_SERVE: '0'\n    RATING_TIDE: '1'\n    RATING_TIDE: '0'\n", encoding="utf-8")
    with pytest.raises(ValueError, match="RATING_TIDE twice"):
        S.lane_env(str(twice))
    switchless = tmp_path / "switchless.yml"
    switchless.write_text("    RATING_TIDE: '1'\n", encoding="utf-8")
    with pytest.raises(ValueError, match="CONSENSUS_SERVE"):
        S.lane_env(str(switchless))


def test_the_arms_differ_by_the_switch_alone():
    lane = S.lane_env()
    a, b = S.arm_envs(lane, "hawaii", 72)
    assert {k for k in set(a) | set(b) if a.get(k) != b.get(k)} == {"CONSENSUS_SERVE", "CONSENSUS_SERVE_KEEP_GFS"}
    assert (a["CONSENSUS_SERVE"], a["CONSENSUS_SERVE_KEEP_GFS"]) == ("0", "")
    assert (b["CONSENSUS_SERVE"], b["CONSENSUS_SERVE_KEEP_GFS"]) == ("1", "hawaii")
    assert int(a["PREFETCH_WINDOW_DAYS"]) >= 4           # +72 h must be warm, or both arms read a fallback
    for k, v in lane.items():
        if k not in ("CONSENSUS_SERVE", "CONSENSUS_SERVE_KEEP_GFS", "PREFETCH_WINDOW_DAYS"):
            assert a[k] == v, f"{k}: the sweep would rate under {a[k]!r} while the lane serves {v!r}"


def test_the_sweep_workflow_declares_no_flag_of_its_own_and_runs_on_its_own_changes():
    with open(SWEEP_WORKFLOW, encoding="utf-8") as fh:
        text = fh.read()
    literals = [m.group(1) for m in map(S.LANE_LITERAL.match, text.splitlines()) if m]
    assert literals == [], f"the sweep workflow sets {literals}: flags belong to precompute.yml, read at run time"
    assert "scripts/consensus_flip_sweep.py" in text and "backend/scripts/consensus_flip_sweep.py" in text
    assert re.search(r"pull_request:\s*\n\s+paths:", text)


# ── end to end through the real precompute, with the real switch ────────────────────────────────────────────────────
def test_a_clean_sweep_swaps_only_unkept_regional_frames_and_refuses_nothing(monkeypatch):
    """A live upstream answer (its run changes per call) is counted apart, never paired, never a null difference."""
    arms = sweep_arms(monkeypatch)
    rows, counts = S.pair(arms["A"], arms["B"], KEEP)
    null = S.null_control(arms["A"], arms["A2"])
    assert counts == {"unpaired": 0, "upstream_direct": 2, "unrated": 0, "run_skew": 0}
    assert len(rows) == 6 and null == {"compared": 3, "differ": 0, "upstream_direct": 1}
    assert S.refusals(rows, null, KEEP) == []
    diag = S.diagnose(arms["A"], arms["B"], arms["A2"])
    assert diag["upstream_direct"] == {"spot_hours": 2, "spots": 1}
    assert (diag["run_skew"]["agg"]["n"], diag["null_diff"]["agg"]["n"], diag["moved_without_swap"]["agg"]["n"]) == \
        (0, 0, 0)
    by_spot = {}
    for r in rows:
        by_spot.setdefault(r["spot_id"], []).append(r)
    assert all(r["swapped"] and r["moved"] and r["region"] == "florida_east_coast" for r in by_spot["fl"])
    assert all(r["kept"] and not r["swapped"] and not r["moved"] for r in by_spot["hi"])
    assert all(r["region"] == "global_mid" and not r["moved"] for r in by_spot["gl"])
    fl = S.stats(by_spot["fl"])
    assert fl["height_ratio"]["p50"] == pytest.approx(1.3, abs=1e-3) and fl["level_up"] == 1.0
    assert os.environ.get("CONSENSUS_SERVE") is None, "an arm's env leaked out of run_arms"


def test_the_null_arm_runs_after_the_candidate_so_it_brackets_it(monkeypatch):
    """...and each arm's log signatures are counted against that arm alone (a 429 met in B is B's)."""
    built = []

    def make():
        built.append((os.environ.get("CONSENSUS_SERVE"), os.environ.get("CONSENSUS_SERVE_KEEP_GFS")))
        if os.environ.get("CONSENSUS_SERVE") == "1":
            logging.getLogger("services.weather_pipeline.store").warning(
                "Dynamic L2 download failed for x.json: {'statusCode': 429, 'error': too_many_connections}")
        return FakeResolver()
    monkeypatch.setattr(pc, "_make_point_resolver", make)
    monkeypatch.setattr(pc, "rate_one_spot", fake_rate)
    arms = asyncio.run(S.run_arms(SPOTS, [0, 24], ENV_A, ENV_B, BASE, REGIONS))
    assert built == [("0", ""), ("1", "hawaii"), ("0", "")]
    met = {name: (m["storage_429"], m["dynamic_l2_failed"]) for name, m in arms["meta"].items()}
    assert met == {"A": (0, 0), "B": (1, 1), "A2": (0, 0)}
    assert not any(isinstance(h, S.SignatureCounter) for h in logging.getLogger().handlers)


def test_a_switch_left_on_in_todays_arm_is_refused(monkeypatch):
    rows, _, null = sweep(monkeypatch, env_a=dict(ENV_A, CONSENSUS_SERVE="1"))
    assert any("arm A answered a swapped frame" in r for r in S.refusals(rows, null, KEEP))


def test_a_kept_region_that_moves_is_refused(monkeypatch):
    rows, _, null = sweep(monkeypatch, env_b=dict(ENV_B, CONSENSUS_SERVE_KEEP_GFS=""))
    assert any(r.startswith("kept region moved: 2 of 2") for r in S.refusals(rows, null, KEEP))


def test_inputs_that_drift_between_arms_fail_the_null_control(monkeypatch):
    """...and the diagnostics say what the differences were made of (same product, the height fields moved)."""
    arms = sweep_arms(monkeypatch, drift_per_call=0.01)
    rows, _ = S.pair(arms["A"], arms["B"], KEEP)
    null = S.null_control(arms["A"], arms["A2"])
    assert null["differ"] > 0
    assert any(r.startswith("null control:") for r in S.refusals(rows, null, KEEP))
    agg = S.diagnose(arms["A"], arms["B"], arms["A2"])["null_diff"]["agg"]
    assert agg["n"] == null["differ"] and agg["same_product"] == agg["n"]
    assert agg["fields"]["offshore_hs_m"] == agg["n"] and "run_time" not in agg["fields"]


def test_a_move_without_a_swap_is_refused(monkeypatch):
    """...and listed with both sides, so the refusal names the spot-hours and the fields that moved."""
    arms = sweep_arms(monkeypatch, unswapped_noise=True)
    rows, _ = S.pair(arms["A"], arms["B"], KEEP)
    null = S.null_control(arms["A"], arms["A2"])
    assert any("moved without a swap" in r for r in S.refusals(rows, null, KEEP))
    leak = S.diagnose(arms["A"], arms["B"], arms["A2"])["moved_without_swap"]
    assert leak["agg"]["n"] == 2 and {e["spot_id"] for e in leak["rows"]} == {"gl"}
    assert leak["rows"][0]["y"]["offshore_hs_m"] == pytest.approx(1.1 * leak["rows"][0]["x"]["offshore_hs_m"], abs=2e-3)


def test_nothing_swapped_fails_the_positive_control(monkeypatch):
    rows, _, null = sweep(monkeypatch, never_swap=True)
    assert any("positive control failed" in r for r in S.refusals(rows, null, KEEP))


def test_a_kept_region_nobody_was_attributed_to_is_refused(monkeypatch):
    rows, _, null = sweep(monkeypatch)
    assert any("'maui' has no attributed spot-hour" in r for r in S.refusals(rows, null, S.keep_set("hawaii,maui")))
    assert S.refusals([], null, KEEP) == ["no paired spot-hour: blind is never a result"]


# ── the pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_pairing_counts_what_it_excludes():
    rec = {"score": 50.0, "surf_height_m": 1.0, "offshore_hs_m": 1.2, "level": "fair", "run_time": RUN,
           "region": "x", "swapped": False}
    a = {("1", "t"): rec, ("2", "t"): dict(rec, score=None), ("3", "t"): rec, ("4", "t"): rec}
    b = {("1", "t"): rec, ("2", "t"): rec, ("3", "t"): dict(rec, run_time="2026-10-01T12:00:00Z")}
    rows, counts = S.pair(a, b, frozenset())
    assert [r["spot_id"] for r in rows] == ["1"]
    assert counts == {"unpaired": 1, "upstream_direct": 0, "unrated": 1, "run_skew": 1}
    skew = S.diagnose(a, b, {})["run_skew"]
    assert [(e["spot_id"], e["fields"]) for e in skew["rows"]] == [("3", ["run_time"])]
    assert skew["rows"][0]["y"]["run_time_rated"] == "2026-10-01T12:00:00Z" and skew["agg"]["n"] == 1


def test_stats_reads_levels_heights_and_scores():
    def row(ah, bh, al, bl):
        return {"a_surf_height_m": ah, "b_surf_height_m": bh, "a_score": 50.0, "b_score": 50.0 + 10 * (bh - ah),
                "a_level": al, "b_level": bl, "swapped": True, "moved": ah != bh}
    s = S.stats([row(1.0, 1.5, "fair", "good"), row(1.0, 0.5, "fair", "poor"), row(0.01, 0.02, "poor", "poor")])
    assert (s["n"], s["level_changed"], s["level_up"], s["level_down"]) == (3, 0.6667, 0.3333, 0.3333)
    assert (s["height_ratio"]["p10"], s["height_ratio"]["p90"]) == (0.5, 1.5)     # the 0.01 m row has no ratio
    assert s["abs_dheight_ft"]["p90"] == pytest.approx(0.5 * S.FT_PER_M, abs=1e-3)
    assert s["dheight_ge_1ft"] == 0.6667


@pytest.mark.parametrize("hs, band", [(0.49, "<0.5 m"), (0.5, "0.5-1 m"), (2.99, "2-3 m"), (3.0, ">=3 m"),
                                      (None, "unknown")])
def test_offshore_bands_have_closed_lower_edges(hs, band):
    assert S.band_of(hs) == band


def test_the_observer_passes_answers_through_untouched():
    answer = SimpleNamespace(product_id="p", source_dataset=S.SWAPPED_DATASET, source="regional")

    class Inner:
        tag = "inner"

        async def resolve_point(self, **kw):
            return answer
    obs = S.ObservedResolver(Inner())
    got = asyncio.run(obs.resolve_point(model="GFS", domain="marine", layer="waves", lat=1.0, lng=2.0,
                                        valid_time_str="t"))
    asyncio.run(obs.resolve_point(model="GFS", domain="wind", layer="wind", lat=1.0, lng=2.0, valid_time_str="t"))
    assert got is answer and obs.tag == "inner"
    assert obs.seen == {S.point_key(1.0, 2.0, "t"): {"product_id": "p", "source_dataset": S.SWAPPED_DATASET,
                                                    "source": "regional", "run_time": None, "coverage_status": None,
                                                    "dynamic": False, "fallback_reason": None}}


def _product(model, run):
    from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
    box = CoverageBounds(west=-81.0, south=26.0, east=-80.0, north=27.0)
    speed = 1.0 if model == "GFS" else 1.3
    grid = NormalizedGrid(bounds=box, cols=2, rows=2, vectors=[
        GridVector(lat=26.0 + (i // 2), lng=-81.0 + (i % 2), speed=speed, direction=90.0, period=10.0, is_valid=True)
        for i in range(4)])
    return NormalizedProduct(
        model=model, provider="noaa", domain="marine", layer="waves", run_time=run, valid_time=run,
        is_forecast_authoritative=True, is_estimated=False, coverage=box, grid=grid, value_kind="height",
        value_unit="m", display_unit_hint="ft", source_variables=["swh"], freshness_sec=0,
        product_id=f"{model.lower()}_marine_waves_florida_east_coast",
        **({"source_dataset": "consensus:equal_mean", "upstream_model": "equal mean of GFS, EURO, ICON"}
           if model == "CONSENSUS" else {}))


def test_the_swap_tag_is_what_production_stamps_and_reaches_the_point_answer():
    """The observer's only evidence of a swap travels producer -> merge() -> the sampler -> the point answer."""
    from services.weather_pipeline.consensus_ingest import PROVENANCE
    from services.weather_pipeline.sampler import PointSampler
    assert S.SWAPPED_DATASET == PROVENANCE["source_dataset"]
    run = datetime(2026, 10, 2, 0, tzinfo=timezone.utc)
    gfs = _product("GFS", run)
    served = consensus_serve.merge(gfs, _product("CONSENSUS", run))
    swapped = PointSampler().sample_point(served, 26.5, -80.5)
    raw = PointSampler().sample_point(gfs, 26.5, -80.5)
    assert swapped.source_dataset == S.SWAPPED_DATASET and swapped.product_id == gfs.product_id
    assert raw.source_dataset != S.SWAPPED_DATASET


def test_regions_come_from_the_manifest_and_only_regional_tiles_are_named():
    from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
    box = CoverageBounds(west=-1.0, south=-1.0, east=1.0, north=1.0)
    run = datetime(2026, 10, 2, 0, tzinfo=timezone.utc)

    def item(fn, mode, region, pid=None):
        return ManifestProduct(model="GFS", provider="noaa", domain="marine", layer="waves", run_time=run,
                               valid_time_start=run, valid_time_end=run, resolution=0.25, freshness_sec=0,
                               is_forecast_authoritative=True, coverage=box, filename=fn, region_id=region,
                               coverage_mode=mode, product_id=pid)
    regions = S.manifest_regions(PipelineManifest(last_manifest_update=run, products=[
        item("gfs_hi_00.json", "regional_tile", "hawaii", pid="gfs_hi"),
        item("gfs_mid_00.json", "global_mid", "world")]))
    assert regions["gfs_hi"] == regions["gfs_hi_00.json"] == regions["gfs_hi_00"] == "hawaii"
    assert regions["gfs_mid_00"] == "global_mid"       # a region_id on a non-tile is not a tile


def test_the_sweep_cannot_write():
    class Store:
        def _upload_to_supabase(self, filename, data):
            return "wrote"

        def _delete_from_supabase(self, filename):
            return "deleted"
    attempts = S.forbid_writes(Store)
    for call in (lambda: Store()._upload_to_supabase("manifest.json", b"{}"),
                 lambda: Store()._delete_from_supabase("x")):
        with pytest.raises(PermissionError, match="read-only"):
            call()
    assert attempts["n"] == 2
    src = inspect.getsource(S.main)
    assert src.index("forbid_writes(ProductStore)") < src.index("restore_from_supabase")
    module_src = inspect.getsource(S)
    assert "upload_spot_ratings_l2" not in module_src and "run_spot_ratings_precompute" not in module_src
