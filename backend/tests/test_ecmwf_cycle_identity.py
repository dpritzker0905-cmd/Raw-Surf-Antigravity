"""
F-05 (audit 14.0; re-measured in 15.0): EURO products must say which ECMWF run they come from.

Census of the live manifest, 2026-09-25: model_run_time was "missing" on 5,678 of 5,769 EURO
products (98.4%). The ECMWF open-data client resolves the latest cycle itself and the fetcher
dropped it; every GRIB message carries its analysis time. The fetcher now stamps one consistent
analysis time on its points — the same `__model_run_time` contract the NOAA and DWD fetchers use,
read by `cycle_provenance.cycle_from_points`.
"""
from datetime import datetime, timezone

from services import ecmwf_opendata_fetcher as f
from services.weather_pipeline.cycle_provenance import cycle_from_points
from tests.test_ecmwf_period_bands_decode import _FakeMsg, _install, _payload, _T0, _T1

RUN_00Z = datetime(2026, 8, 2, 0, 0, 0)      # pygrib's analDate is a naive UTC datetime
RUN_12Z = datetime(2026, 8, 1, 12, 0, 0)


class _RunMsg(_FakeMsg):
    def __init__(self, short_name, valid_date, fill, anal_date):
        super().__init__(short_name, valid_date, fill)
        self.analDate = anal_date


def _msgs(anal0, anal1):
    return [_RunMsg("swh", _T0, 2.0, anal0), _RunMsg("mwd", _T0, 270.0, anal0),
            _RunMsg("swh", _T1, 3.0, anal1), _RunMsg("mwd", _T1, 280.0, anal1)]


def test_one_run_is_stamped_on_every_point_and_reads_as_a_known_cycle(monkeypatch):
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    _install(monkeypatch, _msgs(RUN_00Z, RUN_00Z))
    points, ok, _failed, _times = f.fetch_global_coarse(_payload())
    assert points and ok
    assert {p["__model_run_time"] for p in points} == {"2026-08-02T00:00:00+00:00"}
    cycle = cycle_from_points(points)
    assert cycle["model_run_time_status"] == "known"
    assert cycle["model_run_time"] == datetime(2026, 8, 2, 0, 0, tzinfo=timezone.utc)


def test_messages_from_two_runs_claim_no_cycle(monkeypatch):
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    _install(monkeypatch, _msgs(RUN_00Z, RUN_12Z))
    points, ok, _failed, _times = f.fetch_global_coarse(_payload())
    assert points and ok
    assert not any("__model_run_time" in p for p in points)
    assert cycle_from_points(points)["model_run_time_status"] == "missing"


def test_messages_without_an_analysis_time_are_unchanged(monkeypatch):
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    _install(monkeypatch, [_FakeMsg("swh", _T0, 2.0), _FakeMsg("mwd", _T0, 270.0),
                           _FakeMsg("swh", _T1, 3.0), _FakeMsg("mwd", _T1, 280.0)])
    points, ok, _failed, _times = f.fetch_global_coarse(_payload())
    assert points and ok
    assert not any("__model_run_time" in p for p in points)
