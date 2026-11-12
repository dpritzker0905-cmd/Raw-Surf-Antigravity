"""WIND_LANE_SKILL_WEIGHTS (dark, 2026-11-12): HRRR's weight in the wind lane capped by region x lead.

The flag-off lane must be byte-identical to the lane before this change (the cap code never runs); the flag-on lane
must take min(space x time, cap(region, lead)) from the checked-in table, continuous across the region ramp and in
lead, and must still taper to 0 at HRRR's horizon. Log 2026-11-12-claude-wind-lane-skill-weights.md.
"""
import ast
import json
import math
import os
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np
import pytest

from services import _hrrr_grid as hg
from services.weather_pipeline import wind_lane as WL
from services.weather_pipeline import wind_lane_skill as SK
from tests.test_wind_hrrr_lane import CYCLE, GFS_KN, HRRR_KN, GULF, lane_obj, product

BACKEND = Path(__file__).resolve().parents[1]
WEST = (34.0, -120.5)                     # Southern California bight water, space weight 1
EAST = (38.0, -72.0)                      # Atlantic off New Jersey, space weight 1
RAMP = [(40.0, x) for x in np.round(np.arange(-116.0, -101.9, 0.25), 2)]   # across the region ramp (-112 .. -106)
FEATHER = (23.5, -80.0)                   # Florida Straits, inside the 200 km feather at HRRR's south edge
NODES = [GULF, WEST, EAST, FEATHER, (15.0, -75.0)] + RAMP


@pytest.fixture
def lane(monkeypatch):
    for k in ("WIND_HRRR_LANE", "WIND_HRRR_FEATHER_KM", "WIND_HRRR_TAPER_HOURS", SK.FLAG):
        monkeypatch.delenv(k, raising=False)
    SK.table.cache_clear()
    ln = WL.Lane(lane_obj(), key="wind_lane/hrrr-2026100912.json")
    WL.install(ln)
    yield ln
    WL.install(None)
    SK.table.cache_clear()


def _weights(out, base):
    """HRRR's weight at each node, read back from the blended speed (HRRR and GFS are both uniform)."""
    return [(v.speed - b.speed) / (HRRR_KN - GFS_KN) for v, b in zip(out.grid.vectors, base.grid.vectors)]


def _served(lead, nodes=NODES):
    p = product(nodes, valid=CYCLE + timedelta(hours=lead))
    return WL.apply_wind_lane(p, "GFS", "wind", "wind"), p


# ───────────────────────────── flag off: the lane exactly as before ─────────────────────────────
@pytest.mark.parametrize("value", [None, "0", "", "true", "on", "yes"])
def test_flag_off_is_byte_identical_and_never_reaches_the_cap(lane, monkeypatch, value):
    """Only the exact "1" turns it on. Off, wind_lane_skill.cap is never called and the response, its stamp and the
    box state carry nothing new: the bytes equal the flag-unset lane, which is the lane before this change."""
    ref = {L: _served(L)[0].model_dump_json() for L in (3, 24, 47)}
    if value is not None:
        monkeypatch.setenv(SK.FLAG, value)

    def boom(*a, **k):
        raise AssertionError("the cap ran with the flag off")
    monkeypatch.setattr(SK, "cap", boom)
    for L in (3, 24, 47):
        out, _ = _served(L)
        assert out.model_dump_json() == ref[L]
        assert "skill_weights" not in out.wind_lane
    assert "skill_weights" not in WL.box_state()
    assert SK.table_id() is None


def test_flag_off_full_weight_is_the_shipped_lane(lane):
    out, base = _served(24)
    w = dict(zip(NODES, _weights(out, base)))
    assert w[GULF] == pytest.approx(1.0) and w[WEST] == pytest.approx(1.0) and w[EAST] == pytest.approx(1.0)
    assert out.wind_lane["max_weight"] == 1.0 and out.wind_lane["hrrr_full_cells"] > 0


# ───────────────────────────── flag on: the table's caps ─────────────────────────────
@pytest.mark.parametrize("lead, west, east", [(3, 0.4, 0.5), (12, 0.3, 0.6), (24, 0.2, 0.5), (36, 0.2, 0.5),
                                              (7.5, 0.35, 0.55), (30, 0.2, 0.5), (1, 0.4, 0.5)])
def test_flag_on_caps_by_region_and_lead(lane, monkeypatch, lead, west, east):
    monkeypatch.setenv(SK.FLAG, "1")
    lead_h = int(lead) if float(lead).is_integer() else None
    if lead_h is None:                       # a half hour is not a lane hour; check the cap function itself
        assert SK.cap([WEST[1]], lead)[0] == pytest.approx(west) and SK.cap([EAST[1]], lead)[0] == pytest.approx(east)
        return
    out, base = _served(lead_h)
    w = dict(zip(NODES, _weights(out, base)))
    assert w[WEST] == pytest.approx(west, abs=2e-4) and w[EAST] == pytest.approx(east, abs=2e-4)
    assert w[GULF] == pytest.approx(east, abs=2e-4)                     # the Gulf is the east table
    assert w[(15.0, -75.0)] == 0.0                                        # outside HRRR: GFS, untouched
    assert out.wind_lane["skill_weights"] == SK.table()["id"]
    assert out.wind_lane["hrrr_full_cells"] == 0 and out.wind_lane["max_weight"] <= max(west, east) + 1e-9


def test_flag_on_blends_speed_as_a_scalar_and_direction_as_a_vector(lane, monkeypatch):
    monkeypatch.setenv(SK.FLAG, "1")
    out, _ = _served(3, [EAST])
    v = out.grid.vectors[0]
    assert v.speed == pytest.approx(0.5 * HRRR_KN + 0.5 * GFS_KN, abs=1e-3)
    # HRRR from 090, GFS from 180: the blended bearing sits between, toward HRRR's larger vector
    bu, bv = 0.5 * -HRRR_KN, 0.5 * GFS_KN                 # (u, v) as stored: HRRR (-s, 0), GFS from 180 (0, +s)
    assert v.direction == pytest.approx((math.degrees(math.atan2(-bu, -bv)) + 360) % 360, abs=0.01)


def test_flag_on_box_state_names_the_table(lane, monkeypatch):
    monkeypatch.setenv(SK.FLAG, "1")
    assert WL.box_state()["skill_weights"] == "skill-v1-2026-10-15..2026-11-08"


# ───────────────────────────── region boundary: no meridian steps the field ─────────────────────────────
def test_the_region_ramp_is_continuous_and_monotone(lane, monkeypatch):
    monkeypatch.setenv(SK.FLAG, "1")
    lo, hi = SK.table()["region_ramp_lon"]
    assert (lo, hi) == (-112.0, -106.0)
    assert SK.west_share([lo - 5, lo])[0] == 1.0 and SK.west_share([lo])[0] == pytest.approx(1.0)
    assert SK.west_share([hi, hi + 5]).tolist() == pytest.approx([0.0, 0.0])
    assert SK.west_share([(lo + hi) / 2])[0] == pytest.approx(0.5)
    assert SK.west_share([360.0 + lo])[0] == pytest.approx(1.0)           # 0..360 longitudes wrap
    xs = np.arange(-120.0, -98.0, 0.01)
    for lead in (3, 24):
        c = SK.cap(xs, lead)
        assert np.all(np.diff(c) >= -1e-12) or np.all(np.diff(c) <= 1e-12)
        assert np.max(np.abs(np.diff(c))) < 0.0021                        # at most ~0.2 of cap per degree, no step
    out, base = _served(24, RAMP)
    w = _weights(out, base)
    assert w[0] == pytest.approx(0.2, abs=2e-4) and w[-1] == pytest.approx(0.5, abs=2e-4)
    assert max(abs(a - b) for a, b in zip(w, w[1:])) < 0.05


def test_lead_is_linear_between_fitted_leads_and_flat_outside(lane, monkeypatch):
    monkeypatch.setenv(SK.FLAG, "1")
    hours = np.arange(0.0, 49.0, 0.5)
    c = np.array([SK.lead_cap("west", h) for h in hours])
    assert c[0] == 0.4 and c[-1] == 0.2 and np.max(np.abs(np.diff(c))) <= 0.1 / 9 * 0.5 + 1e-12
    assert SK.lead_cap("east", 0) == 0.5 and SK.lead_cap("east", 48) == 0.5 and SK.lead_cap("east", 12) == 0.6


# ───────────────────────────── the lead taper and the space feather still win where they are lower ─────────────────────────────
@pytest.mark.parametrize("lead, w_t", [(45, 1.0), (46, 0.75), (47, 0.5), (48, 0.25)])
def test_the_time_taper_still_takes_the_weight_to_zero(lane, monkeypatch, lead, w_t):
    monkeypatch.setenv(SK.FLAG, "1")
    out, base = _served(lead)
    w = dict(zip(NODES, _weights(out, base)))
    assert w[EAST] == pytest.approx(min(w_t, 0.5), abs=2e-4)
    assert w[WEST] == pytest.approx(min(w_t, 0.2), abs=2e-4)
    assert out.wind_lane["time_weight"] == w_t


def test_past_the_horizon_the_capped_lane_is_gfs(lane, monkeypatch):
    monkeypatch.setenv(SK.FLAG, "1")
    p = product(NODES, valid=CYCLE + timedelta(hours=49))
    out = WL.apply_wind_lane(p, "GFS", "wind", "wind")
    assert out.wind_lane["reason"] == "beyond_hrrr_horizon" and out.wind_lane["skill_weights"]
    assert [v.speed for v in out.grid.vectors] == [v.speed for v in p.grid.vectors]


def test_in_the_feather_the_lower_of_space_weight_and_cap_wins(lane, monkeypatch):
    sw = float(hg.space_weight_np(np.array([FEATHER[0]]), np.array([FEATHER[1]]), 200.0)[0])
    assert 0.0 < sw < 0.5, sw                         # a node the feather already holds under the east cap
    monkeypatch.setenv(SK.FLAG, "1")
    out, base = _served(3, [FEATHER, EAST])
    w = _weights(out, base)
    assert w[0] == pytest.approx(sw, abs=2e-4) and w[1] == pytest.approx(0.5, abs=2e-4)


# ───────────────────────────── failure modes and guards ─────────────────────────────
def test_an_unreadable_table_blends_uncapped_and_never_raises(lane, monkeypatch, tmp_path):
    monkeypatch.setenv(SK.FLAG, "1")
    monkeypatch.setattr(SK, "TABLE_PATH", str(tmp_path / "missing.json"))
    SK.table.cache_clear()
    out, base = _served(24, [WEST])
    assert _weights(out, base)[0] == pytest.approx(1.0) and "skill_weights" not in out.wind_lane
    assert "skill_weights" not in WL.box_state()


@pytest.mark.parametrize("bad", [{"leads_h": [12, 3, 24, 36]}, {"w_max": {"west": [0.4, 0.3], "east": [0.5] * 4}},
                                 {"w_max": {"west": [1.4, 0.3, 0.2, 0.2], "east": [0.5] * 4}},
                                 {"region_ramp_lon": [-106.0, -112.0]}])
def test_a_malformed_table_is_refused(monkeypatch, tmp_path, bad):
    t = json.loads(Path(SK.TABLE_PATH).read_text(encoding="utf-8"))
    t.update(bad)
    p = tmp_path / "t.json"
    p.write_text(json.dumps(t), encoding="utf-8")
    monkeypatch.setattr(SK, "TABLE_PATH", str(p))
    SK.table.cache_clear()
    try:
        with pytest.raises(ValueError):
            SK.table()
    finally:
        SK.table.cache_clear()


def test_the_checked_in_table_records_its_fit():
    t = json.loads(Path(SK.TABLE_PATH).read_text(encoding="utf-8"))
    assert t["leads_h"] == [3, 12, 24, 36] and set(t["w_max"]) == {"west", "east"}
    assert all(n >= 300 for reg in t["n"].values() for n in reg)       # every cell clears the n rule
    assert "2026-10-15" in t["fit"]["window"] and "2026-11-08" in t["fit"]["window"] and t["fit"]["split"]
    held = t["held_out_vec_rmse_kt"]
    for reg in ("west", "east"):                                        # the table's own claim: beats both, held out
        assert all(b < g and b < ln for b, g, ln in zip(held[reg]["blend"], held[reg]["gfs"], held[reg]["lane"]))


def test_only_the_lane_reads_the_skill_table():
    """Spot points, ratings, glyphs and the sim must never read the cap (D-001: it moves the drawn map only)."""
    readers = []
    for path in list(BACKEND.glob("routes/**/*.py")) + list(BACKEND.glob("services/**/*.py")) + [BACKEND / "server.py"]:
        if ".venv" in path.parts or path.name == "wind_lane_skill.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig", errors="ignore"))
        for n in ast.walk(tree):
            names = ([n.module or ""] + [a.name for a in n.names]) if isinstance(n, ast.ImportFrom) else (
                [a.name for a in n.names] if isinstance(n, ast.Import) else [])
            if any(x.endswith("wind_lane_skill") for x in names):
                readers.append(path.relative_to(BACKEND).as_posix())
                break
    assert readers == ["services/weather_pipeline/wind_lane.py"], readers


def test_the_frames_publisher_pins_the_flag_off(monkeypatch):
    from services import frame_set_wind as fsw
    monkeypatch.setenv(SK.FLAG, "1")
    assert SK.FLAG in fsw.pin_code_defaults(log=lambda *_: None)
    assert SK.FLAG not in os.environ and not SK.enabled()


def test_the_flag_is_registered_dark_and_covered_by_the_guardrail():
    src = (BACKEND / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    reg = next(n.value for n in ast.walk(ast.parse(src)) if isinstance(n, ast.Assign)
               and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in n.targets))
    entries = {k.value: ast.literal_eval(v) for k, v in zip(reg.keys, reg.values)}
    assert entries[SK.FLAG][0] == "0" and "Render env" in entries[SK.FLAG][2]
    sys.path.insert(0, str(BACKEND / "scripts"))
    try:
        import flag_guardrail as fg
    finally:
        sys.path.remove(str(BACKEND / "scripts"))
    assert fg.coverage(SK.FLAG)[0] == fg.BLIND


# ───────────────────────────── the sweep that fitted the table ─────────────────────────────
def test_the_sweep_recovers_a_known_weight(tmp_path):
    """Synthetic truth = 0.3 x lane + 0.7 x GFS (vector): the odd-cycle fit must find 0.3 and beat both on even cycles."""
    sys.path.insert(0, str(BACKEND / "scripts"))
    try:
        import sweep_wind_lane_weight as sw
    finally:
        sys.path.remove(str(BACKEND / "scripts"))
    rng = np.random.default_rng(7)
    rows = []
    for day in range(1, 21):
        for hh in (0, 6, 12, 18):
            for b in range(12):
                ls, ld = rng.uniform(5, 20), rng.uniform(0, 360)
                gs, gd = rng.uniform(5, 20), rng.uniform(0, 360)
                lu, lv = sw._uv(np.array([ls]), np.array([ld]))
                gu, gv = sw._uv(np.array([gs]), np.array([gd]))
                bu, bv = 0.3 * lu[0] + 0.7 * gu[0], 0.3 * lv[0] + 0.7 * gv[0]
                sp = 0.3 * ls + 0.7 * gs
                od = (math.degrees(math.atan2(-bu, -bv)) + 360) % 360
                for lead in sw.LEADS:
                    rows.append({"cycle": f"202610{day:02d}{hh:02d}", "lead": lead, "zone": "full", "coastal": b % 2 == 0,
                                 "coast": ("East", "West", "Gulf")[b % 3], "obs_kt": sp, "obs_dir": od,
                                 "lane_kt": ls, "lane_dir": ld, "gfs_kt": gs, "gfs_dir": gd})
    published, table = sw.sweep(rows)
    assert table and all(c["w"] == pytest.approx(0.3) and c["beats_both"] for c in table)
    assert {c["region"] for c in table} == {"west", "east"}
