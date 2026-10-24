"""Static-frame parity tolerances come from each field's own encoding step, and marine u/v allow for the sea's height.

WHY (2026-10-23). The pilots publish of run 40019869501 refused 5 ICON world frames ("parity refused, nothing uploaded",
one bad node each), and continue-on-error kept the step green, so those hours silently went unpublished. The logged
dir_confidence error (0.001967) looked like the cause, but it is inside its own tolerance (half its 1/254 step,
0.0019685); four of the five frames had dir_confidence error 0.0. Every one failed the u/v check instead (0.0012 -
0.0016 against a FIXED 0.0012). The stored u/v come from the unrounded height and direction, and the frame rebuilds
them from the 0.01-deg direction, so the error grows with height (h * radians(0.005)). Measured with the real codec
over 400,000 nodes, it crosses 0.0012 at 10-12 m seas. These tests pin: every field's tolerance is half its step; a value
at the very edge of rounding passes, and one off by a whole step or by twice the bound fails; a 15 m sea on the direction
rounding edge passes the u/v check (the old fixed tolerance refuses it: the control); the old 0.0012 stays a floor.
"""
import json
import math
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import frame_binary as fb  # noqa: E402


def _node(lat, lng, h=1.5, d=200.0, period=10.0, conf=0.8, direction=None):
    """One stored vector as the normalizer writes it: speed 4 dp, direction 2 dp, u/v 4 dp from the UNROUNDED h and d."""
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "is_valid": True, "speed": round(h, 4),
            "direction": (round(d, 2) % 360.0) if direction is None else direction,
            "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4), "period": period,
            "dir_confidence": conf}


def _product(first):
    """A 2 x 2 product whose first node is `first`; the other three are ordinary."""
    nodes = [first, _node(0.0, 1.0), _node(1.0, 0.0), _node(1.0, 1.0)]
    return {"grid": {"cols": 2, "rows": 2, "vectors": nodes}, "valid_time": "2026-10-23T00:00:00Z"}


def _check(product, tamper=None):
    dec = fb.decode_frame(fb.encode_frame(product))
    if tamper:
        tamper(dec)
    return fb.parity(product, dec)


# ── every field's tolerance is its own step ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("fid", [fb.HEIGHT, fb.DIRECTION, fb.PERIOD, fb.DIR_CONFIDENCE, fb.SPEED, fb.PRESSURE_HPA])
def test_every_field_tolerance_is_half_its_own_encoding_step(fid):
    assert fb.TOLERANCE[fid] == fb.FIELD_SPECS[fid][3] / 2.0 + fb.FLOAT_SLACK


def test_the_lane_weight_tolerance_is_one_whole_step_by_its_max_one_floor():
    assert fb.TOLERANCE[fb.LANE_WEIGHT] == fb.FIELD_SPECS[fb.LANE_WEIGHT][3] + fb.FLOAT_SLACK


# ── the rounding edge passes; a whole step, or twice the bound, fails ──────────────────────────────────────────────
EDGE = {   # a source value whose quantisation error is (all but) half a step: the worst rounding can do
    fb.HEIGHT: dict(h=2.0005),                            # 2000.5 mm -> 2000: 0.0005 m off
    fb.DIRECTION: dict(d=123.455, direction=123.455),     # 12345.5 hundredths -> 0.005 deg off (u/v from the same d)
    fb.PERIOD: dict(period=9.875),                        # 987.5 hundredths -> 0.005 s off
    fb.DIR_CONFIDENCE: dict(conf=127.5 / 254.0),          # code 127.5 -> 128: half of 1/254 off (the 0.0019685 edge)
}


@pytest.mark.parametrize("fid", sorted(EDGE))
def test_a_value_on_the_rounding_edge_passes_and_a_step_or_twice_the_bound_off_fails(fid):
    first = _node(0.0, 0.0, **EDGE[fid])
    clean = _check(_product(first))
    name = fb.FIELD_NAMES[fid]
    assert clean["bad"] == 0, clean
    assert clean["max_abs_err"][name] >= fb.FIELD_SPECS[fid][3] / 2.0 - 2e-6, (
        f"the edge case must really sit on the rounding edge to test anything: {clean['max_abs_err']}")
    for off in (fb.FIELD_SPECS[fid][3], 2 * fb.TOLERANCE[fid]):
        def tamper(dec, off=off):
            dec["fields"][fid][0] += off
        assert _check(_product(first), tamper)["bad"] == 1, f"{name} off by {off} passed"


# ── marine u/v: the height term ────────────────────────────────────────────────────────────────────────────────────
def test_the_marine_uv_tolerance_grows_with_height_and_keeps_the_old_floor():
    assert fb.uv_tolerance(fb.HEIGHT, 0.0) == fb.MARINE_UV_TOL_FLOOR == 0.0012 + fb.FLOAT_SLACK
    tols = [fb.uv_tolerance(fb.HEIGHT, h) for h in (0, 5, 8, 10, 12, 15, 20)]
    assert tols == sorted(tols) and tols[-1] > 0.0012
    assert fb.uv_tolerance(fb.HEIGHT, 15.0) == pytest.approx(fb.MARINE_UV_TOL_BASE + 15.0 * math.radians(0.005), abs=1e-7)
    assert fb.uv_tolerance(fb.SPEED, 30.0) == fb.WIND_UV_TOL_BASE + fb.WIND_UV_TOL_PER_KN * 30.0   # wind unchanged


# 15 m, the unrounded direction on the 0.01-deg rounding edge, near 0 deg so the turn lands in one component (u):
# 15 * radians(0.004999) = 0.0013, past the old fixed 0.0012 and inside the new 0.00065 + 15 * radians(0.005) = 0.00196.
BIG_SEA = dict(h=15.0, d=0.004999)


def test_a_big_sea_on_the_direction_rounding_edge_passes_the_uv_check():
    got = _check(_product(_node(0.0, 0.0, **BIG_SEA)))
    assert got["bad"] == 0, got
    assert got["uv_max_err"] > 0.0012, f"the case must exceed the old fixed tolerance to test the height term: {got}"


def test_the_old_fixed_tolerance_refuses_that_big_sea(monkeypatch):
    """The control: with the height term removed (the old fixed 0.0012), the same frame is refused, as ICON's were."""
    monkeypatch.setattr(fb, "MARINE_UV_TOL_PER_M", 0.0)
    monkeypatch.setattr(fb, "MARINE_UV_TOL_BASE", 0.0)
    assert _check(_product(_node(0.0, 0.0, **BIG_SEA)))["bad"] == 1


def test_a_refusal_names_the_check_that_failed():
    """Run 40019869501 printed only max errors: dir_confidence 0.001967 (inside its tolerance) looked like the cause;
    a None-vs-value mismatch printed no number at all. The report now says which check failed, for each bad node."""
    first = _node(0.0, 0.0, **BIG_SEA)
    first["u"] = round(first["u"] + 0.01, 4)
    uv = _check(_product(first))
    assert uv["bad"] == 1 and uv["why"][0]["node"] == 0 and uv["why"][0]["fails"][0].startswith("uv: err")

    def none_vs_value(dec):
        dec["fields"][fb.DIR_CONFIDENCE][1] = 0.5
    missing = _node(0.0, 1.0, conf=None)
    p = _product(_node(0.0, 0.0))
    p["grid"]["vectors"][1] = missing
    got = _check(p, none_vs_value)
    assert got["bad"] == 1 and got["why"][0]["fails"] == ["dir_confidence: source None, frame 0.5"]
    assert "why" not in _check(_product(_node(0.0, 0.0)))


def test_the_explanations_are_capped():
    def all_wrong(dec):
        for i in range(4):
            dec["fields"][fb.PERIOD][i] += 1.0
    got = _check(_product(_node(0.0, 0.0)), all_wrong)
    assert got["bad"] == 4 and len(got["why"]) == fb.WHY_MAX


def test_a_uv_off_by_twice_its_bound_still_fails_at_any_height():
    for h in (0.5, 6.0, 15.0):
        first = _node(0.0, 0.0, h=h, d=211.0)
        off = 2 * fb.uv_tolerance(fb.HEIGHT, h)
        first["u"] = round(first["u"] + off, 4)
        assert _check(_product(first))["bad"] == 1, f"a u/v off by {off} at {h} m passed"


# ── every frame reports its errors (2026-10-24, the lead: "Every frame should log the max error per field") ─────────
def test_parity_reports_the_worst_uv_error_per_height_band():
    got = _check(_product(_node(0.0, 0.0, **BIG_SEA)))                 # one 15 m node; three at 1.5 m
    bands = got["uv_by_height_m"]
    assert list(bands) == ["0-2", "14-16"], bands
    assert bands["14-16"] == got["uv_max_err"] > 0.0012 and bands["0-2"] < bands["14-16"]
    assert fb.uv_band(0.0) == "0-2" and fb.uv_band(2.0) == "2-4" and fb.uv_band(15.9) == "14-16"


def test_a_sets_stats_fold_every_checked_frame():
    from services import frame_set as fs
    stats = {"parity_max_abs_err": {}, "uv_max_err_by_height_m": {}}
    pole = {"nodes": 6, "bad": 0, "max_abs_err": {"height_m": 0.0003}, "uv_max_err": 0.0007}
    fs.note_parity(stats, {"max_abs_err": {"height_m": 0.0004}, "uv_max_err": 0.0009, "uv_by_height_m": {"0-2": 0.0009},
                           "by_region": {"elsewhere": {"nodes": 8, "bad": 0, "max_abs_err": {"height_m": 0.0004},
                                                       "uv_max_err": 0.0009}, "polar_north": pole}})
    fs.note_parity(stats, {"max_abs_err": {"height_m": 0.0005}, "uv_max_err": 0.0013,
                           "uv_by_height_m": {"0-2": 0.0006, "14-16": 0.0013},
                           "by_region": {"polar_north": dict(pole, bad=1, uv_max_err=0.0013)}})
    assert stats == {"parity_max_abs_err": {"height_m": 0.0005, "uv": 0.0013},
                     "uv_max_err_by_height_m": {"0-2": 0.0009, "14-16": 0.0013},
                     "parity_by_region": {   # in fb.REGIONS order, each with the frames and nodes behind its maxima
                         "polar_north": {"frames": 2, "nodes": 12, "bad": 1, "max_abs_err": {"height_m": 0.0003, "uv": 0.0013}},
                         "elsewhere": {"frames": 1, "nodes": 8, "bad": 0, "max_abs_err": {"height_m": 0.0004, "uv": 0.0009}}}}
    assert list(stats["parity_by_region"]) == ["polar_north", "elsewhere"]
    assert fs.parity_line({"max_abs_err": {"height_m": 0.0005}, "uv_max_err": 0.0011}) == "height_m 0.0005 uv 0.0011"


# ── per world-frame region (2026-10-24, the lead: "report the max error per field per REGION of the world frame") ───
def test_the_regions_are_the_antimeridian_band_and_the_polar_caps():
    R = fb.frame_regions
    assert R(-17.0, 179.5) == R(-17.0, -179.5) == R(-17.0, 190.0) == ("antimeridian",)   # Fiji, either convention
    assert R(-17.0, 350.0) == ("elsewhere",)                                             # 10 W, written 0..360
    assert R(-17.0, 170.0) == ("antimeridian",) and R(-17.0, 169.9) == ("elsewhere",)    # the band edge is inside
    assert R(70.0, 6.0) == ("polar_north",) and R(-62.0, 0.0) == ("polar_south",)        # Norway; the Southern Ocean
    assert R(60.0, 0.0) == ("polar_north",) and R(59.9, 0.0) == ("elsewhere",)           # the cap edge is inside
    assert R(66.0, -170.0) == ("antimeridian", "polar_north")                            # the Bering Strait: both
    assert R(28.1, -80.6) == ("elsewhere",) and R(None, 3) == ("elsewhere",)
    assert set(fb.REGIONS) == {"antimeridian", "polar_north", "polar_south", "elsewhere"}


def _world_3x3(first_at, **first):
    """A regular 3 x 3 grid over lat -62/4/70 and lng 0/89.75/179.5: every region has nodes, and the antimeridian column
    crosses both caps. The node at `first_at` (row, col) takes `first`; the rest are ordinary 1.5 m seas."""
    lats, lngs = (-62.0, 4.0, 70.0), (0.0, 89.75, 179.5)
    nodes = [_node(lats[r], lngs[c], **(first if (r, c) == first_at else {})) for r in range(3) for c in range(3)]
    return {"grid": {"cols": 3, "rows": 3, "vectors": nodes}, "valid_time": "2026-10-23T00:00:00Z"}


def test_parity_reports_each_region_on_its_own():
    """A 15 m sea at the antimeridian (lat 4) carries the frame's worst u/v; a node off by a whole period step in the north
    cap, and one the frame drops in the south cap, are those regions' bad nodes. Each region reports its own nodes, bad
    nodes and maxima."""
    def two_bad(dec):
        dec["fields"][fb.PERIOD][6] += 1.0       # row 2 (70 N), col 0 (0 E): a value off by 100 steps
        dec["fields"][fb.HEIGHT][1] = None       # row 0 (62 S), col 1 (89.75 E): data in the source, none in the frame
    got = _check(_world_3x3((1, 2), **BIG_SEA), two_bad)
    reg = got["by_region"]
    assert list(reg) == list(fb.REGIONS), reg
    assert got["bad"] == 2 and got["missing_mismatch"] == 1
    assert {k: r["nodes"] for k, r in reg.items()} == {"antimeridian": 3, "polar_north": 3, "polar_south": 3, "elsewhere": 2}
    assert {k: r["bad"] for k, r in reg.items()} == {"antimeridian": 0, "polar_north": 1, "polar_south": 1, "elsewhere": 0}
    assert reg["antimeridian"]["uv_max_err"] == got["uv_max_err"] > 0.0012                # the big sea is only there
    assert max(reg[k]["uv_max_err"] for k in ("polar_north", "polar_south", "elsewhere")) < got["uv_max_err"]
    assert reg["polar_north"]["max_abs_err"]["period_s"] == got["max_abs_err"]["period_s"] >= 1.0
    assert all(reg[k]["max_abs_err"]["period_s"] < 0.01 for k in ("antimeridian", "polar_south", "elsewhere"))
    assert set(reg["elsewhere"]["max_abs_err"]) == set(got["max_abs_err"])                 # every field, in every region


def test_a_real_publish_reports_each_world_region(tmp_path):
    """The publish-test store's world grid (lat -60..60 by 40, lng -180..180 by 72): 8 antimeridian nodes (both edge
    columns), 6 per polar row, 8 elsewhere, in every one of the ten frames."""
    from tests.test_publish_frame_sets import TARGET, TEN, _write_store, pub
    from services import frame_set as fs
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store, valids=TEN)
    report = pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=lambda *_: None)[fs.set_key(TARGET)]
    reg = report["parity_by_region"]
    assert list(reg) == list(fb.REGIONS), reg
    assert {k: (r["frames"], r["nodes"], r["bad"]) for k, r in reg.items()} == {
        "antimeridian": (10, 80, 0), "polar_north": (10, 60, 0), "polar_south": (10, 60, 0), "elsewhere": (10, 80, 0)}
    assert all({"height_m", "direction_deg", "period_s", "dir_confidence", "uv"} <= set(r["max_abs_err"]) for r in reg.values())
    json.dumps(report)   # the report is printed as JSON (stdout and the step summary)


def test_a_real_publish_reports_every_frame_not_only_refusals(tmp_path):
    from tests.test_publish_frame_sets import TARGET, TEN, _write_store, pub
    from services import frame_set as fs
    store, out, said = tmp_path / "store", tmp_path / "out", []
    _write_store(store, valids=TEN)
    report = pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=said.append)[fs.set_key(TARGET)]
    assert report["built"] == len(TEN) and report["parity_bad"] == 0
    assert sum(1 for line in said if ": parity ok: " in line and " uv " in line) == len(TEN)
    assert {"height_m", "direction_deg", "period_s", "dir_confidence", "uv"} <= set(report["parity_max_abs_err"])
    assert report["uv_max_err_by_height_m"] and all(k.count("-") == 1 for k in report["uv_max_err_by_height_m"])


def test_a_refused_frame_still_counts_in_the_sets_error_report(tmp_path, monkeypatch):
    from tests.test_publish_frame_sets import TARGET, TEN, _write_store, pub
    from services import frame_set as fs
    store, out = tmp_path / "store", tmp_path / "out"
    _write_store(store, valids=TEN)
    real = fb.parity

    def one_refused(product, decoded):
        r = real(product, decoded)
        return dict(r, bad=1, uv_max_err=0.0099, uv_by_height_m={"14-16": 0.0099}) \
            if product["valid_time"] == TEN[1] else r
    monkeypatch.setattr(fb, "parity", one_refused)
    report = pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), log=lambda *_: None)[fs.set_key(TARGET)]
    assert report["parity_bad"] == 1
    assert report["parity_max_abs_err"]["uv"] == 0.0099 and report["uv_max_err_by_height_m"]["14-16"] == 0.0099
