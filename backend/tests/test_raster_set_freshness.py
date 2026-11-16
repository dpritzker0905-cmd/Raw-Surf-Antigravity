"""The data-health monitor's raster frame-set check (2026-11-16): a raster set that is switched on must be listed in the public
latest.json with a run younger than the stale bound; a failed publish keeps the old index, so staleness is the visible symptom."""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_raster_frames as prf  # noqa: E402
import raster_set_freshness as rsf  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

NOW = datetime(2026, 11, 16, 12, tzinfo=timezone.utc)
KEY = fs.set_key(fsr.SPECS["precipitation_icon_0p125"]["target"])
ENV = fsr.SPECS["precipitation_icon_0p125"]["env"]


def test_only_sets_switched_on_are_expected_and_default_on_sets_count():
    exp = rsf.expected_sets({ENV: "1", fsr.SPECS["precipitation_icon"]["env"]: "0"})
    assert exp["precipitation_icon_0p125"] == KEY and "precipitation_icon" not in exp
    defaults = {n for n, sp in fsr.SPECS.items() if sp.get("default_on")}
    assert set(exp) == defaults | {"precipitation_icon_0p125"}


def test_fresh_stale_and_missing():
    on = {ENV: "1"}
    fresh = {"sets": {KEY: {"run": "2026-11-16T00:00:00Z"}}}
    stale = {"sets": {KEY: {"run": "2026-11-14T12:00:00Z"}}}
    verdict = lambda latest: {n: v for n, _k, v, _d in rsf.check(latest, on, NOW)}["precipitation_icon_0p125"]   # noqa: E731
    assert verdict(fresh) == "ok" and verdict(stale) == "stale" and verdict({"sets": {}}) == "missing"
    assert verdict({"sets": {KEY: {}}}) == "stale"


def test_a_failed_raster_publish_is_an_error_annotation_and_a_non_zero_exit(monkeypatch, capsys):
    monkeypatch.setenv(ENV, "1")
    monkeypatch.setattr(prf.fsr, "make_source", lambda spec: object())
    monkeypatch.setattr(prf.fsr, "publish", lambda *a, **k: {"status": "coverage_refused", "built": 0})
    rc = prf.main(["--set", "precipitation_icon_0p125", "--out-dir", str(Path("unused"))])
    out = capsys.readouterr().out
    assert rc == 1 and "::error title=Raster set precipitation_icon_0p125 not published::status coverage_refused" in out
    monkeypatch.setattr(prf.fsr, "publish", lambda *a, **k: {"status": "no_cycle"})
    assert prf.main(["--set", "precipitation_icon_0p125", "--out-dir", "unused"]) == 0      # upstream not ready: not a failure


def test_the_monitor_runs_the_check_and_pages_on_stale():
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "data-health-monitor.yml").read_text(encoding="utf-8")
    step = wf[wf.index("- name: Raster frame-set freshness"):wf.index("- name: Regional product run-age census")]
    assert "RASTER_VARS_JSON: ${{ toJSON(vars) }}" in step and "raster_set_freshness.py" in step and "--fail-on-stale" in step
