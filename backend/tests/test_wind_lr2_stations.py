"""The v2 station freeze (advisor ruling 2026-11-23T12:45:02Z, reading (b)): the catalogue rules with NO hourly-coverage filter,
a deterministic list, fresh from the catalogues, one writer; coverage is a score-time report that never drops rows.
Offline: every reader is replaced; nothing here touches the network."""
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import wind_lr2_stations as ST  # noqa: E402
import wind_lr2_truth as T  # noqa: E402
import wind_lr_obs as O  # noqa: E402

UTC = timezone.utc
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _boom(*a, **k):
    raise AssertionError("an observation / coverage reader ran during the v2 freeze")


@pytest.fixture
def catalogue(monkeypatch):
    ndbc = [{"id": "46026", "lat": 37.75, "lon": -122.84, "type": "buoy", "name": "SF"},
            {"id": "41029", "lat": 32.8, "lon": -79.6, "type": "buoy", "name": "Capers"},
            {"id": "51001", "lat": 23.4, "lon": -162.3, "type": "buoy", "name": "NW Hawaii"},      # far from land
            {"id": "BUZM3", "lat": 41.4, "lon": -71.0, "type": "fixed", "name": "Buzzards"},
            {"id": "NOZ99", "lat": 40.0, "lon": -70.0, "type": "buoy", "name": "no height"}]
    asos = [{"id": f"K{i:03d}", "lat": 34.0 + i * 0.01, "lon": -118.0, "network": "CA_ASOS", "name": f"a{i}"} for i in range(70)]
    asos += [{"id": "KINL", "lat": 40.0, "lon": -100.0, "network": "NE_ASOS", "name": "inland"},
             {"id": "K000", "lat": 34.0, "lon": -118.0, "network": "CA_ASOS", "name": "dup"}]
    land_km = {"46026": 12.0, "41029": 30.0, "51001": 300.0, "BUZM3": 1.0, "NOZ99": 40.0}
    zs = {"46026": 5.0, "41029": 3.8, "BUZM3": 10.0, "NOZ99": None}
    monkeypatch.setattr(O, "gfs_land", lambda s, c: (None, {}))
    monkeypatch.setattr(O, "ndbc_candidates", lambda s: list(ndbc))
    monkeypatch.setattr(O, "asos_candidates", lambda s: list(asos))
    monkeypatch.setattr(O, "anemometer_m", lambda s, sid: zs.get(sid))
    def dist(mask, meta, lat, lon, box_deg=2.0):
        for sid, d in land_km.items():
            c = next((x for x in ndbc if x["id"] == sid), None)
            if c and abs(c["lat"] - lat) < 1e-9 and abs(c["lon"] - lon) < 1e-9:
                return d
        return 999.0 if lon == -100.0 else (round(abs(lat - 34.0) * 10, 3))        # ASOS: sea km grows with the index
    monkeypatch.setattr(O, "_distance_to", dist)
    return ndbc, asos


def _freeze(tmp_path, monkeypatch, name="out.json", read_at="2026-11-23"):
    monkeypatch.setattr(O, "gfs_land", lambda s, c: (np.zeros((4, 4)), {}))
    return ST.freeze(str(tmp_path / "cache"), str(tmp_path / name), read_at=read_at, session=object())


def test_no_coverage_filter_and_no_observation_file_is_read(catalogue, monkeypatch, tmp_path):
    monkeypatch.setattr(O, "hourly_coverage", _boom)
    monkeypatch.setattr(O, "ndbc_window", _boom)
    monkeypatch.setattr(O, "asos_range", _boom)
    doc = _freeze(tmp_path, monkeypatch)
    assert [s["id"] for s in doc["ndbc"]] == ["41029", "46026", "BUZM3"]          # every catalogue-rule pass, sorted by id
    assert doc["counts"]["ndbc"] == 3 and doc["counts"]["asos"] == 60            # the ASOS cap (60 nearest the sea), no coverage
    assert "NOZ99" not in {s["id"] for s in doc["ndbc"]} and "51001" not in {s["id"] for s in doc["ndbc"]}
    assert "NO hourly-coverage filter" in doc["rules"] and "window" not in doc


def test_the_old_path_still_filters_on_coverage_so_other_callers_are_unchanged(catalogue, monkeypatch, tmp_path):
    monkeypatch.setattr(O, "ndbc_window", lambda *a, **k: {})
    monkeypatch.setattr(O, "asos_range", lambda *a, **k: {})
    monkeypatch.setattr(O, "hourly_coverage", lambda *a, **k: 0.5)
    monkeypatch.setattr(O, "gfs_land", lambda s, c: (np.zeros((4, 4)), {}))
    t0 = datetime(2026, 10, 2, tzinfo=UTC)
    doc = O.select_stations(object(), str(tmp_path), t0, t0 + timedelta(days=40), str(tmp_path / "v1.json"))
    assert doc["ndbc"] == [] and doc["asos"] == []                              # 0.5 < 0.70: everything dropped, as before
    assert ">=70%" in doc["rules"]


def test_freeze_is_deterministic_hashed_regioned_and_single_write(catalogue, monkeypatch, tmp_path):
    a = _freeze(tmp_path, monkeypatch, "a.json")
    b = _freeze(tmp_path, monkeypatch, "b.json")
    assert (tmp_path / "a.json").read_bytes() == (tmp_path / "b.json").read_bytes()          # a pure function of the catalogues
    h = hashlib.sha256((tmp_path / "a.json").read_bytes()).hexdigest()
    assert a["sha256"] == b["sha256"] == h
    assert (tmp_path / "a.json.sha256").read_text().split()[0] == h
    doc = json.loads((tmp_path / "a.json").read_text())
    assert doc["asof"] == "2026-11-22" and doc["read_at"] == "2026-11-23" and doc["frozen_at"] == "2026-11-22"
    assert {s["id"]: s["region"] for s in doc["ndbc"]} == {"41029": "US_ATLANTIC_GULF", "46026": "US_PACIFIC", "BUZM3": "US_ATLANTIC_GULF"}
    assert sum(doc["counts"]["by_region"].values()) == 63
    asos = doc["asos"]
    assert [x["sea_km"] for x in asos] == sorted(x["sea_km"] for x in asos) and len({x["id"] for x in asos}) == 60
    with pytest.raises(SystemExit, match="exists"):
        ST.freeze(str(tmp_path / "cache"), str(tmp_path / "a.json"), session=object())      # written once, never re-selected


def test_an_old_freeze_file_in_the_cache_is_refused_and_never_read(catalogue, monkeypatch, tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "wind_lr_stations.json").write_text("NOT JSON: would raise if it were read")
    monkeypatch.setattr(O, "gfs_land", lambda s, c: (np.zeros((4, 4)), {}))
    with pytest.raises(SystemExit, match="old freeze file"):
        ST.freeze(str(cache), str(tmp_path / "x.json"), session=object())


def test_the_freeze_module_contains_no_coverage_machinery():
    text = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_stations.py"), encoding="utf-8").read()
    code = text.split('"""', 2)[2]                                              # past the module docstring
    for banned in ("hourly_coverage", "ndbc_window", "asos_range", "COVER", "station_ok", "coverage_report"):
        assert banned not in code, banned
    assert "coverage_filter=False" in code


def test_the_analyse_workflow_stations_command_uses_only_this_writer():
    text = open(os.path.join(ROOT, ".github", "workflows", "wind-lr2-analyse.yml"), encoding="utf-8").read()
    assert 'python scripts/wind_lr2_stations.py freeze --cache "$C" --out "$C/wind_lr2_stations.json"' in text
    assert "wind_lr_hindcast.py stations" not in text and "wind_lr_stations.json" not in text
    assert "*.json.sha256" in text                                              # the hash file rides in the artifact


# ------------------------------------------------------------------------------------------------ score-time coverage report
def _truth(hours_wind, hours_gust, start):
    out = {}
    for h in range(hours_wind):
        t = start + timedelta(hours=h)
        out[t] = (5.0, 8.0 if h < hours_gust else float("nan"), 90.0)
    return out


def test_coverage_report_is_per_station_separate_for_wind_and_gust_and_never_drops_rows():
    start, end = datetime(2026, 12, 1, tzinfo=UTC), datetime(2026, 12, 11, tzinfo=UTC)
    n = int((end - start).total_seconds() // 3600)
    full = T.coverage_report(_truth(n, n, start), start, end)
    assert full["ok_wind"] and full["ok_gust"]
    only_wind = T.coverage_report(_truth(n, 10, start), start, end)
    assert only_wind["ok_wind"] and not only_wind["ok_gust"] and only_wind["gust"] < 0.1       # GST counted separately
    thin = T.coverage_report(_truth(int(0.5 * n), int(0.5 * n), start), start, end)
    assert not thin["ok_wind"] and thin["wind"] == pytest.approx(0.5, abs=0.01)
    no_dir = {start + timedelta(hours=h): (5.0, 8.0, float("nan")) for h in range(n)}
    assert T.coverage_report(no_dir, start, end)["wind"] == 0.0                                 # WSPD and WDIR both required
    assert T.coverage_report({}, start, end) == {"wind": 0.0, "gust": 0.0, "ok_wind": False, "ok_gust": False}


def test_the_scorer_uses_coverage_for_counts_and_the_report_only():
    text = open(os.path.join(ROOT, "backend", "scripts", "wind_lr2_run.py"), encoding="utf-8").read()
    assert text.count("station_ok(") == 1 and "by_region[r] = by_region.get(r, 0) + 1" in text
    assert 'doc["station_coverage"] = cov' in text
    body = text[text.index("def cmd_score"):text.index("def cmd_pair")]
    assert body.index("rows = W.build_rows") < body.index("by_region = {}")           # rows are built BEFORE any coverage is read
