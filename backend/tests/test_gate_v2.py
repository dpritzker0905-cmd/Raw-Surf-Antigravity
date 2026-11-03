"""Validation gates v2 (science audit 2026-11-01, docs/research/science-sota-2026-11-01.md section 8.6 #1).

Every instrument is tested in BOTH directions (LESSONS L-S4): the null control (identical lanes, white noise) says
nothing, the planted gain PASSES, and each planted failure FAILS for its own named reason. The headline positive
control is Gneiting's: a candidate that shifts big-swell forecasts down to the MEDIAN of a right-skewed error wins on
MAE everywhere (so v1 says YES) and must FAIL v2 on the big-swell bias band.
"""
import ast
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts import forecast_accuracy_monitor as monitor
from scripts import gate_v2_ndbc as ndbc
from scripts import scored_rows_gate as cli
from services.weather_pipeline import gate_v2 as g
from services.weather_pipeline import gate_v2_config as gc
from services.weather_pipeline import gate_v2_report as rep
from services.weather_pipeline import gate_v2_stats as st
from services.weather_pipeline import gate_v2_truth as tr
from services.weather_pipeline import scored_rows_analysis as sra

BACKEND = Path(__file__).resolve().parents[1]
T0 = datetime(2026, 10, 3, tzinfo=timezone.utc)
BUOYS = [f"46{n:03d}" for n in range(1, 13)] + [f"41{n:03d}" for n in range(1, 9)]


def _iso(t):
    return t.strftime("%Y-%m-%dT%H:00:00Z")


def _row(src, buoy, t, lead, hs, obs, **extra):
    return {"source": src, "buoy_id": buoy, "target_time": _iso(t), "lead_h": float(lead), "hs_m": round(hs, 4),
            "obs_time": _iso(t), "obs_hs_m": round(obs, 4), "err_m": round(hs - obs, 4), **extra}


def world(kind="better", hours=21 * 6, seed=3):
    """Served vs scalar rows: 20 buoys x 3 leads x `hours` target times 4 h apart, observed Hs right-skewed.
    The reference under-reads and every v1-facing candidate only RAISES it, because v1 refuses a scalar lane that ever
    reads below the served one ("not one product").
    better:  the candidate removes a fifth of every (negative) error.
    null:    the candidate IS the reference.
    shave:   big days (obs >= 2 m) carry an unbiased but RIGHT-skewed reference error (rare large over-reads) and the
             candidate moves them up by minus its MEDIAN (MAE-optimal, bias +0.15 m): Gneiting's trap in the direction
             v1 can see. Small days improve like `better`.
    shave_down: the peak-shaving direction: a LEFT-skewed unbiased error (rare large under-reads of a peak) moved DOWN
             to its median (bias -0.15 m).
             v1 refuses it (the candidate reads below the reference), v2 must FAIL it on the band.
    lead72:  `better` at +24/+48 h, but +72 h is made 30% worse."""
    rnd = random.Random(seed)
    rows = []
    for h in range(hours):
        t = T0 + timedelta(hours=4 * h)
        common = rnd.gauss(0, 0.3)
        for b in BUOYS:
            obs = max(0.2, 1.2 + common + rnd.expovariate(1.4))
            for lead in (24, 48, 72):
                if kind in ("shave", "shave_down") and obs >= 2.0:
                    sign = 1 if kind == "shave" else -1
                    e = sign * (rnd.expovariate(1 / 0.5) - 0.5)       # mean 0, median sign * -0.153
                    ref = obs + e
                    cand = ref + sign * 0.5 * (1 - math.log(2))       # = ref - median(e): the MAE optimum
                else:
                    e = -abs(rnd.gauss(0.1, 0.25))
                    ref = obs + e
                    cand = ref if kind == "null" else obs + 0.8 * e
                    if kind == "lead72" and lead == 72:
                        cand = obs + 1.3 * e
                extra = {"tp_s": 12.0, "obs_dpd_s": 12.5, "obs_apd_s": 8.0}
                rows.append(_row(sra.SERVED, b, t, lead, ref, obs, **extra))
                rows.append(_row(sra.SCALAR, b, t, lead, cand, obs, **extra))
    return rows


def run(rows, cfg=gc.DEFAULT):
    res = g.compare(g.height_items(rows), cfg)
    return res, g.verdict(res, cfg)


# ---- the verdict, both directions ------------------------------------------------------------------------------------
def test_a_real_gain_passes_and_agrees_with_v1():
    rows = world("better")
    res, v = run(rows)
    assert v["verdict"] == "PASS", v
    assert res["overall"]["tests"]["abs"]["dm"]["p_better"] < 0.001
    assert res["overall"]["tests"]["abs"]["boot"]["lo"] > 0
    d = g.disagreement(sra.gate(sra.tables(rows)), v)
    assert d["v1"] == "YES" and d["agree"]


def test_null_control_identical_lanes_are_refused_never_passed():
    _, v = run(world("null"))
    assert v["verdict"] == "REFUSED" and "same loss at every hour" in v["reasons"][0]


def test_peak_shaving_wins_mae_and_fails_v2_on_the_big_swell_bias_band():
    rows = world("shave")
    res, v = run(rows)
    big = res["bands"]["obs >= 2 m"]
    assert big["cand"]["mae"] < big["ref"]["mae"]                       # MAE prefers the median ...
    assert big["worsen"] > 0.10 and big["shift"] > 0.10                  # ... at the price of a bias
    assert v["verdict"] == "FAIL"
    assert any("band 'obs >= 2 m'" in r and "|bias| grows" in r for r in v["reasons"])
    # v1 sees this one too, but only through its FORECAST-band MAE cells, where the over-read tail concentrates
    v1 = sra.gate(sra.tables(rows))
    assert v1["verdict"] == "NO" and {r["group"] for r in v1["violators"]} == {"fc big >3m"}


def test_downward_peak_shaving_fails_v2_on_the_band_too():
    res, v = run(world("shave_down"))
    big = res["bands"]["obs >= 2 m"]
    assert big["cand"]["mae"] < big["ref"]["mae"] and big["shift"] < -0.10
    assert v["verdict"] == "FAIL" and any("band 'obs >= 2 m'" in r for r in v["reasons"])


def test_a_lead_that_degrades_fails_by_name_after_holm():
    _, v = run(world("lead72"))
    assert v["verdict"] == "FAIL"
    assert any("lead +72 h" in r and "Holm" in r for r in v["reasons"])
    assert not any("lead +24 h" in r for r in v["reasons"])


def noise_world(seed=11):
    """A v1-legal candidate (never below the reference) whose "gain" is noise: d ~ U(0, 0.02) m on an unbiased
    error. Every v1 cell moves by well under 5 mm, so v1 says YES; nothing here is a real improvement."""
    rnd = random.Random(seed)
    rows = []
    for h in range(120):
        t = T0 + timedelta(hours=4 * h)
        for b in BUOYS:
            obs = 1.0 + rnd.expovariate(1.0)
            for lead in (24, 48, 72):
                e = rnd.gauss(0, 0.3)
                rows += [_row(sra.SERVED, b, t, lead, obs + e, obs),
                         _row(sra.SCALAR, b, t, lead, obs + e + 0.02 * rnd.random(), obs)]
    return rows


def test_a_noise_win_passes_v1_and_fails_v2_as_not_significant():
    rows = noise_world()
    assert sra.gate(sra.tables(rows))["verdict"] == "YES"
    _, v = run(rows)
    assert v["verdict"] == "FAIL" and any("not significant overall" in r for r in v["reasons"])
    assert not g.disagreement(sra.gate(sra.tables(rows)), v)["agree"]


def test_refused_below_the_pooled_floor_and_when_the_required_band_is_untestable():
    rows = world("better", hours=1)[:40]
    assert run(rows)[1]["verdict"] == "REFUSED"
    small = [r for r in world("better") if r["obs_hs_m"] < 2.0]
    _, v = run(small)
    assert v["verdict"] == "REFUSED" and "obs >= 2 m" in v["reasons"][0]


def test_the_harm_family_is_every_lead_by_loss_plus_every_band_and_holm_is_applied():
    res, _ = run(world("better"))
    names = [f["test"] for f in res["harm"]]
    assert len(names) == 3 * 2 + 3 + 1
    tested = [f for f in res["harm"] if f["p"] is not None]
    assert all(f["holm"] >= f["p"] - 1e-12 for f in tested)


def test_cv_folds_never_split_a_buoy_and_replicate_a_real_gain():
    items = g.height_items(world("better"))
    by = g.folds(items, "buoy")
    homes = {}
    for k, fold in by.items():
        for i in fold:
            assert homes.setdefault(i["buoy"], k) == k
    cv = g.blocked_cv(items)
    assert cv["buoy"]["positive_share"] == 1.0 and cv["week"]["positive_share"] == 1.0


def test_cv_is_advisory_by_default_and_binding_when_configured():
    cfg = gc.GateV2Config(cv_min_positive_share=1.01)
    _, v = run(world("better"), cfg)
    assert v["verdict"] == "PASS" and any("blocked CV" in w for w in v["warnings"])
    _, v = run(world("better"), gc.GateV2Config(cv_min_positive_share=1.01, cv_is_gate=True))
    assert v["verdict"] == "FAIL" and any("blocked CV" in r for r in v["reasons"])


# ---- statistics --------------------------------------------------------------------------------------------------
def test_point_metrics_by_hand():
    m = st.point_metrics([1.0, 3.0], [2.0, 2.0], min_shape_n=1)
    assert m["bias"] == 0 and m["mae"] == 1 and m["rmse"] == 1
    assert m["si"] == pytest.approx(0.5) and m["hh"] == pytest.approx(math.sqrt(2 / 8))
    assert st.point_metrics([1.0], [2.0])["si"] is None                     # refuses below the shape floor


def test_crps_forms():
    assert st.crps_ensemble([2.5], 2.0) == pytest.approx(0.5)               # one member = absolute error
    assert st.crps_ensemble([1.0, 3.0], 2.0) == pytest.approx(1.0 - 0.5)
    assert st.crps_gaussian(0, 1, 0) == pytest.approx(2 / math.sqrt(2 * math.pi) - 1 / math.sqrt(math.pi))
    assert st.crps_gaussian(1.0, 0.0, 3.0) == 2.0


def test_holm_and_bh_known_values():
    assert st.holm([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert st.benjamini_hochberg([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.04, 0.04])


def _ar1(phi, n, seed):
    rnd, x, out = random.Random(seed), 0.0, []
    for _ in range(n):
        x = phi * x + rnd.gauss(0, 1)
        out.append(x)
    return out


def test_dependence_rule_white_noise_vs_ar1():
    white = st.dependence(_ar1(0.0, 400, 1))
    assert white["k"] == 1 and white["block"] == math.ceil(400 ** (1 / 3))
    red = st.dependence(_ar1(0.9, 400, 1))
    assert red["k"] > 5 and red["block"] >= red["k"] and red["hac_lag"] >= red["k"] - 1


def test_newey_west_grows_with_positive_autocorrelation():
    x = _ar1(0.8, 500, 2)
    assert st.newey_west_lrv(x, 20) > 2 * st.newey_west_lrv(x, 0)


def test_dm_null_is_not_significant_and_a_planted_mean_is():
    noise = [random.Random(5).gauss(0, 1) for _ in range(1)] + [random.Random(i).gauss(0, 1) for i in range(299)]
    dm = st.diebold_mariano(noise, 4)
    assert 0.05 < dm["p_two"]
    shifted = st.diebold_mariano([v + 0.5 for v in noise], 4)
    assert shifted["p_better"] < 1e-4 and shifted["p_worse"] > 0.999
    assert st.diebold_mariano(noise[:10], 2) is None                           # too short: refuse
    assert st.diebold_mariano([0.0] * 50, 2) is None                           # no variance: refuse


def test_block_bootstrap_is_seeded_and_brackets_the_mean():
    x = _ar1(0.5, 200, 3)
    a, b = st.block_bootstrap(x, 6, 500, 9), st.block_bootstrap(x, 6, 500, 9)
    assert a == b and a["lo"] < st.mean(x) < a["hi"]
    c = st.block_bootstrap([2.0] * 50, 5, 100, 1)
    assert c["lo"] == c["hi"] == 2.0


def test_differential_series_averages_buoys_within_an_hour():
    t = T0
    items = [{"t": t, "obs": 0, "f_ref": 1, "f_cand": 0}, {"t": t, "obs": 0, "f_ref": 0, "f_cand": 0},
             {"t": t + timedelta(hours=1), "obs": 0, "f_ref": -2, "f_cand": 1}]
    assert st.differential_series(items, "abs") == [0.5, 1.0]
    assert st.differential_series(items, "sq") == [0.5, 3.0]


# ---- truth: hulls ------------------------------------------------------------------------------------------------
META = """<?xml version="1.0" encoding="UTF-8"?>
<stations created="2026-11-01T05:00:01Z">
 <station id="46026" name="SF" owner="NDBC" pgm="x" type="other">
  <history start="2025-05-20" stop="" lat="1" lng="1" elev="0" met="y" hull="" anemom_height="5.0"/>
  <history start="2018-05-09" stop="2025-05-20" lat="1" lng="1" elev="0" met="y" hull="3D09" anemom_height="5.0"/>
 </station>
 <station id="46002" name="OR" owner="NDBC" pgm="x" type="other">
  <history start="2026-10-10" stop="" hull="6N12"/>
  <history start="2020-01-01" stop="2026-10-10" hull="2.1D04"/>
 </station>
 <station id="46225" name="Torrey" owner="SCRIPPS" pgm="x" type="moored buoy">
  <history start="2019-10-10" stop="" hull=""/>
 </station>
</stations>"""


@pytest.mark.parametrize("code,owner,cls", [
    ("3D09", "", "discus_3m"), ("3DV40", "", "discus_3m"), ("2.1D15", "", "discus_2.1m"), ("2.6D69", "", "discus_small"),
    ("24DV", "", "discus_small"), ("10D04", "", "discus_large"), ("6N12", "", "nomad_6m"), ("TAO RECAP", "", "mooring"),
    ("ATLAS", "", "mooring"), ("30743", "SCRIPPS", "waverider"), ("", "", "unknown"), ("XYZ", "", "unknown")])
def test_hull_classes(code, owner, cls):
    assert tr.hull_class(code, owner) == cls


def test_hull_is_looked_up_at_the_rows_hour_with_an_inferred_fallback():
    meta = tr.parse_station_metadata(META)
    at = lambda s, d: tr.hull_at(meta, s, datetime.fromisoformat(d).replace(tzinfo=timezone.utc))  # noqa: E731
    assert at("46002", "2026-10-05") == ("discus_2.1m", False)
    assert at("46002", "2026-10-12") == ("nomad_6m", False)               # the hull changed at a service visit
    assert at("46026", "2026-10-05") == ("discus_3m", True)                # empty code -> the previous deployment's
    assert at("46225", "2026-10-05") == ("waverider", False)
    assert at("99999", "2026-10-05") == ("unknown", False)


def test_metadata_with_a_doctype_or_entity_is_refused():
    with pytest.raises(tr.UnsafeXML):
        tr.parse_station_metadata('<!DOCTYPE x [<!ENTITY a "b">]><stations></stations>')


# ---- truth: spectra ----------------------------------------------------------------------------------------------
FREQS = [0.033 + 0.005 * i for i in range(14)] + [0.1 + 0.01 * i for i in range(20)] + [0.31 + 0.02 * i for i in range(9)]


def _spec_line(t, dens):
    body = " ".join(f"{d:.4f} ({f:.3f})" for f, d in zip(FREQS, dens))
    return f"{t:%Y %m %d %H %M} 0.150 {body}"


def _gauss_spec(peaks):
    return [sum(a * math.exp(-0.5 * ((f - fp) / w) ** 2) for a, fp, w in peaks) for f in FREQS]


def test_parse_and_the_fit_recovers_a_peak_between_bands_where_dpd_is_quantised():
    t = datetime(2026, 10, 5, 12, 20, tzinfo=timezone.utc)
    text = "#YY  MM DD hh mm Sep_Freq  < spec_1 (freq_1) >\n" + _spec_line(t, _gauss_spec([(4.0, 0.0655, 0.006)]))
    recs = tr.parse_data_spec(text)
    assert len(recs) == 1 and recs[0][0] == t
    p = tr.spectral_params(recs[0][1], 0.5, 0.75)
    true_tp = 1 / 0.0655
    assert abs(p["fit_tp_s"] - true_tp) < 0.25 < abs(p["dpd_s"] - true_tp)
    assert not p["multi_peaked"]


def test_tm02_and_hm0_on_a_known_spectrum():
    t = datetime(2026, 10, 5, 12, 20, tzinfo=timezone.utc)
    dens = [1.0 if 0.08 <= f <= 0.12 else 0.0 for f in FREQS]
    p = tr.spectral_params(tr.parse_data_spec(_spec_line(t, dens))[0][1])
    sel = [f for f in FREQS if 0.08 <= f <= 0.12]
    assert 0.07 < p["tm02_s"] ** -1 < 0.13 and p["tm_10_s"] > 1 / max(sel)
    assert p["hm0_m"] > 0


def test_multi_peaked_spectra_are_flagged_and_single_ones_are_not():
    bi = tr.spectral_params(list(zip(FREQS, _gauss_spec([(3.0, 0.065, 0.005), (2.5, 0.15, 0.015)]))), 0.5, 0.75)
    one = tr.spectral_params(list(zip(FREQS, _gauss_spec([(3.0, 0.065, 0.005), (0.4, 0.15, 0.015)]))), 0.5, 0.75)
    assert bi["multi_peaked"] and bi["n_peaks"] == 2
    assert not one["multi_peaked"]


def _spectra_for(rows, peak_f=0.0655):
    out = {}
    for r in rows:
        if r["source"] != sra.SERVED:
            continue
        t = datetime.fromisoformat(r["obs_time"].replace("Z", "+00:00")) + timedelta(minutes=10)
        hs = r["obs_hs_m"]
        base = _gauss_spec([(1.0, peak_f, 0.006)])
        m0 = sum(d * w for d, w in zip(base, tr._widths(FREQS)))
        scale = (hs / 4) ** 2 / m0
        out.setdefault(r["buoy_id"], {})[t] = list(zip(FREQS, [d * scale for d in base]))
    return {b: sorted(v.items()) for b, v in out.items()}


def test_period_items_score_dpd_and_fit_and_the_frequency_space():
    rows = world("better", hours=12)
    spec = g.spectral_index(_spectra_for(rows))
    qc = {}
    dpd = g.period_items(rows, truth_kind="dpd")
    fit = g.period_items(rows, truth_kind="fit", spec_index=spec, qc=qc)
    freq = g.period_items(rows, truth_kind="fit", space="frequency", spec_index=spec)
    assert len(dpd) == len(fit) == len(freq) > 0 and qc.get("joined") == len(fit)
    assert all(i["obs"] == 12.5 for i in dpd)
    assert all(abs(i["obs"] - 1 / 0.0655) < 0.25 for i in fit)
    assert all(abs(i["obs"] - 0.0655) < 0.002 and abs(i["f_ref"] - 1 / 12.0) < 1e-9 for i in freq)


def test_a_spectrum_whose_hm0_disagrees_with_the_observation_is_refused():
    rows = world("better", hours=4)
    spec = g.spectral_index(_spectra_for(rows))
    for r in rows:
        r["obs_hs_m"] = r["obs_hs_m"] + 1.0
    qc = {}
    assert g.period_items(rows, truth_kind="fit", spec_index=spec, qc=qc) == []
    assert qc["hm0_mismatch"] > 0


def test_truth_check_reads_apd_against_tm02_and_dpd_against_the_fit():
    rows = world("better", hours=12)
    tc = g.truth_check(rows, g.spectral_index(_spectra_for(rows)))
    assert tc["n"] > 10 and tc["multi_share"] == 0
    assert tc["dpd_minus_fit"]["mean"] == pytest.approx(12.5 - 1 / 0.0655, abs=0.3)


def test_crps_members_matches_hand_arithmetic():
    t = T0
    rows = [_row(m, "46001", t + timedelta(hours=i), 24, 2.0 + d, 2.0) for i in range(12)
            for m, d in zip(sra.MEMBERS, (-0.3, 0.0, 0.3))]
    c = g.crps_members(rows)
    assert c["n"] == 12 and c["mae_equal"] == pytest.approx(0.0)
    assert c["crps"] == pytest.approx(0.2 - 0.5 * (4 * 0.3 + 2 * 0.6) / 9)


# ---- aggregates only, report, config ------------------------------------------------------------------------------
def test_the_v2_section_names_no_buoy_no_target_time_and_carries_every_part():
    rows = noise_world()
    text = rep.build_v2_section(rows, sra.gate(sra.tables(rows)))
    for needle in ("Validation gates v2", "v1 vs v2: DISAGREE", "GATE v2: FAIL", "Significance", "Big-swell bands",
                   "Harm family", "By buoy hull", "By sea state", "Blocked cross-validation", "Block-length rule",
                   "Peak period", "Member ensemble CRPS"):
        assert needle in text, needle
    assert not any(b in text for b in BUOYS)
    assert "2026-10-0" not in text and "T00:00" not in text


def test_the_flag_is_default_off_and_read_at_call_time(monkeypatch):
    monkeypatch.delenv("GATES_V2", raising=False)
    assert not gc.enabled()
    monkeypatch.setenv("GATES_V2", "1")
    assert gc.enabled()
    assert not gc.enabled({"GATES_V2": "0"})


def test_every_threshold_lives_in_the_config():
    names = set(gc.GateV2Config.__dataclass_fields__)
    for needle in ("alpha_overall", "alpha_harm", "bands", "required_bands", "min_n_overall", "max_block_frac",
                   "bootstrap_seed", "cv_min_positive_share", "multi_peak_rel", "spec_hm0_tol_m"):
        assert needle in names
    for path in BACKEND.glob("services/weather_pipeline/gate_v2*.py"):
        if path.name == "gate_v2_config.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        assert not [n for n in tree.body if isinstance(n, ast.Assign)
                    and any(getattr(t, "id", "").startswith(("ALPHA", "MIN_N", "MAX_BIAS")) for t in n.targets)]


def test_the_pure_modules_have_no_network_and_no_write_path():
    for path in BACKEND.glob("services/weather_pipeline/gate_v2*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                mods = [a.name for a in node.names] + [getattr(node, "module", None) or ""]
                assert not any(m.split(".")[0] in {"urllib", "http", "requests", "httpx", "socket", "supabase"}
                               for m in mods), (path.name, mods)
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                assert name not in {"open", "urlopen", "post", "put", "upload", "write"}, (path.name, name)


# ---- the NDBC fetch and the wiring ---------------------------------------------------------------------------------
def test_fetch_truth_is_never_fatal_counts_everything_and_only_asks_ndbc():
    asked = []

    def get(url, timeout_s, max_bytes):
        asked.append(url)
        if "metadata" in url:
            return META
        if "41001" in url:
            return _spec_line(datetime(2026, 10, 5, 12, 20, tzinfo=timezone.utc), _gauss_spec([(1.0, 0.07, 0.006)]))
        raise OSError("404")

    clock = iter([0, 1, 2, 3, 999, 999, 999]).__next__
    out = ndbc.fetch_truth(["46026", "46002", "bad id", "41001", "41002"], tr.parse_station_metadata,
                           tr.parse_data_spec, get=get, budget_s=100, clock=clock)
    assert out["counts"]["meta"] == "ok" and out["counts"]["spec_ok"] == 1 and out["counts"]["invalid_id"] == 1
    assert out["counts"]["spec_failed"] >= 1 and out["counts"]["not_fetched_budget"] >= 1
    assert all(u.startswith("https://www.ndbc.noaa.gov/") for u in asked)
    assert ndbc.NDBC_HOST == cli.V2_NDBC_HOST


def test_the_guard_admits_ndbc_only_when_asked_and_still_get_only():
    import http.client
    conn = http.client.HTTPConnection("www.ndbc.noaa.gov")
    with cli.read_only_http("proj.example.test"):
        with pytest.raises(cli.ReadOnlyViolation):
            conn.request("GET", "/x")
    with cli.read_only_http("proj.example.test", extra_hosts=(cli.V2_NDBC_HOST,)):
        with pytest.raises(cli.ReadOnlyViolation):
            conn.request("POST", "/x")
        with pytest.raises(cli.ReadOnlyViolation):
            http.client.HTTPConnection("evil.example").request("GET", "/")


def _fake_archive(monkeypatch, rows):
    store = {"calibration/skill/scored-2026-10.json": rows}
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key, timeout=30: store.get(key, monitor.ABSENT))


@pytest.mark.parametrize("flag", ["0", "1"])
def test_main_appends_v2_only_under_the_flag_and_never_changes_v1_or_the_exit_code(monkeypatch, capsys, flag):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k-not-a-real-value")
    monkeypatch.setenv("GATES_V2", flag)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(cli, "fetch_v2_truth", lambda rows, fetch=None: {"meta": None, "spectra": {}, "counts": {}})
    _fake_archive(monkeypatch, noise_world())
    code = cli.main([], now=datetime(2026, 10, 30, tzinfo=timezone.utc))
    out = capsys.readouterr().out
    assert code == cli.DONE and "**GATE: YES**" in out
    assert ("Validation gates v2" in out) == (flag == "1")
    if flag == "1":
        assert "GATE v2: FAIL" in out and "v1 vs v2: DISAGREE" in out


def test_workflow_input_defaults_off_and_reaches_the_env():
    import yaml
    doc = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / "scored-rows-gate.yml").read_text(encoding="utf-8"))
    triggers = doc.get("on", doc.get(True))
    assert triggers["workflow_dispatch"]["inputs"]["gates_v2"]["default"] == "0"
    env = doc["jobs"]["gate"]["steps"][1]["env"]
    assert env["GATES_V2"] == "${{ inputs.gates_v2 }}"
