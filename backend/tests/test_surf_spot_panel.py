"""The surf spot panel (scripts/surf_spot_panel.py): a fixed list read once, gently, from the deployed backend.

These pin that it cannot become a load test (health first, sequential, spaced, stops on a slow or failing backend), that
it can only GET the backend and NDBC, that the offshore height is never printed as the surf, and that the panel is the
one the rule fixed."""
import json
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import surf_spot_panel as sp  # noqa: E402

NOW = datetime(2026, 11, 16, 0, 40, tzinfo=timezone.utc)
BASE = "https://backend.example"
LATEST = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
41117     29.999  -81.079 2026 11 16 00 26  MM   MM    MM  1.4    7 4.8  61     MM    MM    MM  22.1    MM   MM     MM
41009     28.508  -80.185 2026 11 16 00 10  60  7.0   9.0  1.6    8 5.5  70 1018.0    MM  23.0  25.0    MM   MM     MM
FAKE1     29.800  -81.200 2026 11 16 00 10  60  7.0   9.0   MM   MM  MM  MM 1018.0    MM  23.0  25.0    MM   MM     MM
"""
POINT = {"point": {"speed": 1.12, "period": 7.28, "direction": 52.0}, "surf_height_m": 1.58,
         "surf_regime": "parametric_shoaling", "shelf_depth_m": 21.0, "break_depth_m": None,
         "geometry_missing": ["borrowed_shore_normal", "break_depth"], "served_valid_time": "2026-11-16T00:00:00Z"}


class Backend:
    """A fake `get`: records every url, answers health / NDBC / point, and can be told to misbehave."""

    def __init__(self, health=200, slow_at=None, fail_from=None):
        self.urls, self.health, self.slow_at, self.fail_from, self.points = [], health, slow_at, fail_from, 0

    def __call__(self, url):
        self.urls.append(url)
        if url.endswith("/api/health"):
            return self.health, "{}", 0.2
        if url == sp.NDBC_LATEST:
            return 200, LATEST, 0.3
        self.points += 1
        if self.fail_from is not None and self.points >= self.fail_from:
            raise TimeoutError("x")
        return 200, json.dumps(POINT), (30.0 if self.points == self.slow_at else 0.5)


def test_the_panel_is_the_fixed_one():
    names = [s[0] for s in sp.PANEL]
    assert len(sp.PANEL) == 30 and len(set(names)) == 30
    assert sp.PANEL[0][:3] == ("Owner point St. Augustine-Volusia", 29.77, -81.25)
    for must in ("New Smyrna Beach - Inlet", "Ponce Inlet - North Jetty", "Cocoa Beach Pier", "Duck", "Pipeline"):
        assert must in names
    assert {s[3] for s in sp.PANEL} == {"florida_east", "mid_atlantic", "california", "hawaii", "gulf"}
    assert {s[4] for s in sp.PANEL} == {"open_beach", "pier", "inlet_jetty", "point_reef"}
    assert all(-90 <= s[1] <= 90 and -180 <= s[2] <= 180 for s in sp.PANEL)


def test_only_the_backend_and_ndbc_can_be_read_and_only_by_get():
    sent = []

    def opener(req, timeout):
        sent.append((req.get_method(), req.full_url, req.data))
        raise RuntimeError("stop before the network")
    for bad in ("https://evil.example/api/weather/point", "http://backend.example/api/health", "https://supabase.co/x"):
        with pytest.raises(ValueError):
            sp.fetch(bad, BASE, opener=opener)
    assert sent == []
    for good in (BASE + "/api/health", sp.NDBC_LATEST):
        with pytest.raises(RuntimeError):
            sp.fetch(good, BASE, opener=opener)
    assert [m for m, _u, _d in sent] == ["GET", "GET"] and all(d is None for _m, _u, d in sent)


def test_an_unhealthy_backend_reads_no_spot_at_all():
    be, slept = Backend(health=503), []
    out = sp.run(BASE, NOW, get=be, sleep=slept.append)
    assert out["rows"] == [] and be.urls == [BASE + "/api/health"] and slept == []
    assert "no spot was read" in out["meta"]["stopped"] and out["meta"]["health_before"] == "status 503"


def test_a_full_run_is_sequential_spaced_and_bracketed_by_health():
    be, slept = Backend(), []
    out = sp.run(BASE, NOW, get=be, sleep=slept.append)
    assert len(out["rows"]) == 30 and be.points == 30 and out["meta"]["stopped"] is None
    assert slept == [sp.SPACING_S] * 29 and sp.SPACING_S >= 10.0
    assert be.urls[0] == be.urls[-1] == BASE + "/api/health" and be.urls[1] == sp.NDBC_LATEST and len(be.urls) == 33
    assert all("model=GFS&domain=marine&layer=waves" in u and "valid_time=2026-11-16T00%3A00%3A00Z" in u for u in be.urls[2:-1])


def test_a_slow_read_or_two_failures_in_a_row_stop_the_run():
    slow = Backend(slow_at=3)
    out = sp.run(BASE, NOW, get=slow, sleep=lambda s: None)
    assert slow.points == 3 and len(out["rows"]) == 3 and "backend is busy" in out["meta"]["stopped"]
    assert slow.urls[-1] == BASE + "/api/health"                       # health is still read at the end
    failing = Backend(fail_from=5)
    out = sp.run(BASE, NOW, get=failing, sleep=lambda s: None)
    assert failing.points == 6 and len(out["rows"]) == 4 and "two failed reads in a row" in out["meta"]["stopped"]


def test_the_row_keeps_offshore_and_surf_apart_and_carries_the_buoy_mean_period():
    stations = sp.parse_latest_obs(LATEST)
    assert [s["id"] for s in stations] == ["41117", "41009"]           # a station with no wave height is not a wave buoy
    buoy = sp.nearest_buoy(29.77, -81.25, stations)
    assert buoy["id"] == "41117" and 25 < buoy["km"] < 35 and buoy["apd_s"] == 4.8 and buoy["dpd_s"] == 7.0
    assert sp.nearest_buoy(21.66, -158.05, stations) is None            # nothing within reach
    row = sp.panel_row(sp.PANEL[0], POINT, buoy)
    assert row["offshore_hs_m"] == 1.12 and row["surf_m"] == 1.58 and row["ratio"] == 1.41 and row["surf_ft"] == 5.2
    assert row["regime"] == "parametric_shoaling" and row["geometry_missing"] == ["borrowed_shore_normal", "break_depth"]
    assert row["buoy_apd_s"] == 4.8 and row["class"] == "open_beach"
    empty = sp.panel_row(sp.PANEL[0], {"point": {"speed": 0.0}}, None)
    assert empty["ratio"] is None and empty["surf_m"] is None and empty["buoy"] is None


def test_the_table_names_the_offshore_height_as_offshore_and_gives_no_factor():
    out = sp.run(BASE, NOW, get=Backend(), sleep=lambda s: None)
    text = sp.render(out["rows"], out["meta"])
    assert "offshore Hs m" in text and "surf / offshore" in text and "OFFSHORE height" in text
    assert "| open_beach | 10 | 1.41 |" in text and "not a factor" in text
    assert text.count("\n| ") >= 30 and "backend health before: ok" in text
    assert sp.render([], {"panel_size": 30, "stopped": "x"}).startswith("## Surf spot panel")


def test_the_workflow_is_dispatch_only_and_holds_no_secret():
    path = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "surf-spot-panel.yml")
    text = open(path, encoding="utf-8").read()
    body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "workflow_dispatch" in body and "schedule" not in body and "pull_request" not in body and "push:" not in body
    assert "secrets." not in body and "contents: read" in body and "scripts/surf_spot_panel.py" in body
