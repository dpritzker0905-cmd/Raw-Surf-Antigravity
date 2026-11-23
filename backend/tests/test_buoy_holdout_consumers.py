"""RUNTIME canaries for the #1199 LOCKED fence (amendment 3): with a planted, VERIFIED locked list, real consumers from
every family never request a locked buoy and drop its rows at load, while an unlocked buoy goes through untouched.
The static guard (test_buoy_holdout_guard.py) proves every reader calls the fence; these prove the calls work."""
import asyncio
import gzip
import hashlib
import json
import os
import sys

import pytest

from services import buoy_holdout as bh

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
LOCKED, OPEN = "46025", "41004"


@pytest.fixture
def locked_root(tmp_path, monkeypatch):
    raw = (json.dumps({"seed": 1199, "locked": [LOCKED]}) + "\n").encode("utf-8")
    lp = tmp_path / "docs/weather-program/gates/served-wave-skill-v1-locked.json"
    lp.parent.mkdir(parents=True, exist_ok=True)
    lp.write_bytes(raw)
    doc = {"holdout": {"locked_list": {"path": "docs/weather-program/gates/served-wave-skill-v1-locked.json",
                                       "sha256": hashlib.sha256(raw).hexdigest()}},
           "stations": [{"id": LOCKED, "wmo_id": LOCKED, "locked": True}, {"id": OPEN, "wmo_id": OPEN, "locked": False}]}
    (tmp_path / bh.BUOY_LIST).write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv(bh.ENV_ROOT, str(tmp_path))
    bh.reset_cache()
    assert bh.state()["status"] == "verified"
    yield tmp_path
    bh.reset_cache()


def test_skill_ledger_calibration_fetch_never_requests_a_locked_buoy(locked_root):
    from services.weather_pipeline import buoy_calibration as bc
    asked = []

    class Client:
        async def get(self, url):
            asked.append(url)

            class R:
                status_code, text = 404, ""
            return R()
    assert asyncio.run(bc.fetch_ndbc_latest(LOCKED, client=Client())) is None
    assert asked == []
    asyncio.run(bc.fetch_ndbc_latest(OPEN, client=Client()))
    assert len(asked) == 1 and OPEN in asked[0]


def test_scored_archive_rows_of_a_locked_buoy_are_dropped_at_load(locked_root):
    from datetime import date

    from services.weather_pipeline import skill_scored_archive as ssa
    rows, _ = ssa.read_month("2026-11", date(2026, 11, 3),
                             lambda key: ([{"buoy_id": LOCKED, "x": 1}, {"buoy_id": OPEN, "x": 2}], True))
    assert rows and {r["buoy_id"] for r in rows} == {OPEN}


def test_eval_harness_http_get_refuses_a_locked_url(locked_root):
    from services.weather_pipeline import eval_provenance as ep
    with pytest.raises(FileNotFoundError):
        ep.http_get(f"https://www.ndbc.noaa.gov/data/realtime2/{LOCKED}.txt")


def test_long_range_wind_truth_never_reads_a_locked_buoy(locked_root, monkeypatch, tmp_path):
    import wind_lr_obs as O

    def boom(*a, **k):
        raise AssertionError("a locked buoy was fetched")
    monkeypatch.setattr(O, "_get", boom)
    assert O.ndbc_window(None, str(tmp_path), LOCKED) == {}


def test_partition_truth_spectra_get_returns_none_for_a_locked_buoy(locked_root, monkeypatch):
    from scripts.partition_truth import ndbc_spectra as ns

    def boom(*a, **k):
        raise AssertionError("a locked buoy was fetched")
    monkeypatch.setattr(ns.urllib.request, "urlopen", boom)
    assert ns.get(f"https://www.ndbc.noaa.gov/data/realtime2/{LOCKED}.data_spec", f"{LOCKED}.data_spec") is None


def test_gust_verify_scorer_drops_a_locked_station_at_load(locked_root, tmp_path):
    import gust_verify_score as gs
    d = tmp_path / "gv"
    (d / "obs").mkdir(parents=True)
    with gzip.open(d / "obs" / "20261120_ndbc.json.gz", "wt", encoding="utf-8") as fh:
        json.dump({"stations": {LOCKED: [[1, 5.0, 7.0]], OPEN: [[1, 4.0, 6.0]]}}, fh)
    assert set(gs.load_obs(str(d))) == {OPEN}


def test_nothing_is_dropped_when_no_list_is_recorded():
    bh.reset_cache()
    assert bh.state()["status"] == "none"
    from services.weather_pipeline import skill_scored_archive as ssa
    from datetime import date
    rows, _ = ssa.read_month("2026-11", date(2026, 11, 3), lambda key: ([{"buoy_id": LOCKED}], True))
    assert rows and all(r["buoy_id"] == LOCKED for r in rows)


def test_nearshore_lite_truth_fetch_never_requests_a_locked_buoy(locked_root):
    """The MOP-lite gate's truth reader (nearshore_lite/truth.py, #1155) scores what it fetches: a LOCKED buoy reads as
    missing and the opener is never called; an open buoy is fetched as before."""
    from services.weather_pipeline.nearshore_lite import truth
    asked = []
    assert truth.fetch_realtime(LOCKED, lambda u: asked.append(u) or "text") is None
    assert truth.fetch_realtime(OPEN, lambda u: asked.append(u) or "text") == "text"
    assert asked == [truth.realtime_url(OPEN)]
