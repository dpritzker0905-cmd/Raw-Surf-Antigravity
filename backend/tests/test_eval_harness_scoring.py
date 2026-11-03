"""Evaluation harness v0: the scoring math, the baselines, the controls and the gate rules. PURE, offline."""
import dataclasses
import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import eval_gate as eg
from services.weather_pipeline import eval_scoring as sc

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)


# ---- the frozen proxy operator -------------------------------------------------------------------------------------
@pytest.mark.parametrize("t,h", [(6.0, 3.0), (10.0, 10.0), (16.0, 17.0), (12.0, 200.0)])
def test_wavenumber_satisfies_linear_dispersion(t, h):
    k = sc.wavenumber(t, h)
    w = 2 * math.pi / t
    assert abs(w * w - sc.G * k * math.tanh(k * h)) < 1e-9 * w * w


def test_shoaling_is_one_in_deep_water_and_dips_to_its_known_minimum():
    assert abs(sc.shoaling_ks(8.0, 2000.0) - 1.0) < 1e-6
    # The classic minimum Ks ~ 0.913 near kh ~ 1.2 (linear theory), then growth into shallow water.
    mins = min(sc.shoaling_ks(10.0, h) for h in range(5, 200))
    assert 0.90 < mins < 0.92
    assert sc.shoaling_ks(10.0, 3.0) > 1.1


def test_hb_proxy_is_komar_gaughan_on_the_deshoaled_height():
    hs, tp = 1.0, 12.0
    deep = sc.hb_proxy(hs, tp, 5000.0)
    l0 = sc.G * tp * tp / (2 * math.pi)
    assert abs(deep - 0.56 * hs * (hs / l0) ** -0.2) < 1e-9
    assert sc.hb_proxy(None, 12, 17) is None and sc.hb_proxy(1, 0, 17) is None
    # a buoy at 17 m reads a shoaled height; deshoaling removes it before Komar
    assert sc.hb_proxy(hs, tp, 17.0) != deep


# ---- scores ------------------------------------------------------------------------------------------------------
def test_twcrps_point_only_sees_values_above_the_threshold():
    assert sc.twcrps_point(0.5, 0.7, 1.0) == 0.0
    assert sc.twcrps_point(1.5, 0.7, 1.0) == pytest.approx(0.5)
    assert sc.twcrps_point(1.5, 2.0, 1.0) == pytest.approx(0.5)


def test_quantile_interpolates():
    assert sc.quantile([1, 2, 3, 4, 5], 0.5) == 3
    assert sc.quantile([0, 10], 0.9) == pytest.approx(9.0)
    assert sc.quantile([], 0.9) is None


def test_arm_scores_crps_equals_mae_for_a_deterministic_forecast():
    items = [{"f": 1.0 + 0.1 * i, "obs": 1.0, "persistence": 1.0} for i in range(20)]
    m = sc.arm_scores(items, "f", 1.5)
    assert m["crps"] == m["mae"] and "deterministic" in m["crps_kind"]
    assert m["top_decile_n"] == 0 and m["top_decile_bias"] is None
    assert sc.arm_scores(items[:3], "f", 1.0)["suppressed"]


# ---- baselines ---------------------------------------------------------------------------------------------------
def _obs(n_days=21, step_h=3, fn=lambda h: 1.0 + 0.5 * math.sin(h / 10.0)):
    return [{"time": T0 + timedelta(hours=h), "hs_m": fn(h), "tp_s": 12.0, "qc": "good"}
            for h in range(0, n_days * 24, step_h)]


def test_climatology_reads_only_outside_the_embargo():
    obs = [{"time": T0 + timedelta(days=d), "hs_m": 1.0 if d < 7 else 3.0, "tp_s": 10, "qc": "good"}
           for d in range(14)]
    c = sc.climatology(obs, "hs_station", 17.0, (T0 + timedelta(days=7), None))
    assert c["value"] == pytest.approx(1.0) and c["n"] == 7 and c["out_of_sample"] is True
    assert max(c["times"]) < T0 + timedelta(days=7)
    with pytest.raises(sc.LeakedClimatology):
        sc.climatology(obs, "hs_station", 17.0, None)


def test_build_items_joins_truth_and_uses_only_issue_time_information():
    obs = _obs()
    stations = {"S1": {"id": "S1", "source": "cdip", "role": "nearshore", "depth_m": 17.0}}
    rows = []
    for d in range(8, 12):
        for lead in (24, 48):
            valid = T0 + timedelta(days=d)
            cyc = valid - timedelta(hours=lead)
            rows.append({"station": "S1", "role": "nearshore", "anchor": True, "valid": valid.strftime("%Y-%m-%dT%H:%MZ"),
                         "cycle": cyc.strftime("%Y-%m-%dT%H:%MZ"), "lead_h": lead, "hs_station_m": 1.2,
                         "outputs": {"surf_height_m": 1.5}, "inputs": {"offshore_hs_m": 1.4}})
    rows.append(dict(rows[0], anchor=False))         # a non-anchor spot never enters the scored panel
    emb = sc.clim_embargo(T0 + timedelta(days=8), T0 + timedelta(days=11), 48)
    items, qc = sc.build_items("hs_station", rows, {"S1": obs}, stations, clim_embargo=emb)
    assert qc["items"] == len(items) == 8 and qc["no_truth"] == 0
    assert qc["climatology"]["S1"]["last"] < (T0 + timedelta(days=6, hours=1)).strftime("%Y-%m-%dT%H:%MZ")
    for (sid, t, lead), it in items.items():
        t0 = t - timedelta(hours=lead)
        assert it["persistence"] == pytest.approx(1.0 + 0.5 * math.sin(((t0 - T0).total_seconds() / 3600) / 10.0))
        assert it["f"] == 1.2 and it["hull"] == "waverider"
    hb, _ = sc.build_items("hb_proxy", rows, {"S1": obs}, stations, clim_embargo=emb)
    assert all(i["f"] == 1.5 and i["obs"] == pytest.approx(sc.hb_proxy(i["obs_hs"], 12.0, 17.0)) for i in hb.values())


# ---- the gate: synthetic panels ------------------------------------------------------------------------------------
CFG = dataclasses.replace(eg.harness_config(), bootstrap_reps=400)


def _panel(n_hours=60, stations=("A", "B", "C", "D", "E", "F"), cand_err=1.0, seed=1):
    rng = random.Random(seed)
    items = []
    for h in range(n_hours):
        t = T0 + timedelta(hours=6 * h)
        for s in stations:
            obs = 1.0 + 0.6 * math.sin(h / 5.0 + ord(s)) + rng.random() * 0.2
            e = rng.gauss(-0.1, 0.25)
            for lead in (24, 48, 72):
                items.append({"buoy": s, "t": t, "lead": lead, "obs": obs, "f_ref": obs + e,
                              "f_cand": obs + cand_err * e, "obs_hs": obs, "hull": "waverider",
                              "hull_inferred": False, "dpd": 12.0, "multi": None, "persistence": obs + 0.3})
    return items


def test_a_better_candidate_passes_and_a_worse_one_fails():
    good, bad = _panel(cand_err=0.7), _panel(cand_err=1.3)
    thr = sc.quantile([i["obs"] for i in good], 0.9)
    sg, sb = eg.summarize(good, CFG, thr), eg.summarize(bad, CFG, thr)
    assert eg.rules(sg, CFG, True)["verdict"] == "PASS"
    assert sg["crps_gain"] > 0 and sg["crps_gain_ci"][0] > 0
    assert eg.rules(sb, CFG, True)["verdict"] == "FAIL"


def test_an_identical_candidate_is_refused_and_broken_controls_invalidate():
    same = _panel(cand_err=1.0)
    s = eg.summarize(same, CFG, 1.5)
    assert s["crps_gain"] == 0 and s["crps_gain_ci"] == [0.0, 0.0]
    assert eg.rules(s, CFG, True)["verdict"] == "REFUSED"
    assert eg.rules(eg.summarize(_panel(cand_err=0.7), CFG, 1.5), CFG, False)["verdict"] == "INVALID"
    assert eg.rules(s, CFG, "underpowered")["verdict"] == "REFUSED"


def test_controls_pass_on_a_real_shaped_panel():
    base = _panel()
    thr = sc.quantile([i["obs"] for i in base], 0.9)
    ctl = eg.run_controls(base, CFG, thr)
    assert ctl["ok"] is True
    assert ctl["null_identical"]["crps_gain"] == 0 and ctl["null_identical"]["verdict"] != "PASS"
    assert ctl["positive"]["verdict"] == "PASS" and ctl["negative"]["verdict"] == "FAIL"
    assert ctl["null_swap"]["binding"] is False


def test_controls_on_a_tiny_panel_are_underpowered_not_broken():
    ctl = eg.run_controls(_panel(n_hours=8, stations=("A", "B")), CFG, 1.5)
    assert ctl["ok"] == "underpowered" and ctl["positive"]["verdict"] == "REFUSED"


def test_top_decile_bias_growth_fails_even_when_the_typical_error_improves():
    items = _panel(cand_err=0.8)
    thr = sc.quantile([i["obs"] for i in items], 0.9)
    for i in items:
        if i["obs"] >= thr:
            i["f_cand"] = i["obs"] - 0.4           # peak shaving: the big days read far low
    r = eg.rules(eg.summarize(items, CFG, thr), CFG, True)
    assert r["verdict"] == "FAIL"
    assert any("top 10%" in x or "top decile" in x or "p90" in x for x in r["reasons"])


def test_holm_across_arms_demotes_a_marginal_pass():
    arms = {f"A{k}": {"quantities": {"hs_station": {"summary": {"dm_p_better": p},
                                                     "verdict": {"verdict": "PASS", "reasons": []}}}}
            for k, p in enumerate((0.03, 0.04, 0.001))}
    eg.holm_across_arms(arms, "hs_station", CFG)
    v = {a: r["quantities"]["hs_station"]["verdict"]["verdict"] for a, r in arms.items()}
    assert v == {"A0": "FAIL", "A1": "FAIL", "A2": "PASS"}


def test_station_cluster_bootstrap_and_station_week_folds():
    items = _panel(cand_err=0.7)
    cb = sc.station_cluster_boot(items, reps=300)
    assert cb["clusters"] == 6 and cb["ci"][0] > 0 and cb["binding"] is False
    fw = sc.station_week_folds(items)
    assert fw["scored"] > 0 and fw["positive_share"] > 0.75


def test_null_swap_is_exchangeable():
    base = _panel()
    sw = sc.control_items(base, "null_swap")
    assert len(sw) == len(base)
    by_t = {}
    for i in sw:
        by_t.setdefault(i["t"], set()).add(i["f_cand"] == i["persistence"])
    assert all(len(v) == 1 for v in by_t.values())   # one coin per hour, never per pair
    assert {next(iter(v)) for v in by_t.values()} == {True, False}


def test_impact_counts_changed_outputs():
    a = [{"spot": "x", "valid": "v", "lead_h": 24, "outputs": {"surf_height_m": 1.0, "score": 50, "level": "fair"}}]
    b = [{"spot": "x", "valid": "v", "lead_h": 24, "outputs": {"surf_height_m": 1.1, "score": 58, "level": "good"}}]
    im = eg.impact(a, b)
    assert im == {"spot_hours": 1, "height_changed": 1, "level_changed": 1, "mean_abs_score_change": 8.0,
                  "max_abs_score_change": 8.0}


def test_station_cluster_ci_binds_only_with_enough_stations():
    few = sc.station_cluster_boot(_panel(cand_err=0.7), reps=200)
    many = sc.station_cluster_boot(_panel(cand_err=0.7, stations=tuple("ABCDEFGHIJKL")), reps=200)
    assert few["binding"] is False and "advisory" in few["note"]
    assert many["binding"] is True and many["clusters"] == 12


def test_a_candidate_that_loses_to_a_truth_only_baseline_is_flagged():
    w = eg.baseline_warnings({"climatology": {"crps_gain_ci": [-0.11, -0.02]},
                              "persistence": {"crps_gain_ci": [-0.05, 0.04]}})
    assert len(w) == 1 and "climatology" in w[0]


def test_input_parity_requires_an_eccodes_backend_and_the_served_wind():
    rows = [{"decoders": ["builtin"], "wind_source": "gfswave"}]
    assert eg.input_parity(rows)["production_parity"] is False
    assert eg.input_parity([{"decoders": ["pygrib"], "wind_source": "pgrb2"}])["production_parity"] is True
    assert eg.input_parity([{"decoders": ["eccodes"], "wind_source": "pgrb2"}])["production_parity"] is True
    assert eg.input_parity([{"decoders": ["eccodes"], "wind_source": "gfswave"}])["production_parity"] is False
    assert eg.input_parity([{"decoders": ["builtin", "eccodes"], "wind_source": "pgrb2"}])["production_parity"] is False
    assert eg.input_parity([])["production_parity"] is False
