"""Evaluation harness v0.1: climatology as a RATCHET, not a wall (eval_ratchet), and the OUT-OF-SAMPLE rule for the
climatology baseline (eval_scoring refuses a leaked one). Synthetic panels; offline."""
import dataclasses
import json
import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import eval_gate as eg
from services.weather_pipeline import eval_ratchet as rt
from services.weather_pipeline import eval_scoring as sc

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
CFG = dataclasses.replace(eg.harness_config(), bootstrap_reps=400)


# ---- out-of-sample climatology -------------------------------------------------------------------------------------
def _obs(days=40):
    return [{"time": T0 + timedelta(hours=h), "hs_m": 1.0 + 0.3 * math.sin(h / 9.0), "tp_s": 12.0, "qc": "good"}
            for h in range(0, days * 24, 3)]


def _rows(first_day=33, n_days=4, leads=(24, 48)):
    rows = []
    for d in range(first_day, first_day + n_days):
        for lead in leads:
            valid = T0 + timedelta(days=d)
            rows.append({"station": "S1", "role": "nearshore", "anchor": True,
                         "valid": valid.strftime("%Y-%m-%dT%H:%MZ"),
                         "cycle": (valid - timedelta(hours=lead)).strftime("%Y-%m-%dT%H:%MZ"), "lead_h": lead,
                         "hs_station_m": 1.1, "outputs": {}, "inputs": {}})
    return rows


ST = {"S1": {"id": "S1", "source": "cdip", "role": "nearshore", "depth_m": 17.0}}


def test_build_items_refuses_to_run_without_an_embargo():
    with pytest.raises(sc.LeakedClimatology):
        sc.build_items("hs_station", _rows(), {"S1": _obs()}, ST)


def test_the_harness_climatology_never_reads_the_scored_window_or_any_issue_hour():
    rows = _rows()
    first, last = T0 + timedelta(days=33), T0 + timedelta(days=36)
    emb = sc.clim_embargo(first, last, 48)
    items, qc = sc.build_items("hs_station", rows, {"S1": _obs()}, ST, clim_embargo=emb)
    c = qc["climatology"]["S1"]
    assert c["out_of_sample"] is True and c["embargo"][1] == "open"
    assert c["last"] < (first - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%MZ")
    assert all(i["clim_oos"] for i in items.values())


def test_a_v0_style_week_holdout_climatology_is_refused_as_leaked():
    """v0 averaged every OTHER ISO week of the truth panel, and the panel included the scored window: the
    climatology for a target in week A read the scored hours of week B. Rebuilt here and refused."""
    obs = _obs()
    first, last = T0 + timedelta(days=26), T0 + timedelta(days=36)        # a window spanning two ISO weeks
    v0_like = {"value": 1.0, "n": len(obs), "embargo": (first - timedelta(hours=72), last), "out_of_sample": True,
               "times": tuple(o["time"] for o in obs)}                    # read the whole panel, window included
    with pytest.raises(sc.LeakedClimatology, match="inside its embargo"):
        sc.check_out_of_sample(v0_like, [first, last])


def test_a_climatology_whose_embargo_misses_a_scored_hour_or_lacks_the_marker_is_refused():
    obs = _obs()
    emb = (T0 + timedelta(days=30), T0 + timedelta(days=32))
    c = sc.climatology(obs, "hs_station", 17.0, emb)
    with pytest.raises(sc.LeakedClimatology, match="outside the climatology embargo"):
        sc.check_out_of_sample(c, [T0 + timedelta(days=35)])
    with pytest.raises(sc.LeakedClimatology, match="not marked"):
        sc.check_out_of_sample(dict(c, out_of_sample=False), [T0 + timedelta(days=31)])
    with pytest.raises(sc.LeakedClimatology):
        sc.climatology(obs, "hs_station", 17.0, (None, None))


def test_other_years_are_admissible_climatology():
    obs = [dict(o, time=o["time"] - timedelta(days=365)) for o in _obs()] + _obs()
    emb = sc.clim_embargo(T0, T0 + timedelta(days=40), 72)
    c = sc.climatology(obs, "hs_station", 17.0, emb)
    assert c["n"] == len(_obs()) and c["last"] < T0
    sc.check_out_of_sample(c, [T0 + timedelta(days=5)])


def test_the_ratchet_refuses_items_without_the_out_of_sample_marker():
    items = [{"t": T0, "lead": 24, "obs": 1.0, "f": 1.0, "climatology": 1.0}]
    with pytest.raises(sc.LeakedClimatology):
        rt.served_state(items, CFG)


# ---- the ratchet ------------------------------------------------------------------------------------------------
def _panel(hours=60, stations=4, leads=(24, 48, 72), srv_err=None, cand_err=None, seed=3):
    """Items with obs, an out-of-sample climatology (error ~0.20 m), served and candidate errors per lead."""
    srv_err = srv_err or {lead: 0.10 for lead in leads}
    cand_err = cand_err or srv_err
    rng = random.Random(seed)
    out = []
    for h in range(hours):
        t = T0 + timedelta(hours=6 * h)
        for s in range(stations):
            obs = 1.2 + 0.4 * math.sin(h / 5.0 + s)
            clim = obs + rng.choice((-1, 1)) * (0.20 + 0.02 * rng.random())
            for lead in leads:
                e = rng.gauss(0, 1)
                out.append({"buoy": f"S{s}", "t": t, "lead": lead, "obs": obs, "climatology": clim, "clim_oos": True,
                            "f": obs + srv_err[lead] * e + 0.01 * rng.gauss(0, 1),
                            "cand": obs + cand_err[lead] * e + 0.01 * rng.gauss(0, 1)})
    return out


def _pairs(items):
    return [dict(i, f_ref=i["f"], f_cand=i["cand"]) for i in items]


W1, W2 = ["2026-10-01T00:00Z", "2026-10-10T18:00Z"], ["2026-11-01T00:00Z", "2026-11-10T18:00Z"]
W1_OVERLAP = ["2026-10-05T00:00Z", "2026-10-14T18:00Z"]


def _locked(srv_err, quantity="hs_station"):
    """A baseline locked the honest way: two eligible runs on non-overlapping windows."""
    b = rt.empty_baseline()
    for seed, w in ((3, W1), (4, W2)):
        b, _ = rt.update_baseline(b, rt.served_state(_panel(srv_err=srv_err, seed=seed), CFG), quantity, True,
                                  {"generated_utc": w[1], "window": w})
    return b


def test_a_lead_locks_only_after_two_eligible_non_overlapping_windows_and_the_lock_only_rises(tmp_path):
    state = rt.served_state(_panel(srv_err={24: 0.05, 48: 0.10, 72: 0.40}), CFG)
    assert state["24"]["beats_climatology"] and state["48"]["beats_climatology"]
    assert not state["72"]["beats_climatology"] and rt.would_lock(state) == [24, 48]
    b0 = rt.empty_baseline()
    none, added = rt.update_baseline(b0, state, "hs_station", eligible=False, evidence={"window": W1})
    assert added == [] and none == b0                            # an ineligible run writes nothing at all
    b1, added = rt.update_baseline(b0, state, "hs_station", True, {"generated_utc": "x", "window": W1})
    assert added == [] and rt.locked_leads(b1, "hs_station") == []          # one window: PENDING only
    assert sorted(b1["pending"]["hs_station"]) == ["24", "48"]
    again, added = rt.update_baseline(b1, state, "hs_station", True, {"generated_utc": "x2", "window": W1_OVERLAP})
    assert added == [] and rt.locked_leads(again, "hs_station") == []       # an overlapping window is not independent
    state2 = rt.served_state(_panel(srv_err={24: 0.05, 48: 0.10, 72: 0.40}, seed=9), CFG)
    b2, added = rt.update_baseline(b1, state2, "hs_station", True, {"generated_utc": "y", "window": W2})
    assert added == [24, 48] and rt.locked_leads(b2, "hs_station") == [24, 48]
    assert [e["window"] for e in b2["locks"]["hs_station"]["24"]["evidence"]] == [W1, W2]
    path = str(tmp_path / "r.json")
    rt.save_baseline(path, b2, b0)
    assert not (tmp_path / "r.json.tmp").exists()                # written atomically through a temp file
    # a later run where served no longer beats climatology anywhere: the locks stay
    worse = rt.served_state(_panel(srv_err={24: 0.40, 48: 0.40, 72: 0.40}), CFG)
    b3, added = rt.update_baseline(rt.load_baseline(path), worse, "hs_station", True,
                                   {"generated_utc": "z", "window": ["2026-12-01T00:00Z", "2026-12-10T00:00Z"]})
    assert added == [] and rt.locked_leads(b3, "hs_station") == [24, 48]
    dropped = json.loads(json.dumps(b3))
    del dropped["locks"]["hs_station"]["48"]
    with pytest.raises(ValueError, match="remove or change the lock"):
        rt.save_baseline(path, dropped, rt.load_baseline(path))


def test_a_window_under_14_days_never_locks_d065():
    # 48 six-hourly targets = 12 UTC days: served beats climatology on the block CI, but the binding two-way CI
    # (block x day, >= 14 days) cannot be computed, so nothing becomes even PENDING.
    state = rt.served_state(_panel(hours=48, srv_err={24: 0.05, 48: 0.10, 72: 0.40}), CFG)
    assert state["24"]["ci"][0] > 0 and state["24"]["two_way"]["computable"] is False
    assert state["24"]["two_way"]["days"] == 12 and not state["24"]["beats_climatology"]
    assert rt.would_lock(state) == []
    b, added = rt.update_baseline(rt.empty_baseline(), state, "hs_station", True, {"generated_utc": "x", "window": W1})
    assert added == [] and b["pending"]["hs_station"] == {}


def test_locking_is_holm_adjusted_across_leads():
    state = {"24": {"lead_class": "short", "beats_climatology": True, "p_better": 0.02},
             "48": {"lead_class": "short", "beats_climatology": True, "p_better": 0.03},
             "72": {"lead_class": "short", "beats_climatology": True, "p_better": 0.04},
             "264": {"lead_class": "long", "beats_climatology": True, "p_better": 0.0001}}
    assert rt.would_lock(state) == []                # Holm: 0.06, 0.06, 0.06 - none survives; long leads never lock
    state["24"]["p_better"] = 0.001
    assert rt.would_lock(state) == [24]


def test_a_locked_lead_makes_not_worse_than_climatology_a_hard_rule():
    base = _locked({24: 0.05, 48: 0.05, 72: 0.05})
    assert rt.locked_leads(base, "hs_station") == [24, 48, 72]
    # a candidate whose mean error at 48 h (~0.24 m) exceeds climatology's (~0.21 m)
    items = _panel(srv_err={24: 0.05, 48: 0.05, 72: 0.05}, cand_err={24: 0.05, 48: 0.30, 72: 0.05})
    rr = rt.candidate_rules(_pairs(items), base, "hs_station", CFG)
    assert any("48 h is LOCKED" in r for r in rr["reasons"])
    assert not any("24 h is LOCKED" in r or "72 h is LOCKED" in r for r in rr["reasons"])
    v = rt.apply({"verdict": "PASS", "reasons": [], "warnings": []}, rr)
    assert v["verdict"] == "FAIL"


def test_a_repair_of_a_served_chain_that_fell_below_a_locked_floor_is_not_blocked():
    base = _locked({24: 0.05, 48: 0.05, 72: 0.05})
    # this window: served regressed below climatology at 48 h; the candidate improves on served, still below the floor
    items = _panel(srv_err={24: 0.05, 48: 0.45, 72: 0.05}, cand_err={24: 0.05, 48: 0.32, 72: 0.05})
    rr = rt.candidate_rules(_pairs(items), base, "hs_station", CFG)
    assert not any("LOCKED" in r for r in rr["reasons"])
    assert any(w.startswith("ALARM: lead 48 h is LOCKED and SERVED is below") for w in rr["warnings"])


def test_never_widen_the_gap_fails_a_candidate_worse_at_one_lead_without_holm_relief():
    items = _panel(srv_err={24: 0.30, 48: 0.30, 72: 0.30}, cand_err={24: 0.20, 48: 0.20, 72: 0.40})
    rr = rt.candidate_rules(_pairs(items), rt.empty_baseline(), "hs_station", CFG)
    assert any(r.startswith("lead 72 h: widens the gap") for r in rr["reasons"])
    assert not any("lead 24" in r or "lead 48" in r for r in rr["reasons"])


def test_an_improving_candidate_that_still_loses_to_climatology_is_not_walled():
    items = _panel(srv_err={24: 0.40, 48: 0.40, 72: 0.40}, cand_err={24: 0.30, 48: 0.30, 72: 0.30})
    state = rt.served_state(items, CFG)
    al = rt.alarms(state, "hs_station")
    assert {a["lead_h"] for a in al} == {24, 48, 72} and all(a["priority"] == "top" for a in al)
    rr = rt.candidate_rules(_pairs(items), rt.empty_baseline(), "hs_station", CFG)
    assert rr["reasons"] == [] and rr["refusals"] == []
    assert rt.apply({"verdict": "PASS", "reasons": [], "warnings": []}, rr)["verdict"] == "PASS"


def test_alarms_are_for_days_0_to_3_only():
    items = _panel(leads=(72, 120), srv_err={72: 0.40, 120: 0.40})
    assert [a["lead_h"] for a in rt.alarms(rt.served_state(items, CFG), "q")] == [72]


def test_days_10_to_14_use_not_significantly_worse_than_climatology_only():
    lead = 264
    # worse than served (would "widen" at a short lead) yet not significantly worse than climatology: no reason
    items = _panel(leads=(lead,), srv_err={lead: 0.10}, cand_err={lead: 0.18})
    base = {"schema": rt.SCHEMA, "locks": {}, "history": []}
    rr = rt.candidate_rules(_pairs(items), base, "hs_station", CFG)
    assert rr["reasons"] == [] and rr["per_lead"][str(lead)]["lead_class"] == "long"
    assert rt.would_lock(rt.served_state(items, CFG)) == []           # no lock is ever set at days 10-14
    bad = _panel(leads=(lead,), srv_err={lead: 0.10}, cand_err={lead: 0.60})
    rr = rt.candidate_rules(_pairs(bad), base, "hs_station", CFG)
    assert any("days 10-14" in r and "significantly worse than climatology" in r for r in rr["reasons"])


def test_a_locked_lead_the_run_does_not_score_refuses_the_candidate():
    base = {"schema": rt.SCHEMA, "locks": {"hs_station": {"120": {"ci": [0.01, 0.02]}}}, "history": []}
    rr = rt.candidate_rules(_pairs(_panel()), base, "hs_station", CFG)
    assert rr["refusals"] and "120" in rr["refusals"][0]
    assert rt.apply({"verdict": "PASS", "reasons": [], "warnings": []}, rr)["verdict"] == "REFUSED"
    assert rt.apply({"verdict": "INVALID", "reasons": ["x"], "warnings": []}, rr)["verdict"] == "INVALID"


def test_the_committed_baseline_file_is_a_valid_ratchet():
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts",
                        "eval_harness_ratchet.json")
    b = rt.load_baseline(path)
    assert b["schema"] == rt.SCHEMA and isinstance(b["locks"], dict)
