"""The nearshore outcome loop's core contracts (WS-CAN-0076) — refusal-first, composition-pinned.

WHY THIS LANE EXISTS: 60,000 archived predictions of the served nearshore quantity and ZERO
matched observations (Master Codex MC-03's deep half; reproduced live). CDIP nearshore buoys
(≤30 m, median ~20 m) sit INSIDE the transform chain — the census found 20 stations within
10 km of 48 catalogue spot links (committed artifact: data/nearshore_validation_pairs.json).

THE CONTRACTS PINNED HERE:
  1. THE MODEL SIDE SHARES THE SERVED COMPOSITION'S OWN COMPONENTS — the parity test drives
     `estimate_surf` into the composable configuration (linear shoaling, conversion off, cap
     unreachable, same depth everywhere) and the instrument's `model_hs_at_station` must equal it
     EXACTLY. Calling different code that "should" agree is the +19.1% sim defect; this pin makes
     the components provably one.
  2. REFUSAL FIRST: a stale pair table refuses; an empty match set refuses with a reason and its
     counters readable (the WS-CAN-0073 pattern, applied from birth rather than retrofitted).
  3. QC: only `waveFlagPrimary == 1` observations count (the Kr study's discipline).
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import nearshore_validation as NV   # noqa: E402


NOW = datetime.now(timezone.utc)


# ── the pair table: provenance-stamped, staleness-refusing ──────────────────────────────────────

def test_the_committed_pair_table_loads_and_is_fresh():
    pairs = NV.load_pairs()
    assert pairs["n_stations"] >= 10 and pairs["n_spot_links"] >= 30, (
        "the committed pair table shrank far below the census (20 stations / 48 links)")
    assert all(p["station_depth_m"] <= 30.0 for p in pairs["pairs"])


def test_a_stale_pair_table_REFUSES(tmp_path):
    old = {"version": 1, "generated_at": (NOW - timedelta(days=120)).isoformat(),
           "n_stations": 20, "n_spot_links": 48, "pairs": []}
    p = tmp_path / "pairs.json"
    p.write_text(json.dumps(old), encoding="utf-8")
    with pytest.raises(NV.Refusal) as ei:
        NV.load_pairs(path=str(p))
    assert "stale" in str(ei.value).lower(), "the refusal must say WHY"


# ── the model side: provably the served composition's own components ────────────────────────────

def test_model_hs_matches_estimate_surf_in_the_composable_configuration(monkeypatch):
    """THE COMPOSITION PIN. With linear shoaling (SURF_V3_KOMAR=0), conversion off
    (SURF_HEIGHT_H110=0), the cap unreachable, magnets off, and ONE depth playing every role,
    `estimate_surf` computes exactly Kf x Ks x exposure x Kr x Hs — which is the instrument's
    model. If either side ever changes components, this reddens naming the divergence."""
    from services.weather_pipeline.surf_transform import estimate_surf
    monkeypatch.setenv("SURF_V3_KOMAR", "0")
    monkeypatch.setenv("SURF_HEIGHT_H110", "0")
    monkeypatch.setenv("SURF_V3_MAGNETS", "0")
    monkeypatch.setenv("SURF_CAP_SEAM_MONOTONE", "0")
    for hs, tp, swell, normal, depth, width in [
            (1.0, 12.0, 245.0, 270.0, 20.0, 40.0),
            (2.5, 15.5, 200.0, 180.0, 15.0, 12.0),
            (0.6, 9.0, 300.0, 270.0, 28.0, 90.0)]:
        served, regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width,
                                       swell_from_deg=swell, shore_normal_deg=normal,
                                       break_depth_m=10_000.0)   # cap unreachable
        model = NV.model_hs_at_station(hs, tp, swell, normal,
                                       station_depth_m=depth, shelf_depth_m=depth,
                                       shelf_width_km=width)
        assert regime in ("shelf", "shoaling")
        assert model == pytest.approx(served, rel=1e-12), (
            f"instrument model diverged from the served composition at {hs=} {tp=}")


def test_model_hs_shoals_to_the_INSTRUMENT_depth_not_the_shelf():
    """The one deliberate difference from the serving path: friction uses the SHELF median (its
    correct scale), shoaling uses the STATION depth (where the instrument actually floats)."""
    a = NV.model_hs_at_station(1.0, 14.0, 245.0, 245.0,
                               station_depth_m=12.0, shelf_depth_m=45.0, shelf_width_km=30.0)
    b = NV.model_hs_at_station(1.0, 14.0, 245.0, 245.0,
                               station_depth_m=45.0, shelf_depth_m=45.0, shelf_width_km=30.0)
    assert a != pytest.approx(b), "station depth changed nothing — it is shoaling to the shelf"


# ── QC + matching + the report's refusal semantics ──────────────────────────────────────────────

def _obs(t, hs, flag=1):
    return {"time": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": hs, "flag": flag}


def test_only_qc_good_observations_survive():
    t = NOW.replace(minute=0, second=0, microsecond=0)
    rows = [_obs(t, 1.2, flag=1), _obs(t, 9.9, flag=4), _obs(t, 8.8, flag=2)]
    kept = NV.qc_filter(rows)
    assert [r["hs_m"] for r in kept] == [1.2], "a non-primary QC flag leaked into the sample"


def test_matching_pairs_by_hour_within_tolerance():
    t = NOW.replace(minute=0, second=0, microsecond=0)
    preds = [{"valid_time": t.strftime("%Y-%m-%dT%H:00:00Z"), "model_hs_m": 1.0}]
    obs = [_obs(t + timedelta(minutes=20), 1.1), _obs(t + timedelta(hours=5), 3.0)]
    matched = NV.match(preds, obs, tolerance_s=1800)
    assert len(matched) == 1 and matched[0]["obs_hs_m"] == 1.1


def test_an_empty_report_REFUSES_with_reasons_and_counters():
    rep = NV.build_report(matched=[], n_stations=20, n_obs=0, n_preds=64)
    assert rep["available"] is False
    assert "n_matched=0" in rep["reason"]
    assert rep["n_stations"] == 20 and rep["n_preds"] == 64, (
        "refusing must not hide the evidence counters — the refusal explains itself")


def test_a_populated_report_carries_per_station_errors():
    t = NOW.replace(minute=0, second=0, microsecond=0)
    matched = [{"station": "101p1", "spot_id": "s1", "valid_time": t.isoformat(),
                "model_hs_m": 1.0, "obs_hs_m": 1.2},
               {"station": "101p1", "spot_id": "s1", "valid_time": t.isoformat(),
                "model_hs_m": 2.0, "obs_hs_m": 1.6}]
    rep = NV.build_report(matched=matched, n_stations=1, n_obs=2, n_preds=2)
    assert rep["available"] is True
    st = rep["stations"]["101p1"]
    assert st["n"] == 2
    assert st["mae_m"] == pytest.approx((0.2 + 0.4) / 2)
    assert st["bias_m"] == pytest.approx((-0.2 + 0.4) / 2), "bias sign: model minus observed"
