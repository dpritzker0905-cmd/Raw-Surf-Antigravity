"""The S0 gate's forcing-truth scorer (scripts/score_nearshore_rows.py), on synthetic rows where the answer is known.

The rule it computes is docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md. These tests pin: the
verdict words on seeded data, the cell minimums, the null, the positive control, that a refused run's rows are never
mixed in, that the report carries no station and no hour, and that the process holding the Storage key imports the
standard library only and only ever reads."""
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
# synthetic stations: three per region, coordinates inside the rule's boxes
STATIONS = {"ca1": (33.0, -117.3), "ca2": (34.0, -118.6), "ca3": (36.9, -122.0),
            "fe1": (27.5, -80.2), "fe2": (28.4, -80.5), "fe3": (26.0, -80.1),
            "ma1": (34.1, -77.7), "ma2": (36.2, -75.7), "ma3": (40.6, -73.1)}
REGION = {s: sn.region_of(*ll) for s, ll in STATIONS.items()}
FACTORS = {"friction": 1.0, "shoaling": 1.1, "exposure": 0.8, "kr": 0.873}


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(sn, "DRAWS", 300)        # the rule's 2,000 is for the real run; the logic is the same


def _rows(days=10, per_day=4, exposure_helps_in=(), noise=0.05, seed=1):
    """Truth h. Without the exposure factor the chain is exactly right (model = h), so served reads 0.8 h and
    `exposure_off` must come out as REMOVE CANDIDATE. In `exposure_helps_in` regions the opposite holds."""
    rng, rows = random.Random(seed), []
    total = FACTORS["friction"] * FACTORS["shoaling"] * FACTORS["exposure"] * FACTORS["kr"]
    for s in STATIONS:
        for d in range(days):
            for k in range(per_day):
                h = 1.0 + rng.random()
                eps = rng.lognormvariate(0.0, noise)
                model = h * eps * (1.0 if REGION[s] in exposure_helps_in else FACTORS["exposure"])
                rows.append({"station": s, "spot": "sp-" + s, "valid_time": "2026-11-%02dT%02d:00:00Z" % (17 + d, 3 * k),
                             "offshore_hs_m": h * 1.2, "tp_s": 9.0, "swell_from_deg": 270.0, "model_hs_m": model,
                             "obs_hs_m": h, "obs_time": "x", "factors": dict(FACTORS, total=total)})
    return rows


def _obj(rows, stamp="2026-11-18T04:00:00+00:00", graded=True):
    return {"version": 1, "generated_at": stamp, "graded": graded, "rows": rows}


def test_every_station_on_file_falls_in_one_of_the_rules_regions():
    docs = [json.load(io.open(os.path.join(DATA, f), encoding="utf-8"))
            for f in ("nearshore_validation_pairs.json", "nearshore_ndbc_pairs.json")]
    regions = sn.station_regions(docs)
    assert len(regions) >= 22 and "other" not in regions.values()
    assert regions["143p1"] == "florida_east" and regions["129p1"] == "gulf" and regions["433p1"] == "mid_atlantic"
    assert regions["254p1"] == "california" and regions["ndbc:42098"] == "gulf"
    assert sn.region_of(21.6, -158.0) == "hawaii" and sn.region_of(48.0, -124.7) == "other" and sn.region_of(None, 1) == "other"


def test_a_refused_runs_rows_are_never_mixed_in_and_the_latest_run_wins():
    r = _rows(days=1, per_day=1)[:1]
    old, new = dict(r[0], model_hs_m=9.0), dict(r[0], model_hs_m=1.0)
    refused = dict(r[0], spot="other-spot", model_hs_m=5.0)
    rows, counts = sn.usable_rows([_obj([new], "2026-11-18T10:00:00+00:00"), _obj([old], "2026-11-18T04:00:00+00:00"),
                                   _obj([refused], "2026-11-18T12:00:00+00:00", graded=False), "junk"],
                                  "2026-11-17T00:00:00", "2026-12-07T00:00:00")
    assert [x["model_hs_m"] for x in rows] == [1.0]
    assert counts == {"objects": 3, "graded": 2, "refused": 1, "rows_seen": 2, "rows_unusable": 0}


def test_rows_outside_the_window_or_without_a_usable_factor_are_dropped_and_counted():
    r = _rows(days=1, per_day=1)[0]
    bad = [dict(r, obs_hs_m=0.0), dict(r, model_hs_m=None), dict(r, factors=dict(FACTORS, kr=0.0)), dict(r, factors=None)]
    early = dict(r, valid_time="2026-11-16T23:00:00Z")
    rows, counts = sn.usable_rows([_obj(bad + [early, r])], "2026-11-17T00:00:00", "2026-12-07T00:00:00")
    assert len(rows) == 1 and counts["rows_unusable"] == 4 and counts["rows_seen"] == 6


def test_switching_a_factor_off_is_an_exact_division_and_the_unit_is_the_station_day_median():
    r = _rows(days=1, per_day=1)[0]
    rows = [dict(r, model_hs_m=m, obs_hs_m=1.0, valid_time="2026-11-17T%02d:00:00Z" % i) for i, m in enumerate((0.5, 1.0, 4.0))]
    served = sn.station_days(rows)
    assert list(served.values()) == [pytest.approx(0.0)]                         # the median row reads 1.0
    off = sn.station_days(rows, ("exposure", "kr"))
    assert list(off.values()) == [pytest.approx(-sn.math.log(0.8 * 0.873))]


def test_the_seeded_answers_come_out_as_the_rules_words():
    out = sn.analyse(_rows(), REGION)
    f = out["factors"]
    assert f["exposure_off"]["verdict"] == "REMOVE CANDIDATE"       # the chain is right without it
    assert f["shoaling_off"]["verdict"] == "KEEP"                   # 0.8 -> 0.727 of truth: worse without it
    assert f["friction_off"]["verdict"] == "NOT SHOWN"              # the factor is 1.00: no difference, inside the null
    assert f["exposure_off"]["cells"]["pooled"]["diff"] < -0.15
    assert f["exposure_off"]["cells"]["pooled"]["off_moves"] == "toward truth"
    assert f["shoaling_off"]["cells"]["pooled"]["off_moves"] == "away from truth"
    assert out["served"]["pooled"]["bias"] == pytest.approx(0.8, abs=0.02)
    assert out["positive_control"]["status"] == "OK"
    assert 1.25 <= out["positive_control"]["recovered"] <= 1.35


def test_one_region_getting_worse_blocks_remove_candidate():
    out = sn.analyse(_rows(days=12, exposure_helps_in=("mid_atlantic",)), REGION)
    f = out["factors"]["exposure_off"]
    assert f["cells"]["mid_atlantic"]["diff"] > sn.REGION_MARGIN    # there the chain is right WITH the factor
    assert f["verdict"] == "UNDECIDED"                              # better pooled, but "no region gets worse" is hard


def test_a_cell_under_the_minimum_prints_its_n_and_no_number_and_a_tiny_cell_hides_its_n():
    rows = _rows(days=6)                                            # 6 days: under the 7-day minimum everywhere
    out = sn.analyse(rows, REGION)
    assert out["served"]["pooled"] == {"score": None, "bias": None, "n": 54}
    assert all(v["verdict"] == "UNTESTABLE" for v in out["factors"].values())
    tiny = sn.analyse([r for r in rows if r["station"] == "ca1"], REGION)
    assert tiny["n_station_days"] is None and tiny["served"]["pooled"]["n"] is None
    assert sn.cell_ok([("a", "d%d" % i) for i in range(40)]) is False            # one station
    assert sn.cell_ok([(s, "d%d" % i) for s in "abc" for i in range(10)]) is True


def test_no_verdict_is_printed_when_the_positive_control_fails(monkeypatch):
    monkeypatch.setattr(sn, "CONTROL_BAND", (1.5, 1.6))
    rows = _rows()
    out = sn.analyse(rows, REGION)
    assert out["positive_control"]["status"] == "INVALID"
    text = sn.render(out, {"objects": 1, "graded": 1, "refused": 0, "rows_seen": len(rows), "rows_unusable": 0}, "a", "b")
    assert "THE TEST IS INVALID" in text and "REMOVE CANDIDATE" not in text and "KEEP" not in text


def test_the_report_carries_no_station_no_hour_and_no_row_and_says_what_it_cannot_judge():
    rows = _rows()
    counts = {"objects": 4, "graded": 3, "refused": 1, "rows_seen": len(rows), "rows_unusable": 0}
    text = sn.render(sn.analyse(rows, REGION), counts, "2026-11-17T00:00:00", "2026-12-07T00:00:00", graded_runs=5)
    for s in STATIONS:
        assert s not in text and ("sp-" + s) not in text
    assert "T03:00" not in text and "valid_time" not in text and "obs_hs_m" not in text
    assert "Gap (graded runs with no stored rows): 2" in text
    assert "NOT RUNNABLE: komar_off" in text and "NOT BUILT: sea-state split" in text
    assert "Season is UNTESTABLE" in text
    assert "NOT CHECKED" in sn.render(sn.analyse(rows, REGION), counts, "a", "b")


def test_the_same_rows_give_the_same_numbers_every_time():
    rows = _rows()
    assert sn.analyse(rows, REGION) == sn.analyse(list(reversed(rows)), REGION)


def test_the_configurations_are_the_rules_six_and_nothing_else():
    assert [c for c, _f in sn.CONFIGS] == ["served", "friction_off", "shoaling_off", "exposure_off", "refraction_off",
                                          "exposure_and_refraction_off"]
    assert (sn.SEED, sn.SHUFFLES) == (20261207, 200)
    assert (sn.MIN_UNITS, sn.MIN_DAYS, sn.MIN_STATIONS, sn.REGION_MARGIN) == (30, 7, 3, 0.02)


def test_the_real_draw_count_in_the_source_is_the_rules_2000():
    assert "DRAWS = 2000" in io.open(SRC, encoding="utf-8").read()


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
        seen.append((req.get_method(), req.full_url, dict(req.header_items())))
        if req.full_url.endswith("/object/list/weather-products"):
            day = json.loads(req.data.decode())["prefix"].split("/")[-2]
            return _Resp(json.dumps([{"name": "a.json"}, {"name": "b.json"}, {"name": "x.txt"}]
                                    if day == "2026-11-17" else []).encode())
        if req.full_url.endswith("b.json"):
            raise OSError("boom")
        return _Resp(json.dumps(_obj([])).encode())

    env = {"SUPABASE_URL": "https://example.invalid/", "SUPABASE_SERVICE_ROLE_KEY": "k"}
    objs, status = sn.fetch_objects(["2026-11-17", "2026-11-18"], env=env, opener=opener)
    assert len(objs) == 1 and status == "partial_1_failed"
    assert all(u.startswith("https://example.invalid/storage/v1/object/") for _m, u, _h in seen)
    assert [m for m, u, _h in seen if "/object/list/" not in u] == ["GET", "GET"]     # objects are only ever read
    assert sn.fetch_objects(["2026-11-17"], env={}, opener=opener) == ([], "not_configured")
    assert sn.fetch_objects(["2026-11-17"], env={"SUPABASE_URL": "http://x", "SUPABASE_SERVICE_ROLE_KEY": "k"},
                            opener=opener) == ([], "not_configured")


def test_the_process_that_holds_the_key_imports_the_standard_library_only_and_never_writes():
    tree = ast.parse(io.open(SRC, encoding="utf-8").read())
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            mods.add((node.module or "").split(".")[0])
    assert mods <= {"argparse", "json", "math", "os", "random", "sys", "urllib", "datetime"}, mods
    src = io.open(SRC, encoding="utf-8").read()
    assert "x-upsert" not in src and "PUT" not in src and "DELETE" not in src
    assert src.count('method="POST"') == 1                                       # the list call, and only it
