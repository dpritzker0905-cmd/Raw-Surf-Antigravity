"""Publishing the HRRR wind lane (weather_pipeline/wind_lane_ingest.py, D-017).

  * GitHub Actions only: 49 HRRR steps (~233 MB of GRIB, a minute of decode) must never run on the 1-CPU Render box
    that serves the site, which can run these jobs in-process;
  * the cycle object goes up FIRST and the index LAST, so the serve box never loads a half-published cycle;
  * a malformed object is refused before anything is uploaded; a cycle already published is not re-uploaded;
  * the previous cycle is kept and the one before it deleted.
"""
import asyncio
import json

import pytest

from services.weather_pipeline import wind_lane_ingest as ING
from services.weather_pipeline.wind_lane import INDEX_KEY
from tests.test_wind_hrrr_lane import lane_obj


class Store:
    def __init__(self):
        self.ops = []

    def _upload_to_supabase(self, key, data, strict=False, overwrite=True):
        self.ops.append(("put", key, json.loads(data)))
        return True

    def _delete_from_supabase(self, key):
        self.ops.append(("del", key, None))


def run(store, obj, prev=None):
    async def fetch():
        return obj
    return asyncio.run(ING.ingest_hrrr_wind_lane(store, fetch=fetch, read_index=lambda: prev))


@pytest.fixture(autouse=True)
def on_actions(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("WIND_HRRR_LANE_INGEST", raising=False)


@pytest.mark.parametrize("actions,mode,runs", [("true", None, True), ("", None, False), ("", "force", True),
                                               ("true", "0", False)])
def test_it_runs_on_github_actions_only(monkeypatch, actions, mode, runs):
    monkeypatch.setenv("GITHUB_ACTIONS", actions)
    if mode is None:
        monkeypatch.delenv("WIND_HRRR_LANE_INGEST", raising=False)
    else:
        monkeypatch.setenv("WIND_HRRR_LANE_INGEST", mode)
    assert ING.should_run() is runs
    store = Store()
    status = run(store, lane_obj())
    assert (status["status"] == "published") is runs and bool(store.ops) is runs


def test_the_index_is_written_last_and_names_the_cycle():
    store = Store()
    status = run(store, lane_obj(), prev={"key": "wind_lane/hrrr-2026100906.json",
                                          "previous_key": "wind_lane/hrrr-2026100900.json", "hours": 49})
    kinds = [(op, key) for op, key, _ in store.ops]
    assert kinds == [("put", "wind_lane/hrrr-2026100912.json"), ("put", INDEX_KEY),
                     ("del", "wind_lane/hrrr-2026100900.json")]
    index = store.ops[1][2]
    assert index["key"] == "wind_lane/hrrr-2026100912.json" and index["previous_key"] == "wind_lane/hrrr-2026100906.json"
    assert index["cycle"] == "2026-10-09T12:00:00Z" and index["horizon"] == "2026-10-11T12:00:00Z" and index["hours"] == 49
    assert status["status"] == "published"


def test_a_cycle_already_published_is_not_uploaded_again():
    store = Store()
    status = run(store, lane_obj(), prev={"key": "wind_lane/hrrr-2026100912.json", "hours": 49})
    assert status["status"] == "unchanged" and store.ops == []


def test_a_malformed_object_is_refused_before_any_upload():
    bad = lane_obj()
    bad["format"] = "something-else"
    store = Store()
    with pytest.raises(ValueError):
        run(store, bad)
    assert store.ops == []


def test_no_cycle_publishes_nothing():
    store = Store()
    assert run(store, None)["status"] == "no_cycle" and store.ops == []


def test_the_core_ingest_lane_schedules_it_after_gfs_wind_global():
    src = open(__import__("scheduler.forecast", fromlist=["x"]).__file__, encoding="utf-8").read()
    assert src.index('("GFS Wind Global"') < src.index('("GFS Wind HRRR Lane"') < src.index('("EURO Wind Global"')
