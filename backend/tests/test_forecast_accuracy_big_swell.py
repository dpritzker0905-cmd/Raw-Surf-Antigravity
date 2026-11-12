"""The Forecast Accuracy Monitor's big-swell table by coast (2026-11-12, ledger commitment 217's successor).

PRINT ONLY: the table never enters the verdict. Split out of test_forecast_accuracy_monitor.py (the 800-line LOC
limit); it reuses that file's helpers so both files drive main() the same way."""
from datetime import timedelta

import pytest

from scripts.forecast_accuracy_monitor import OK, big_swell_by_region_lines
from services.weather_pipeline.skill_consensus import MEMBERS, consensus_report
from tests.test_forecast_accuracy_monitor import NOW, _main, _report


# --- the big-swell table by coast (2026-11-12, commitment 217's successor): PRINT ONLY, never in the verdict ---------


def _ledger_rows():
    """Scored rows in the ledger's shape, held-out week: pacific_ne (46221) calls big 12 times at +24 h, every member
    0.3 m over the buoy; atlantic_ne (44013) calls big 3 times (a thin cell); atlantic_se (41110) never calls big. Fed
    through the REAL consensus_report, so the monitor reads the block's true shape, not a hand-made copy of it."""
    rows = []
    for buoy, hours, fc, obs in (("46221", 12, 3.5, 3.2), ("44013", 3, 3.4, 3.0), ("41110", 12, 1.0, 1.1)):
        for h in range(hours):
            t = (NOW - timedelta(hours=2 * h + 1)).isoformat()
            for src in MEMBERS:
                rows.append({"source": src, "buoy_id": buoy, "target_time": t, "lead_h": 24, "hs_m": fc, "obs_hs_m": obs})
    return rows


def _with_big_swell(report=None):
    return {**(report or _report()), "forecast_skill_consensus": consensus_report(_ledger_rows(), NOW)}


def test_the_big_swell_table_prints_each_coast_lead_and_band_with_n(monkeypatch, capsys):
    code, out = _main(monkeypatch, capsys, _with_big_swell())
    assert code == OK and "verdict: OK" in out
    assert "big-swell +24h fc>=3.0m pacific_ne: served bias +0.300 mae 0.300 n 12 | equal bias +0.300 mae 0.300 n 12" in out
    assert "big-swell +24h fc>=3.0m atlantic_ne: served n 3 (thin, not shown) | equal n 3 (thin, not shown)" in out
    assert "big-swell +24h fc>=3.0m all coasts: served bias +0.320 mae 0.320 n 15" in out   # (12 x 0.3 + 3 x 0.4) / 15
    assert "atlantic_se" not in out.split("big-swell by coast")[1]    # a coast that never called big has no line
    assert all("%" not in line for line in out.splitlines() if line.startswith("big-swell"))


def test_an_absent_big_swell_block_never_fails_the_monitor(monkeypatch, capsys):
    code, out = _main(monkeypatch, capsys, _report())
    assert code == OK and "verdict: OK" in out
    assert out.count("big-swell by coast: NOT AVAILABLE (report carries no forecast_skill_consensus block)") == 1
    assert "::warning::big-swell" not in out and "::error::big-swell" not in out


@pytest.mark.parametrize("report", [
    lambda: _report(), lambda: _report(mae=0.45), lambda: _report(n=5), lambda: None,
], ids=["green", "red", "refused", "unreachable"])
def test_the_table_never_moves_the_verdict(monkeypatch, capsys, report):
    base = report()
    off = _main(monkeypatch, capsys, base, env={"ACCURACY_BIG_SWELL_TABLE": "0"})
    on = _main(monkeypatch, capsys, _with_big_swell(base) if base else None)
    assert on[0] == off[0]
    assert "big-swell" not in off[1] and "big-swell by coast" in on[1]


@pytest.mark.parametrize("block", [
    {"by_lead": "nope"}, {"by_lead": [{"lead_h": 24, "big_swell": "x"}]},
    {"by_lead": [{"lead_h": 24, "big_swell": {"threshold_m": 3.0, "by_forecast": None, "by_forecast_by_region": 7}}]},
    {"by_lead": [{"lead_h": 24, "big_swell": {"threshold_m": 3.0, "by_forecast_by_region": {
        "pwned\n::error::x %": {"raw_surf": {"n": 99, "bias_m": 1.0, "mae_m": 1.0}},
        "hawaii": {"raw_surf": {"n": "12", "bias_m": "a"}, "equal": {"n": 40, "bias_m": float("nan"), "mae_m": 1.0}}}}}]},
], ids=["leads-not-a-list", "block-not-a-dict", "regions-not-a-dict", "hostile-and-malformed-cells"])
def test_a_malformed_block_is_one_quiet_line_never_a_crash(block, monkeypatch, capsys):
    lines = big_swell_by_region_lines({**_report(), "forecast_skill_consensus": block})
    text = "\n".join(lines)
    assert lines and "pwned" not in text and "::error" not in text and "%" not in text
    code, out = _main(monkeypatch, capsys, {**_report(), "forecast_skill_consensus": block})
    assert code == OK and "verdict: OK" in out
