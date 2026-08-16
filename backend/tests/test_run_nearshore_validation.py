"""The runner's pure discrimination logic (AV-09): HTTP 404 is a dead deployment (per-station
skip), everything else network-shaped is infra. Measured basis: 13 of the 20 pair-table stations
return a clean 404 by design — a naive any-failure-is-red rule would make the lane permanently
red on run one, and a naive always-green rule would hide a total THREDDS outage."""
import io
import urllib.error

from scripts.run_nearshore_validation import classify_station_failure


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
