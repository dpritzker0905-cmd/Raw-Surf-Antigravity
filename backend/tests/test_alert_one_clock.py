"""O2 (Fable audit 2026-11-10, LT-4 + LT-8): ONE clock per alert, and the 50-km snap cliff is never silent.

LT-4: phase 1 chose alert windows on the solar clock and printed them on the civil one; in Lisbon in winter (solar -1,
civil 0) the printed window was not the window checked. Now `AlertClock` drives eligibility, the midnight split, the
daily cap and the message together: civil when location_time knows the zone, solar (unchanged) otherwise.
LT-8: where a coast zone and the nautical zone beyond the 50-km snap differ by >= 3 h, the cells on both sides of the
line carry near_border + alt_iana (build_location_tz_grid.mark_nautical_edges). The ALERTS flag is never touched here.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from services import runtime_flags as rf
from services import surf_alert_windows as saw
from services.weather_pipeline import location_time as lt
from tests.location_time_testgrid import write_grid

LISBON = (38.7, -9.4)       # civil Europe/Lisbon (UTC+0 in winter), solar round(-9.4/15) = -1
APIA = (-13.8, -171.8)      # civil Pacific/Apia (+13), solar -11: a different DATE
WINTER = datetime(2026, 1, 14, 3, 0, tzinfo=timezone.utc)


@pytest.fixture()
def grid(tmp_path, monkeypatch):
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    monkeypatch.setattr(lt, "DATA_DIR", write_grid(str(tmp_path / "g")))
    yield
    lt.reset_for_tests()
    rf._reset_for_tests()


def _flag(monkeypatch, on):
    monkeypatch.setenv("LOCATION_TIME_FIELD", "1" if on else "0")


def _series(start, hours=48):
    return [(start + timedelta(hours=h), {"surf_height_m": 1.2, "score": 70, "level": "good", "period_s": 12})
            for h in range(hours)]


def _alert(windows):
    return SimpleNamespace(min_wave_height=None, max_wave_height=None, time_windows=windows, tide_states=[],
                           preferred_conditions=[])


def _t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@pytest.mark.parametrize("on", [False, True])
def test_lisbon_winter_the_window_checked_is_the_window_printed(grid, monkeypatch, on):
    _flag(monkeypatch, on)
    spot = SimpleNamespace(latitude=LISBON[0], longitude=LISBON[1])
    found = saw.find_windows(_alert(["morning"]), spot, _series(WINTER), WINTER, 30)
    w = found["windows"][0]
    # morning = 08-12 on the alert's clock: 08-12 UTC on Lisbon's civil clock, 09-13 UTC on the solar one.
    assert (w["start"], w["end"]) == (("2026-01-14T08:00:00Z", "2026-01-14T12:00:00Z") if on
                                      else ("2026-01-14T09:00:00Z", "2026-01-14T13:00:00Z"))
    assert w["clock"] == ("civil" if on else "solar")
    assert saw.window_message("Carcavelos", w) == "Good window at Carcavelos: Wed 08:00-12:00, 4 ft, good"
    # The phase-1 defect, stated so it cannot return: solar hours 09-13 UTC printed in civil time read 09:00-13:00,
    # outside the "morning" band the user picked.
    z = ZoneInfo("Europe/Lisbon")
    t = _t(w["start"])
    while t < _t(w["end"]):
        hour = t.astimezone(z).hour if on else (t + timedelta(hours=-1)).hour
        assert saw.in_time_windows(hour, ["morning"])
        t += timedelta(hours=1)


def test_lisbon_summer_follows_daylight_saving(grid, monkeypatch):
    """In July Lisbon is WEST (UTC+1), 2 h from its solar clock (-1): "morning" is 07-11 UTC, printed 08:00-12:00."""
    summer = datetime(2026, 7, 14, 3, 0, tzinfo=timezone.utc)
    spot = SimpleNamespace(latitude=LISBON[0], longitude=LISBON[1])
    _flag(monkeypatch, True)
    w = saw.find_windows(_alert(["morning"]), spot, _series(summer), summer, 30)["windows"][0]
    assert (w["start"], w["end"]) == ("2026-07-14T07:00:00Z", "2026-07-14T11:00:00Z")      # 08-12 WEST
    assert (w["local_start"], w["local_end"]) == ("08:00", "12:00")


def test_apia_the_day_printed_is_the_apia_day(grid, monkeypatch):
    """Apia (+13) and its solar clock (-11) are exactly 24 h apart: the same hours, a different DATE."""
    _flag(monkeypatch, True)
    now = datetime(2026, 11, 10, 20, 0, tzinfo=timezone.utc)           # Apia: Wed 11-11 09:00; solar: Tue 11-10
    spot = SimpleNamespace(latitude=APIA[0], longitude=APIA[1])
    w = saw.find_windows(_alert([]), spot, _series(now.replace(minute=0)), now, 30)["windows"][0]
    assert w["civil_iana"] == "Pacific/Apia" and w["clock"] == "civil"
    assert w["local_day"] == _t(w["start"]).astimezone(ZoneInfo("Pacific/Apia")).strftime("%a")
    assert saw.window_message("Apia", w).split(": ", 1)[1].startswith(w["local_day"])
    _flag(monkeypatch, False)
    w_off = saw.find_windows(_alert([]), spot, _series(now.replace(minute=0)), now, 30)["windows"][0]
    assert "civil_iana" not in w_off and w_off["clock"] == "solar"     # flag off: solar, exactly as before


def test_lisbon_winter_daily_cap_counts_the_civil_day(grid, monkeypatch):
    _flag(monkeypatch, True)
    spot = SimpleNamespace(latitude=LISBON[0], longitude=LISBON[1])
    w = saw.find_windows(_alert(["morning"]), spot, _series(WINTER), WINTER, 30)["windows"][0]
    sent = [datetime(2026, 1, 14, 0, 30, tzinfo=timezone.utc)]          # civil 01-14 00:30 (today); solar 01-13 23:30
    assert saw.sends_today(sent, WINTER, w["local_offset_h"], w["civil_iana"]) == 1
    assert saw.sends_today(sent, WINTER, w["local_offset_h"]) == 0     # the solar clock put it on yesterday
    monkeypatch.setenv("ALERTS_WINDOW_SUPPRESSION", "1")
    monkeypatch.setenv("ALERTS_MAX_PER_USER_DAY", "1")
    assert saw.admit(w, [], sent, WINTER) == (False, "daily_cap")      # admit reads the window's own clock


def test_collapse_relabels_on_the_window_clock(grid, monkeypatch):
    _flag(monkeypatch, True)
    spot = SimpleNamespace(latitude=LISBON[0], longitude=LISBON[1])
    w = saw.find_windows(_alert(["morning"]), spot, _series(WINTER), WINTER, 30)["windows"][0]
    later = (_t(w["end"]) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    m = saw.collapse_windows([w, dict(w, start=w["end"], end=later)], 1)[0]
    assert m["local_end"] == m["civil_end"] == "14:00"


# ── LT-8: the nautical edge, on the REAL committed grid ─────────────────────────────────────────────────────────────
def test_probe_off_apia_the_snap_cliff_carries_a_note_on_both_sides(monkeypatch):
    """Walk north from Apia (lng -171.765) cell by cell to the coast_snap / nautical cliff (~50 km offshore)."""
    rf._reset_for_tests(lambda: None)
    lt.reset_for_tests()
    at = datetime(2026, 11, 10, 20, 0, tzinfo=timezone.utc)
    rows = [lt.describe(-13.805 + k * 0.01, -171.765, at, force=True) for k in range(0, 120)]
    lt.reset_for_tests()
    rf._reset_for_tests()
    cliff = [k for k in range(1, len(rows)) if rows[k]["iana"] != rows[k - 1]["iana"]]
    assert len(cliff) == 1, [r["iana"] for r in rows]
    k = cliff[0]
    coast, sea = rows[k - 1], rows[k]
    assert (coast["iana"], coast["source"]) == ("Pacific/Apia", "coast_snap")
    assert (sea["iana"], sea["source"]) == ("Etc/GMT+11", "nautical")
    assert coast["local_date"] != sea["local_date"]                    # the 24 h cliff the note is for
    assert coast["near_border"] and coast["alt_iana"] == "Etc/GMT+11" and coast["alt_utc_offset_min"] == -660
    assert sea["near_border"] and sea["alt_iana"] == "Pacific/Apia" and sea["alt_utc_offset_min"] == 780
    for r in rows[:k - 1] + rows[k + 1:]:                              # one cell (~1.1 km) each side, as near_border
        assert not r["near_border"], r


def test_the_edge_pass_marks_only_large_gaps_and_both_sides():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
    from build_location_tz_grid import mark_nautical_edges
    classes = [("Pacific/Apia", "coast_snap", False, "", 40), ("Etc/GMT+11", "nautical", False, "", -1),
               ("Europe/Lisbon", "coast_snap", False, "", 40), ("Etc/GMT+1", "nautical", False, "", -1)]
    # One row, no wrap artefact (both ends Lisbon): Lisbon | Apia | GMT+11 | GMT+1 | Lisbon.
    # Apia/GMT+11 differ by 24 h -> marked both sides; GMT+1/Lisbon differ by 1-2 h -> not marked.
    g = np.array([[2, 2, 0, 0, 0, 1, 1, 1, 3, 3, 3, 2, 2]] * 3)
    rp, st, ids, cls, n = mark_nautical_edges(lambda i: g[i], 3, classes, log=lambda m: None)
    row = np.repeat(ids[rp[1]:rp[2]], np.diff(np.append(st[rp[1]:rp[2]].astype(int), 13)))
    got = [(cls[c][0], cls[c][2], cls[c][3]) for c in row]
    assert got[4] == ("Pacific/Apia", True, "Etc/GMT+11") and got[5] == ("Etc/GMT+11", True, "Pacific/Apia")
    assert got[3] == ("Pacific/Apia", False, "") and got[6] == ("Etc/GMT+11", False, "")   # one cell from the line
    assert not got[10][1] and not got[11][1]                           # GMT+1 | Lisbon: ordinary gap, no note
    assert n == 2 * 3
