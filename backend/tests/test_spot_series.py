"""Spot-hub phase 3 (dark): the per-spot chart series rated in CI (`spot_series.py`, `scripts/spot_series_ci.py`,
`.github/workflows/spot-series.yml`). Pins: ONE frame plan and ONE composition with the hub, the glyph precompute's
own gate, the shard format, the served env mirrored from precompute.yml, and that nothing publishes while dark."""
import asyncio
import gzip
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import pytest
import yaml

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

from services.weather_pipeline import rating_confirmation as RC  # noqa: E402
from services.weather_pipeline import spot_hub_composition as HUB  # noqa: E402
from services.weather_pipeline import spot_ratings as SPR  # noqa: E402
from services.weather_pipeline import spot_series as SS  # noqa: E402
import spot_series_ci as CLI  # noqa: E402

BASE = datetime(2026, 11, 3, 18, 0, tzinfo=timezone.utc)
SPOTS = [{"id": f"s{i}", "name": None, "latitude": 30.0 + i, "longitude": -120.0 + 40 * i, "accuracy_flag": None,
          "is_verified_peak": False, "best_tide": None} for i in range(3)]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("RATING_OBS_GATE", "RATING_TIDE", "RATING_LOCAL_SIZE", "RATING_BREAKER_TYPE", "SURF_PARTITIONS",
              "SPOT_SERIES_PUBLISH"):
        monkeypatch.delenv(k, raising=False)
    HUB.clear_caches()
    yield
    HUB.clear_caches()


class Det(CLI._SyntheticResolver):
    """The synthetic sea, but a pure function of (domain, hour, place): two paths asking one frame get one answer."""

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        import zlib
        self.rng.seed(zlib.crc32(f"{model}|{domain}|{valid_time_str}|{lat:.3f}|{lng:.3f}".encode()))
        return await super().resolve_point(model, domain, layer, lat, lng, valid_time_str)


def _resolver():
    return Det(seed=3)


def _gate(score, *a):
    from services.weather_pipeline.surf_rating import score_to_level
    return (None, None, None, None) if score is None else (score, score_to_level(score), None, score)


def _rate(models=("GFS",), spots=SPOTS):
    async def go():
        return {m: await SS.rate_spot_series(_resolver(), spots, m, BASE, SS.horizon_for(m)) for m in models}
    return asyncio.run(go())


# ── one plan, one composition ─────────────────────────────────────────────────────────────────────────────

def test_the_series_uses_the_hubs_frame_plan_plus_now():
    t = SS.spot_times(-117.6, BASE, 336)
    assert t[0] == HUB.current_valid_time(BASE)
    assert t[1:] == HUB.frame_plan(-117.6, BASE, 336)
    assert 50 <= len(t) <= 60


def test_every_row_is_rate_one_spot_at_its_hour():
    by = _rate()
    rec = by["GFS"]["s0"]
    assert rec["off"] == HUB.solar_utc_offset_hours(SPOTS[0]["longitude"])
    for row in rec["rows"]:
        ref = asyncio.run(SPR.rate_one_spot(_resolver(), dict(SPOTS[0]), "GFS", row["valid_time"]))
        assert (row["surf_height_m"], row["raw_score"], row["level"]) == (ref["surf_height_m"], ref["score"],
                                                                           ref["level"])
    assert all(r["raw_score"] == r["score"] for r in rec["rows"]), "rows leave the rate job UNGATED"


def test_the_hub_and_the_series_rate_the_same_frame_identically(monkeypatch):
    """The same resolver, spot and hour through the hub's path and the series' path: one answer."""
    monkeypatch.setattr(RC, "gate_single_model_surface", _gate)
    res = _resolver()
    rows = asyncio.run(SS.rate_spot_series(res, SPOTS[:1], "GFS", BASE, 72))["s0"]["rows"]
    hub = asyncio.run(HUB.resolve_hub_conditions(res, "GFS", SPOTS[0]["latitude"], SPOTS[0]["longitude"], 3,
                                                 spot_id="s0", spot_meta=SPOTS[0], horizon_hours=72, now=BASE,
                                                 load_l2=lambda: None))
    assert hub["current_conditions"]["surf_height_m"] == rows[0]["surf_height_m"]
    assert hub["current_conditions"]["rating_raw"] == rows[0]["raw_score"]
    off = HUB.solar_utc_offset_hours(SPOTS[0]["longitude"])
    for day in hub["forecast"]:
        if day["status"] == "available":
            same_day = [r["surf_height_m"] for r in rows[1:]
                        if HUB.local_date(SS._parse(r["valid_time"]), off).isoformat() == day["date"]]
            assert day["surf_height_max_m"] == max(same_day)


# ── the gate and the band ─────────────────────────────────────────────────────────────────────────────────

def test_gate_off_levels_follow_the_ungated_score(monkeypatch):
    monkeypatch.setenv("RATING_OBS_GATE", "0")              # guarded, default ON (D-065): '0' is its kill
    by = _rate()
    assert SS.gate_models(by) == 0
    from services.weather_pipeline.surf_rating import score_to_level
    for r in by["GFS"]["s1"]["rows"]:
        assert r["level"] == score_to_level(r["raw_score"])


def test_gate_on_is_the_glyph_precomputes_gate(monkeypatch):
    monkeypatch.setenv("RATING_OBS_GATE", "1")
    by = _rate(("GFS", "EURO", "ICON"))
    raw = {(m, sid, r["valid_time"]): r["raw_score"] for m, v in by.items() for sid, rec in v.items()
           for r in rec["rows"]}
    SS.gate_models(by)
    frames = {}
    for (m, sid, vt), s in raw.items():
        frames.setdefault((m, vt), {"model": m, "valid_time": vt, "spots": []})["spots"].append(
            {"spot_id": sid, "score": s})
    flat = list(frames.values())
    RC.apply_gate_to_frames(flat, {})
    want = {(f["model"], s["spot_id"], f["valid_time"]): (s["score"], s["level"]) for f in flat for s in f["spots"]}
    got = {(m, sid, r["valid_time"]): (r["score"], r["level"]) for m, v in by.items() for sid, rec in v.items()
           for r in rec["rows"]}
    assert got == want
    assert any(r["score"] != r["raw_score"] for v in by.values() for rec in v.values() for r in rec["rows"]), (
        "SETUP: the gate must cap something here or this asserts nothing")


def test_the_band_is_the_min_and_max_level_across_models():
    by = {"GFS": {"a": {"off": 0, "rows": [{"valid_time": "2026-11-03T18:00:00Z", "level": "fair"}]}},
          "EURO": {"a": {"off": 0, "rows": [{"valid_time": "2026-11-03T18:00:00Z", "level": "good"}]}},
          "ICON": {"a": {"off": 0, "rows": [{"valid_time": "2026-11-03T18:00:00Z", "level": "unknown"}]}}}
    assert SS.bands(by) == {("a", "2026-11-03T18:00:00Z"): (SS.LEVELS.index("fair"), SS.LEVELS.index("good"))}


# ── the object ────────────────────────────────────────────────────────────────────────────────────────────

def test_shards_are_stable_and_partition_the_catalogue():
    assert SS.shard_of("abc") == SS.shard_of("abc") and 0 <= SS.shard_of("abc") < 64
    jobs = [SS.job_shards(j, 4) for j in range(4)]
    assert sorted(s for j in jobs for s in j) == list(range(64)) and all(len(j) == 16 for j in jobs)
    assert SS.shard_key("gfs", 7) == "spot_series/v1/GFS/07.json.gz"


def test_the_shard_is_columnar_gzipped_and_deterministic():
    by = _rate(("GFS", "EURO"))
    SS.gate_models(by)
    a = SS.build_shards(by, BASE, generated_at=BASE)
    b = SS.build_shards(by, BASE, generated_at=BASE)
    assert a == b, "gzip mtime=0 and sorted keys: the same rows give the same bytes"
    sid = "s2"
    body = json.loads(gzip.decompress(a[SS.shard_key("GFS", SS.shard_of(sid))]))
    col = body["spots"][sid]
    n = len(by["GFS"][sid]["rows"])
    assert all(len(col[c]) == n for c in SS.COLS)
    first = by["GFS"][sid]["rows"][0]
    assert col["t"][0] == 0 and col["h"][0] == round(first["surf_height_m"] * 100)
    assert col["s"][0] == round(first["score"] * 10) and SS.LEVELS[col["l"][0]] == first["level"]
    assert col["lo"][0] <= col["l"][0] <= col["hi"][0]
    index = json.loads(a["spot_series/v1/index.json"])
    assert index["models"] == ["EURO", "GFS"] and "14 days" in index["tier"]
    assert index["shards"]["GFS"][f"{SS.shard_of(sid):02d}"]["bytes_gz"] == len(a[SS.shard_key("GFS", SS.shard_of(sid))])


def test_the_synthetic_dry_run_runs_offline(capsys):
    assert CLI.main(["synthetic", "--spots", "4", "--models", "GFS", "--base-time", "2026-11-03T18:00:00Z"]) == 0
    out = capsys.readouterr().out
    summary = json.loads(out[out.index("{"):])
    assert 4 * 50 <= summary["frames"]["GFS"] <= 4 * 60, "~58 frames a spot"
    assert summary["shards"] >= 1 and summary["bytes_gz_total"] > 0


def test_publish_refuses_under_the_kill_switch(tmp_path, monkeypatch):
    monkeypatch.setenv("SPOT_SERIES_PUBLISH", "0")
    assert CLI.main(["publish", "--dir", str(tmp_path)]) == 1


# ── the workflow: the served env, and dark twice ──────────────────────────────────────────────────────────

def _wf(name):
    with open(os.path.join(REPO, ".github", "workflows", name), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


_SERVED = re.compile(r"^(RATING_|SURF_|SHORE_NORMAL_|SAMPLER_SCALAR_HEIGHT|CONSENSUS_SERVE|COPERNICUS_PEAK|"
                     r"COPERNICUS_TERMINAL|ICON_PEAK|RENDER$|NODE_ENV$|POINT_BATCH|POINT_CACHE)")


def test_the_series_runs_in_the_glyphs_served_env():
    """Derived, not listed: every served flag precompute.yml rates with must be set to the SAME value here, so a
    flip in the glyph lane that forgets this one fails CI instead of splitting the chart from the glyph."""
    pre = [s for s in _wf("precompute.yml")["jobs"]["precompute"]["steps"]
           if str(s.get("name", "")).startswith("Restore from L2")][0]["env"]
    ser = [s for s in _wf("spot-series.yml")["jobs"]["rate"]["steps"] if "env" in s][0]["env"]
    served = {k: v for k, v in pre.items() if _SERVED.match(k)}
    assert len(served) >= 20, "SETUP: the derivation stopped seeing precompute's served flags"
    drift = {k: (v, ser.get(k)) for k, v in served.items() if str(ser.get(k)) != str(v)}
    assert not drift, f"spot-series.yml disagrees with precompute.yml: {drift}"


def test_on_by_default_and_one_kill_switch_stops_runs_and_publish():
    wf = _wf("spot-series.yml")
    on = wf.get("on", wf.get(True))
    assert set(on) == {"workflow_dispatch", "workflow_run"}, "no schedule: automatic runs follow the precompute"
    assert "vars.SPOT_SERIES_PUBLISH != '0'" in wf["jobs"]["plan"]["if"], "the kill switch must stop automatic runs"
    pub = [s for s in wf["jobs"]["assemble"]["steps"] if "publish" in str(s.get("run", ""))]
    assert len(pub) == 1 and "vars.SPOT_SERIES_PUBLISH != '0'" in pub[0]["if"]
    assert pub[0]["env"]["SPOT_SERIES_PUBLISH"] == "${{ vars.SPOT_SERIES_PUBLISH || '1' }}", "unset = ON"
    assert "inputs.limit == '0'" in pub[0]["if"], "a partial (dry-run) series must never publish"
    assert all("publish" not in str(s.get("run", "")) for s in wf["jobs"]["rate"]["steps"])
    assert wf["jobs"]["rate"]["strategy"]["matrix"] == {"model": ["GFS", "EURO", "ICON"], "job": [0, 1, 2, 3]}


def test_hub_parity_counts_agreement_on_a_glyph_frame():
    vt = HUB.valid_time_str(HUB.current_valid_time(BASE))
    sp = SPOTS[0]
    item = {"spot_id": "s0", "latitude": sp["latitude"], "longitude": sp["longitude"], "score": 40.0,
            "level": "poor_fair", "surf_height_m": 1.1}
    l2 = {"frames": [{"model": "GFS", "valid_time": vt, "spots": [item]}]}
    rows = _rate()["GFS"]
    import pytest as _pt
    mp = _pt.MonkeyPatch()
    mp.setattr(RC, "gate_single_model_surface", _gate)
    try:
        out = asyncio.run(CLI.hub_parity(_resolver(), [sp], "GFS", BASE, rows, l2))
    finally:
        mp.undo()
    assert out["glyph_compared"] == 1 and out["glyph_equal"] == 1
    assert out["days_compared"] >= 1 and out["days_equal"] == out["days_compared"]


def test_the_horizon_is_the_capability_horizon():
    assert SS.horizon_for("GFS") <= 336 and SS.frames_per_spot(-117.6, BASE, "GFS") == len(
        SS.spot_times(-117.6, BASE, SS.horizon_for("GFS")))
    assert (BASE + timedelta(hours=SS.horizon_for("GFS"))) >= max(SS.spot_times(-117.6, BASE, SS.horizon_for("GFS")))


@__import__("pytest").fixture(autouse=True)
def _legacy_reference_curve(monkeypatch):
    """These pins describe the reference-LESS legacy size curve. JAC-2's catalogue prior
    (RATING_REF_PRIOR, default ON) replaces it; that path is pinned in test_reference_prior.py."""
    monkeypatch.setenv("RATING_REF_PRIOR", "0")
