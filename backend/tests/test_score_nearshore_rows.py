"""The S0 gate's forcing-truth scorer (scripts/score_nearshore_rows.py), on synthetic rows where the answer is known.

The rule it computes is docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md. These tests pin: the
verdict words on seeded data; that a low chain is not mistaken for wrong physics (level against pattern); that one
station cannot carry a verdict; the extremes guardrail; that verdicts print only for a registered window, whole,
closed and completely read; the cell minimums; that a refused run's rows are never mixed in; that the report carries
no station and no hour; and that the process holding the Storage key imports the standard library only and only reads."""
import ast
import io
import json
import os
import random
import sys

import pytest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import score_nearshore_rows as sn  # noqa: E402

DATA = os.path.join(os.path.dirname(SCRIPTS), "data")
SRC = os.path.join(SCRIPTS, "score_nearshore_rows.py")
W1_START, W1_END, W1_SEED = sn.REGISTERED_WINDOWS[0]
AFTER_W1 = "2026-12-08T00:00:00"          # the window's end plus the 24 h it must settle
# synthetic stations: three per region, coordinates inside the rule's boxes
STATIONS = {"ca1": (33.0, -117.3), "ca2": (34.0, -118.6), "ca3": (36.9, -122.0),
            "fe1": (27.5, -80.2), "fe2": (28.4, -80.5), "fe3": (26.0, -80.1),
            "ma1": (34.1, -77.7), "ma2": (36.2, -75.7), "ma3": (40.6, -73.1)}
REGION = {s: sn.region_of(*ll) for s, ll in STATIONS.items()}
FACTORS = {"friction": 1.0, "shoaling": 1.1, "exposure": 0.8, "kr": 0.873}
COUNTS = {"objects": 4, "graded": 3, "refused": 1, "rows_seen": 360, "rows_unusable": 0}


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(sn, "DRAWS", 200)        # the rule's 2,000 is for the real run; the logic is the same


def _rows(days=10, per_day=4, exposure_helps_in=(), noise=0.05, seed=1, exposure=None):
    """Truth h. Without the exposure factor the chain is exactly right (model = h), so served reads 0.8 h. In
    `exposure_helps_in` regions the opposite holds. `exposure(rng)` makes the factor vary by row:
    'spurious' = the factor varies and truth ignores it; 'real' = truth follows it and only the level is off."""
    rng, rows = random.Random(seed), []
    for s in STATIONS:
        for d in range(days):
            for k in range(per_day):
                h = 1.0 + rng.random()
                eps = rng.lognormvariate(0.0, noise)
                e = FACTORS["exposure"] if exposure is None else 0.6 + 0.4 * rng.random()
                obs = h
                if exposure == "real":
                    obs, model = h * e, h * e * eps * 0.8                    # truth follows the factor; chain 20% low
                elif exposure == "spurious":
                    model = h * eps * e                                      # truth ignores the factor
                else:
                    model = h * eps * (1.0 if REGION[s] in exposure_helps_in else e)
                f = dict(FACTORS, exposure=e)
                f["total"] = f["friction"] * f["shoaling"] * f["exposure"] * f["kr"]
                rows.append({"station": s, "spot": "sp-" + s, "valid_time": "2026-11-%02dT%02d:00:00Z" % (17 + d, 3 * k),
                             "offshore_hs_m": h * 1.2, "tp_s": 9.0, "swell_from_deg": 270.0, "model_hs_m": model,
                             "obs_hs_m": obs, "obs_time": "x", "factors": f})
    return rows


def _obj(rows, stamp="2026-11-18T04:00:00+00:00", graded=True):
    return {"version": 1, "generated_at": stamp, "graded": graded, "rows": rows}


def test_every_station_on_file_falls_in_one_of_the_rules_regions():
    docs = [json.load(io.open(os.path.join(DATA, f), encoding="utf-8"))
            for f in ("nearshore_validation_pairs.json", "nearshore_ndbc_pairs.json")]
    regions = sn.station_regions(docs)
    assert len(regions) >= 22 and "other" not in regions.values() and "hawaii" not in regions.values()
    assert regions["143p1"] == "florida_east" and regions["129p1"] == "gulf" and regions["433p1"] == "mid_atlantic"
    assert regions["254p1"] == "california" and regions["ndbc:42098"] == "gulf"
    assert sn.region_of(21.6, -158.0) == "hawaii" and sn.region_of(48.0, -124.7) == "other" and sn.region_of(None, 1) == "other"


def test_a_refused_runs_rows_are_never_mixed_in_and_the_latest_run_wins():
    r = _rows(days=1, per_day=1)[:1]
    old, new = dict(r[0], model_hs_m=9.0), dict(r[0], model_hs_m=1.0)
    refused = dict(r[0], spot="other-spot", model_hs_m=5.0)
    rows, counts = sn.usable_rows([_obj([new], "2026-11-18T10:00:00+00:00"), _obj([old], "2026-11-18T04:00:00+00:00"),
                                   _obj([refused], "2026-11-18T12:00:00+00:00", graded=False), "junk"], W1_START, W1_END)
    assert [x["model_hs_m"] for x in rows] == [1.0]
    assert counts == {"objects": 3, "graded": 2, "refused": 1, "rows_seen": 2, "rows_unusable": 0}


def test_rows_outside_the_window_or_without_a_usable_factor_are_dropped_and_counted():
    r = _rows(days=1, per_day=1)[0]
    bad = [dict(r, obs_hs_m=0.0), dict(r, model_hs_m=None), dict(r, factors=dict(FACTORS, kr=0.0)), dict(r, factors=None)]
    early = dict(r, valid_time="2026-11-16T23:00:00Z")
    rows, counts = sn.usable_rows([_obj(bad + [early, r])], W1_START, W1_END)
    assert len(rows) == 1 and counts["rows_unusable"] == 4 and counts["rows_seen"] == 6


def test_switching_a_factor_off_is_an_exact_division_and_the_unit_is_the_station_day_median():
    r = _rows(days=1, per_day=1)[0]
    rows = [dict(r, model_hs_m=m, obs_hs_m=1.0, valid_time="2026-11-17T%02d:00:00Z" % i) for i, m in enumerate((0.5, 1.0, 4.0))]
    assert list(sn.station_days(rows).values()) == [pytest.approx(0.0)]          # the median row reads 1.0
    assert list(sn.station_days(rows, ("exposure", "kr")).values()) == [pytest.approx(-sn.math.log(0.8 * 0.873))]
    assert list(sn.station_days(rows, divide_by=0.5).values()) == [pytest.approx(sn.math.log(2.0))]


def test_the_seeded_answers_come_out_as_the_rules_words():
    out = sn.analyse(_rows(), REGION, W1_SEED)
    f = out["factors"]
    assert f["exposure_off"]["verdict"] == "REMOVE CANDIDATE"       # the chain is right without it
    assert f["shoaling_off"]["verdict"] == "KEEP"                   # 0.8 -> 0.727 of truth: worse without it
    assert f["friction_off"]["verdict"] == "NOT SHOWN"              # the factor is 1.00: no difference, inside the null
    assert f["exposure_off"]["cells"]["pooled"]["diff"] < -0.15
    assert f["exposure_off"]["cells"]["pooled"]["off_moves"] == "toward truth"
    assert f["shoaling_off"]["cells"]["pooled"]["off_moves"] == "away from truth"
    assert f["exposure_off"]["leave_one_station_out"] == {"kept": 9, "scored": 9}
    assert f["exposure_off"]["leave_one_region_out"] == {"kept": 3, "scored": 3}
    assert f["exposure_off"]["regions_tested"] == ["california", "florida_east", "mid_atlantic"]
    assert out["served"]["pooled"]["bias"] == pytest.approx(0.8, abs=0.02)
    assert out["positive_control"]["status"] == "OK" and 1.25 <= out["positive_control"]["recovered"] <= 1.35


def test_a_constant_factor_on_a_low_chain_is_level_only_not_wrong_physics():
    """Item B. The factor is 0.8 on every row and the chain reads 0.8 of truth, so switching it off is exactly a
    constant multiplier: the result says the chain is LOW, and the report must not let it read as wrong physics."""
    out = sn.analyse(_rows(), REGION, W1_SEED)
    f = out["factors"]["exposure_off"]
    assert f["level"] == "level only" and f["level_constant"] == pytest.approx(0.8)
    assert f["pattern"]["diff"] == pytest.approx(0.0, abs=1e-12)
    text = sn.render(out, COUNTS, W1_START, W1_END)
    assert "exposure_off: **REMOVE CANDIDATE (level only)**. holds in 3 of 3 leave-one-region-out re-scores" in text
    assert "It does NOT say this factor's physics is wrong" in text


def test_a_factor_whose_pattern_truth_ignores_is_told_apart_from_one_whose_level_is_merely_off():
    spurious = sn.analyse(_rows(exposure="spurious"), REGION, W1_SEED)["factors"]["exposure_off"]
    assert spurious["verdict"] == "REMOVE CANDIDATE" and spurious["level"] == "the factor's pattern hurts"
    real = sn.analyse(_rows(exposure="real"), REGION, W1_SEED)["factors"]["exposure_off"]
    assert real["verdict"] == "REMOVE CANDIDATE"                    # off still reads closer than a chain 20% low...
    assert real["level"] == "level only: the pattern helps, the level is off"     # ...but only because of the level


def test_one_region_getting_worse_blocks_remove_candidate():
    out = sn.analyse(_rows(days=12, exposure_helps_in=("mid_atlantic",)), REGION, W1_SEED)
    f = out["factors"]["exposure_off"]
    assert f["cells"]["mid_atlantic"]["diff"] > sn.REGION_MARGIN    # there the chain is right WITH the factor
    assert f["verdict"] == "UNDECIDED" and "mid_atlantic" in f["reason"]


def test_a_verdict_that_one_station_carries_is_undecided():
    """Item E. Stations a and b improve, c and d do not: pooled it is better, but without a (or b) it is not."""
    units = [(s, "d%02d" % d) for s in "abcd" for d in range(10)]
    base = {u: 0.2 for u in units}
    other = {u: (0.0 if u[0] in "ab" else 0.2) for u in units}
    rng = random.Random(1)
    full = sn.paired(base, other, units, rng)
    assert sn.side(full) == -1
    loso = sn.stability(base, other, units, {s: s for s in "abcd"}, -1, rng)
    assert loso == {"kept": 2, "scored": 4}
    assert sn.verdict(full, {}, {}, loso)[0] == "UNDECIDED"
    assert sn.verdict(full, {}, {}, {"kept": 4, "scored": 4})[0] == "REMOVE CANDIDATE"


def test_a_remove_candidate_that_is_worse_at_the_extremes_is_disqualified_and_keep_is_not_touched():
    better = {"diff": -0.1, "ci": (-0.12, -0.08), "shown": True}
    worse = {"diff": 0.1, "ci": (0.08, 0.12), "shown": True}
    ok = {"kept": 3, "scored": 3}
    assert sn.verdict(better, {}, {"top_tenth_of_truth": 0.05, "offshore_3m_or_more": None}, ok)[0] == "DISQUALIFIED"
    assert sn.verdict(better, {}, {"top_tenth_of_truth": 0.02, "offshore_3m_or_more": None}, ok)[0] == "REMOVE CANDIDATE"
    assert sn.verdict(worse, {}, {"top_tenth_of_truth": 0.05}, ok) == ("KEEP", "")
    assert sn.verdict(worse, {}, {"top_tenth_of_truth": -0.05, "offshore_3m_or_more": None}, ok) == (
        "KEEP", "factor-off is better at the extremes: top_tenth_of_truth by 0.050")
    assert sn.verdict({"diff": 0.0, "ci": (-0.1, 0.1), "shown": True}, {}, {}, None)[0] == "UNDECIDED"
    assert sn.verdict(dict(better, shown=False), {}, {}, ok)[0] == "NOT SHOWN"
    assert sn.verdict(None, {}, {}, None)[0] == "UNTESTABLE"


def test_verdicts_print_only_for_a_registered_window_whole_closed_and_completely_read():
    assert sn.run_mode(W1_START, W1_END, AFTER_W1, "ok") == ("scored", 20261207)
    assert sn.run_mode("2027-01-11T00:00:00", "2027-02-01T00:00:00", "2027-02-02T00:00:00", "ok") == ("scored", 20270201)
    assert sn.run_mode(W1_START, W1_END, "2026-12-06T23:59:59", "ok")[0] == "counts"          # not closed
    assert sn.run_mode(W1_START, W1_END, "2026-12-07T23:59:59", "ok")[0] == "counts"          # closed, not settled
    assert sn.SETTLE_HOURS == 24 and sn._days(W1_START, W1_END)[-1] == "2026-12-08"           # the settling day is read
    assert sn.run_mode(W1_START, "2026-11-27T00:00:00", AFTER_W1, "ok")[0] == "counts"        # a sub-window
    assert sn.run_mode("2026-11-18T00:00:00", W1_END, AFTER_W1, "ok")[0] == "counts"
    assert sn.run_mode(W1_START, W1_END, AFTER_W1, "partial_1_failed")[0] == "counts"         # item D
    objects, regions = [_obj(_rows())], REGION
    mid = sn.report(objects, "ok", W1_START, W1_END, "2026-11-27T00:00:00", regions)
    partial = sn.report(objects, "partial_2_failed", W1_START, W1_END, AFTER_W1, regions)
    for text in (mid, partial):
        assert "COUNTS ONLY" in text and "Station-days: 90 over 10 days" in text
        for word in ("REMOVE CANDIDATE", "KEEP", "UNDECIDED", "difference |", "score (median"):
            assert word not in text
    assert "the read was not complete (partial_2_failed)" in partial
    scored = sn.report(objects, "ok", W1_START, W1_END, AFTER_W1, regions)
    assert "COUNTS ONLY" not in scored and "exposure_off: **REMOVE CANDIDATE (level only)**. holds in 3 of 3" in scored
    assert "**Scored dispatch 1 of 1 for this window.**" in scored and "Scored dispatch" not in mid


def test_every_report_carries_the_timing_and_lead_caveats():
    objects = [_obj(_rows())]
    for now in ("2026-11-27T00:00:00", AFTER_W1):
        text = sn.report(objects, "ok", W1_START, W1_END, now, REGION)
        assert "fixed at 2026-11-17 03:13Z, after window 1 opened and before any row was read" in text
        assert "the shortest lead: this scores near-analysis forcing, not a forecast" in text
        assert "close to station level" in text and "neither measures power" in text


def test_a_cell_under_the_minimum_prints_its_n_and_no_number_and_a_tiny_cell_hides_its_n():
    rows = _rows(days=6)                                            # 6 days: under the 7-day minimum everywhere
    out = sn.analyse(rows, REGION, W1_SEED)
    assert out["served"]["pooled"] == {"score": None, "bias": None, "n": 54}
    assert all(v["verdict"] == "UNTESTABLE" for v in out["factors"].values())
    assert out["cells_at_minimum"] == []
    tiny = sn.counts_only([r for r in rows if r["station"] == "ca1"], REGION)
    assert tiny["n_station_days"] is None and tiny["regions"] == {"california": None}
    assert sn.cell_ok([("a", "d%d" % i) for i in range(40)]) is False            # one station
    assert sn.cell_ok([(s, "d%d" % i) for s in "abc" for i in range(10)]) is True


def test_no_verdict_is_printed_when_the_positive_control_fails(monkeypatch):
    monkeypatch.setattr(sn, "CONTROL_BAND", (1.5, 1.6))
    out = sn.analyse(_rows(), REGION, W1_SEED)
    assert out["positive_control"]["status"] == "INVALID"
    text = sn.render(out, COUNTS, W1_START, W1_END)
    assert "THE TEST IS INVALID" in text and "REMOVE CANDIDATE" not in text and "KEEP" not in text


def test_the_report_carries_no_station_no_hour_and_no_row_and_says_what_it_cannot_judge():
    rows = _rows()
    scored = sn.render(sn.analyse(rows, REGION, W1_SEED), COUNTS, W1_START, W1_END, graded_runs=5)
    health = sn.render_counts(sn.counts_only(rows, REGION), COUNTS, W1_START, W1_END, "why")
    for text in (scored, health):
        for s in STATIONS:
            assert s not in text and ("sp-" + s) not in text
        assert "T03:00" not in text and "valid_time" not in text and "obs_hs_m" not in text
    assert "about 1 (APPROXIMATE" in scored and "NOT CHECKED" in health      # 5 requested runs, 4 stored objects
    assert "asked to grade and completed" in scored
    assert "NOT RUNNABLE: komar_off" in scored and "NOT BUILT: sea-state split" in scored
    assert "Season is UNTESTABLE" in scored and "limited to the tested regions" in scored
    assert "With one station left out: 9 of 9 re-scores keep the same side of zero" in scored


def test_the_same_rows_give_the_same_numbers_every_time():
    rows = _rows()
    assert sn.analyse(rows, REGION, W1_SEED) == sn.analyse(list(reversed(rows)), REGION, W1_SEED)


def test_the_configurations_windows_and_thresholds_are_the_rules():
    assert [c for c, _f in sn.CONFIGS] == ["served", "friction_off", "shoaling_off", "exposure_off", "refraction_off",
                                          "exposure_and_refraction_off"]
    assert sn.REGISTERED_WINDOWS == (("2026-11-17T00:00:00", "2026-12-07T00:00:00", 20261207),
                                     ("2027-01-11T00:00:00", "2027-02-01T00:00:00", 20270201))
    assert (sn.SHUFFLES, sn.MIN_UNITS, sn.MIN_DAYS, sn.MIN_STATIONS, sn.REGION_MARGIN) == (200, 30, 7, 3, 0.02)
    assert "DRAWS = 2000" in io.open(SRC, encoding="utf-8").read()


def _boundary_objects(midnight_differs=0.0, control_differs=0.0, days=12, refused_midnight=False):
    """Four runs a day (19Z, 21Z, then 00Z and 09Z the next day), each grading the same two target times at three
    stations. Consecutive pairs: (19Z, 21Z) is CONTROL, (21Z, 00Z) is MIDNIGHT, (00Z, 09Z) is neither.
    `*_differs` is the share of the later run's rows that stored a DIFFERENT observation for the same target time."""
    rng, objs = random.Random(7), []
    for d in range(days):
        day, nxt = 17 + d, 18 + d
        truth = {(s, h): 1.0 + rng.random() for s in ("ca1", "fe1", "ma1") for h in (12, 18)}

        def run(stamp, differ, graded=True):
            rows = []
            for (s, h), obs in truth.items():
                wrong = rng.random() < differ
                for spot in ("a", "b"):                              # two linked spots share one reading
                    rows.append({"station": s, "spot": spot, "valid_time": "2026-11-%02dT%02d:00:00Z" % (day, h),
                                 "model_hs_m": 1.0, "obs_hs_m": obs * (1.4 if wrong else 1.0),
                                 "obs_time": "2026-11-%02dT%02d:00:00Z" % (day - 1 if wrong else day, h),
                                 "factors": dict(FACTORS, total=0.77)})
            return _obj(rows, stamp, graded)
        objs += [run("2026-11-%02dT19:10:00+00:00" % day, 0.0), run("2026-11-%02dT21:10:00+00:00" % day, control_differs),
                 run("2026-11-%02dT00:20:00+00:00" % nxt, midnight_differs, graded=not refused_midnight),
                 run("2026-11-%02dT09:30:00+00:00" % nxt, 0.0)]
    return objs


def test_the_day_boundary_check_passes_a_clean_set_and_catches_a_seeded_shift():
    clean = sn.boundary_check(_boundary_objects(), W1_START, W1_END)
    assert clean["status"] == "no fault found"
    assert clean["midnight"] == {"pairs": 72, "share": 0.0} and clean["control"] == {"pairs": 72, "share": 0.0}
    shifted = sn.boundary_check(_boundary_objects(midnight_differs=1.0), W1_START, W1_END)
    assert shifted["status"] == "FAULT" and shifted["midnight"]["share"] == 1.0 and shifted["control"]["share"] == 0.0


def test_ordinary_late_corrections_in_both_groups_are_not_a_fault_and_an_excess_at_midnight_is():
    same = sn.boundary_check(_boundary_objects(midnight_differs=0.2, control_differs=0.2), W1_START, W1_END)
    assert same["status"] == "no fault found" and same["control"]["share"] > 0.05      # normal in both: not a fault
    excess = sn.boundary_check(_boundary_objects(midnight_differs=0.6, control_differs=0.1), W1_START, W1_END)
    assert excess["status"] == "FAULT"
    assert (sn.BOUNDARY_FAULT_SHARE, sn.BOUNDARY_FAULT_RATIO, sn.OBS_TOLERANCE_M) == (0.01, 2.0, 0.005)


def test_the_day_boundary_check_hides_small_groups_and_never_reads_a_refused_run():
    small = sn.boundary_check(_boundary_objects(midnight_differs=1.0, days=1), W1_START, W1_END)
    assert small["status"].startswith("NOT TESTABLE") and small["midnight"] == {"pairs": None, "share": None}
    refused = sn.boundary_check(_boundary_objects(midnight_differs=1.0, refused_midnight=True), W1_START, W1_END)
    assert refused["midnight"]["pairs"] is None                       # the midnight runs refused: their rows are not read
    assert sn.boundary_check([], W1_START, W1_END)["status"].startswith("NOT TESTABLE")


def test_the_day_boundary_check_lives_in_the_counts_only_report_and_names_nothing():
    objects = _boundary_objects(midnight_differs=1.0)
    health = sn.report(objects, "ok", W1_START, W1_END, "2026-11-27T00:00:00", REGION)
    assert "Day-boundary check" in health and "**FAULT.**" in health
    assert "72 pairs, 100.0% with a different observation" in health
    assert "excluded by a dated amendment BEFORE the scored dispatch" in health
    assert "NOT RUNNABLE: the rows do not store the cycle" in health
    for word in ("ca1", "fe1", "ma1", "T12:00", "T18:00", "REMOVE CANDIDATE", "KEEP"):
        assert word not in health
    scored = sn.report([_obj(_rows())], "ok", W1_START, W1_END, AFTER_W1, REGION)
    assert "Day-boundary check on these rows: **NOT TESTABLE" in scored    # the scored report carries its one word
    assert "pairs," not in scored                                     # and not the counts: those live in the health run
    for text in (scored, health):                                     # the date that can be shown, and what cannot
        assert "live from about 2026-11-05 01:05Z (Render deploy of c05085215)" in text
        assert "effect on model=GFS point reads is not verified" in text and "since 2026-11-04" not in text


def test_a_scored_run_with_a_boundary_fault_prints_no_verdict_until_the_runs_are_excluded(monkeypatch):
    """The protection must not depend on someone dispatching a counts-only run first."""
    faulty = _boundary_objects(midnight_differs=1.0)
    blocked = sn.report(faulty, "ok", W1_START, W1_END, AFTER_W1, REGION)
    assert "COUNTS ONLY: the day-boundary check found a FAULT and no exclusion is registered for it" in blocked
    assert "Scored dispatch" not in blocked and "REMOVE CANDIDATE" not in blocked and "KEEP" not in blocked
    clean = sn.report(_boundary_objects(), "ok", W1_START, W1_END, AFTER_W1, REGION)
    assert "COUNTS ONLY" not in clean and "Day-boundary check on these rows: **no fault found**" in clean
    stamps = tuple(str(o["generated_at"])[:19] for o in faulty if str(o["generated_at"])[11:13] == "00")
    monkeypatch.setattr(sn, "EXCLUDED_RUNS", stamps)                 # what a dated amendment would register
    after = sn.report(faulty, "ok", W1_START, W1_END, AFTER_W1, REGION)
    assert "COUNTS ONLY" not in after and "Runs excluded by a dated amendment: 12." in after
    assert sn.EXCLUDED_RUNS == stamps and "EXCLUDED_RUNS = ()" in io.open(SRC, encoding="utf-8").read()


class _Resp:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_the_fetch_only_reads_only_from_the_configured_host_and_reports_a_partial_read():
    seen = []

    def opener(req, timeout=0):
        seen.append((req.get_method(), req.full_url))
        if req.full_url.endswith("/object/list/weather-products"):
            day = json.loads(req.data.decode())["prefix"].split("/")[-2]
            if day == "2026-11-19":
                return _Resp(json.dumps([{"name": "c%d.txt" % i} for i in range(1000)]).encode())
            return _Resp(json.dumps([{"name": "a.json"}, {"name": "b.json"}, {"name": "x.txt"}]
                                    if day == "2026-11-17" else []).encode())
        if req.full_url.endswith("b.json"):
            raise OSError("boom")
        return _Resp(json.dumps(_obj([])).encode())

    env = {"SUPABASE_URL": "https://example.invalid/", "SUPABASE_SERVICE_ROLE_KEY": "k"}
    objs, status = sn.fetch_objects(["2026-11-17", "2026-11-18"], env=env, opener=opener)
    assert len(objs) == 1 and status == "partial_1_failed"
    assert all(u.startswith("https://example.invalid/storage/v1/object/") for _m, u in seen)
    assert [m for m, u in seen if "/object/list/" not in u] == ["GET", "GET"]     # objects are only ever read
    assert sn.fetch_objects(["2026-11-18"], env=env, opener=opener) == ([], "ok")
    assert sn.fetch_objects(["2026-11-19"], env=env, opener=opener)[1] == "partial_1_failed"   # a full page may hide objects
    assert sn.fetch_objects(["2026-11-17"], env={}, opener=opener) == ([], "not_configured")
    assert sn.fetch_objects(["2026-11-17"], env={"SUPABASE_URL": "http://x", "SUPABASE_SERVICE_ROLE_KEY": "k"},
                            opener=opener) == ([], "not_configured")


def test_the_process_that_holds_the_key_imports_the_standard_library_only_and_never_writes():
    src = io.open(SRC, encoding="utf-8").read()
    mods = set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            mods.add((node.module or "").split(".")[0])
    assert mods <= {"argparse", "datetime", "json", "math", "os", "random", "sys", "urllib"}, mods
    assert "x-upsert" not in src and "PUT" not in src and "DELETE" not in src
    assert src.count('method="POST"') == 1                                       # the list call, and only it
