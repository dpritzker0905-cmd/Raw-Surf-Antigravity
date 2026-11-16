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


# ── per-row transform factors (2026-11-16, S0 ablation gate): the report keeps only their median ──────────
def _matched_row(**over):
    row = {"station": "143p1", "spot": "A", "valid_time": "2026-11-17T06:00:00Z", "offshore_hs_m": 1.5, "tp_s": 9.0,
           "swell_from_deg": 280.0, "model_hs_m": 1.05, "obs_hs_m": 1.6, "obs_time": "2026-11-17T06:10:00Z",
           "factors": {"friction": 1.0, "shoaling": 0.94, "exposure": 0.85, "kr": 0.873, "total": 0.6975},
           "upstream_provider": "x", "model_hs_legacy_friction_m": 0.9, "n_trains": 2}
    row.update(over)
    return row


def test_factor_rows_publish_a_ratio_and_the_factors_and_no_forecast_value():
    from services.weather_pipeline.nearshore_validation import FACTOR_ROW_KEYS, factor_rows
    rows = factor_rows([_matched_row(station="b", spot="Z"), _matched_row(station="a"),
                        _matched_row(factors=None), _matched_row(station="a", valid_time="2026-11-16T03:00:00Z"),
                        _matched_row(model_hs_m=0.0), _matched_row(obs_hs_m=None)])
    # sorted; the no-factor row and the rows without a positive model and observation are skipped
    assert [(r["station"], r["day"]) for r in rows] == [("a", "2026-11-16"), ("a", "2026-11-17"), ("b", "2026-11-17")]
    assert all(tuple(r) == FACTOR_ROW_KEYS for r in rows)
    assert set(rows[0]["factors"]) == {"friction", "shoaling", "exposure", "kr", "total"}
    assert rows[0]["model_over_obs"] == round(1.05 / 1.6, 4)
    # a row is enough to undo a factor: ratio / kr is the ratio with the refraction constant off
    assert rows[0]["model_over_obs"] / rows[0]["factors"]["kr"] == round(1.05 / 1.6, 4) / 0.873
    # NO served forecast value, and no hour, leaves the run: this file is a public-repo artifact
    text = repr(rows)
    for leak in ("model_hs_m", "offshore_hs_m", "tp_s", "swell_from_deg", "obs_hs_m", "valid_time", "T06:00", "upstream_provider", "spot"):
        assert leak not in text
    assert factor_rows([]) == [] and factor_rows(None) == []


def test_the_runner_writes_the_rows_only_when_asked_and_the_report_is_untouched():
    src = inspect.getsource(R.main)
    assert '"--rows-json", default=""' in src and "if args.rows_json:" in src and "factor_rows(matched)" in src
    # the rows file is written AFTER the report and from the same matched list; the report dump itself is unchanged
    assert src.index("json.dump(report, f, indent=1)") < src.index("factor_rows(matched)")


def test_the_workflow_asks_for_the_rows_and_uploads_them():
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "nearshore-validation.yml")
    text = open(path, encoding="utf-8").read()
    assert "--json nearshore_report.json --rows-json nearshore_rows.json" in text
    assert "backend/nearshore_rows.json" in text and "backend/nearshore_report.json" in text
