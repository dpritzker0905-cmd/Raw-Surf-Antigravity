"""The runner's pure discrimination logic (AV-09): HTTP 404 is a dead deployment (per-station
skip), everything else network-shaped is infra. Measured basis: 13 of the 20 pair-table stations
return a clean 404 by design — a naive any-failure-is-red rule would make the lane permanently
red on run one, and a naive always-green rule would hide a total THREDDS outage."""
import inspect
import io
import urllib.error

from scripts import run_nearshore_validation as R
from scripts.run_nearshore_validation import classify_station_failure


def test_the_runner_grades_only_at_30_station_hours():
    """VA-03 (2026-10-08): GRADED needs 30 distinct buoy readings. Measured on the 9 graded 24 h-backfill
    dispatches (2026-09-27..29): 24-98 station-hours, 8 of 9 at or above 30; the one hourly run read 7."""
    assert R.GRADED_MIN_STATION_HOURS == 30
    src = inspect.getsource(R.main)
    assert "min_station_hours=GRADED_MIN_STATION_HOURS" in src, "the runner must pass its floor to build_report"
    assert "build_report(matched, n_stations" in src   # negative control: the call the assertion above reads is still there


def _http_error(code):
    return urllib.error.HTTPError("http://x", code, "msg", hdrs=None, fp=io.BytesIO(b""))


def test_404_is_a_per_station_skip_never_infra():
    assert classify_station_failure(_http_error(404)) == "skip_404"


def test_5xx_is_infra():
    assert classify_station_failure(_http_error(503)) == "infra"
    assert classify_station_failure(_http_error(500)) == "infra"


def test_urlerror_is_infra():
    assert classify_station_failure(urllib.error.URLError("dns down")) == "infra"


def test_timeout_is_infra():
    assert classify_station_failure(TimeoutError("read timed out")) == "infra"


def test_generic_exception_is_infra_not_a_skip():
    # A parse crash or anything unexpected must never be mistaken for "station has no deployment".
    assert classify_station_failure(ValueError("garbled ascii")) == "infra"
