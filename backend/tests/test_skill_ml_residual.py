"""The ML residual shadow (pre-registered 2026-11-16): pairing, folds, the baseline, the verdict and the output.

The cross-validation tests need scikit-learn, which is not a backend dependency: they skip without it (the dispatch-only
workflow pins it). Everything else runs everywhere."""
import random
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import skill_ml_residual as M

BUOYS = ["41%03d" % i for i in range(8)] + ["46%03d" % i for i in range(8)] + ["42%03d" % i for i in range(6)]


def _rows(learnable=True, seed=3, buoys=BUOYS, start=datetime(2026, 8, 1, tzinfo=timezone.utc), days=105):
    """Served is biased high by 0.45 m when its period is >= 14 s (a nonlinear residual a tree can learn and a regional
    mean cannot); EURO and ICON are the observation plus noise."""
    rng = random.Random(seed)
    rows = []
    for d in range(days):
        for h in (0, 12):
            t = start + timedelta(days=d, hours=h)
            ts = t.strftime("%Y-%m-%dT%H:00Z")
            for b in buoys:
                obs = max(0.2, rng.gauss(1.6, 0.6))
                for lead in M.LEADS:
                    tp = rng.uniform(6, 18)
                    served = obs + (0.45 if (learnable and tp >= 14) else 0.0) + rng.gauss(0, 0.15)
                    common = {"buoy_id": b, "target_time": ts, "lead_h": float(lead), "obs_time": ts, "obs_hs_m": obs}
                    rows.append({**common, "source": M.SERVED, "hs_m": max(0.05, served), "tp_s": tp,
                                 "dir_deg": rng.uniform(0, 360), "wind_kt": rng.uniform(0, 25),
                                 "wind_from_deg": rng.uniform(0, 360)})
                    rows.append({**common, "source": M.EURO, "hs_m": max(0.05, obs + rng.gauss(0, 0.2))})
                    rows.append({**common, "source": M.ICON, "hs_m": max(0.05, obs + rng.gauss(0, 0.25))})
    return rows


def test_pairs_need_all_three_members_on_the_same_observation_and_drop_the_hole_buoys():
    rows = _rows(days=3)
    rows += [dict(r, buoy_id="46267") for r in rows[:30]]                      # a hole buoy: dropped
    rows = [dict(r, obs_hs_m=9.9) if (r["source"] == M.ICON and r["buoy_id"] == BUOYS[0]) else r for r in rows]
    pairs = M.build_pairs(rows)
    assert pairs and not {p["buoy"] for p in pairs} & {"46267", BUOYS[0]}
    assert all(len(p["x"]) == len(M.FEATURES) for p in pairs)


def test_folds_are_deterministic_and_blocks_are_weekly():
    assert M.buoy_group("46025") == M.buoy_group("46025") and 0 <= M.buoy_group("46025") < M.GROUPS
    assert M.block_of(datetime(2026, 8, 7, 23, tzinfo=timezone.utc)) == 0
    assert M.block_of(datetime(2026, 8, 8, tzinfo=timezone.utc)) == 1


def test_the_baseline_removes_a_steady_regional_bias():
    rows = _rows(learnable=False, days=40)
    for r in rows:                                    # every member reads 0.3 m high, always
        r["hs_m"] = r["hs_m"] + 0.3
    pairs = M.build_pairs(rows)
    base = M.ocf_rolling(pairs)
    late = [p for p in pairs if p["t"] > datetime(2026, 8, 25, tzinfo=timezone.utc)]
    raw = sum(abs(p["fc"][M.SERVED] - p["obs"]) for p in late) / len(late)
    corrected = sum(abs(base[id(p)] - p["obs"]) for p in late) / len(late)
    assert corrected < raw - 0.15


def test_block_interval_needs_three_blocks_and_brackets_the_mean():
    assert M.block_interval([0.1, 0.2], ["2026-11-01", "2026-11-02"], 3) is None
    lo, hi = M.block_interval([0.1] * 30, ["2026-11-%02d" % (1 + i % 15) for i in range(30)], 1)
    assert lo == pytest.approx(0.1) and hi == pytest.approx(0.1)


def test_verdict_voids_on_a_failed_control_and_fails_without_a_gain():
    good = {"pooled": {lead: {"n": 5000, "i3": (-0.05, -0.01)} for lead in M.LEADS}, "regions": {}}
    flat = {"pooled": {lead: {"n": 5000, "i3": (-0.01, 0.01)} for lead in M.LEADS}, "regions": {}}
    ok_shift = {"planted": 0.25, "other": 0.01}
    assert M.verdict(good, flat, ok_shift, True)[0] == "PASS"
    assert M.verdict(good, good, ok_shift, True)[0] == "VOID"              # the null meets G1
    assert M.verdict(good, flat, {"planted": 0.05, "other": 0.0}, True)[0] == "VOID"
    assert M.verdict(flat, flat, ok_shift, True)[0] == "FAIL"
    worse = dict(good, regions={("hawaii", 48): {"n": 300, "days": 10, "i3": (0.01, 0.05)}})
    assert M.verdict(worse, flat, ok_shift, True)[0] == "FAIL"


def test_a_learnable_residual_passes_and_the_output_is_aggregates_only(monkeypatch):
    pytest.importorskip("sklearn")
    monkeypatch.setitem(M.HGB, "max_iter", 80)
    from scripts import ml_residual_shadow as S
    out, call = S.run(_rows(learnable=True))
    text = "\n".join(out)
    assert call == "PASS", text
    assert not any(b in text for b in BUOYS) and "obs_hs_m" not in text and "T00Z" not in text


def test_no_learnable_residual_does_not_pass(monkeypatch):
    pytest.importorskip("sklearn")
    monkeypatch.setitem(M.HGB, "max_iter", 80)
    from scripts import ml_residual_shadow as S
    _out, call = S.run(_rows(learnable=False))
    assert call in ("FAIL", "VOID")
