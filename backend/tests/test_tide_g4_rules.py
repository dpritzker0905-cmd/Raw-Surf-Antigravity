"""G4 design jobs (offline; docs/weather-program/log/2026-11-15-claude-tide-m1.md: G4 DRAFT, addendum 1, item 6, and
the advisor's FINAL edits of 2026-11-18). Pins the power check (stretches never bridge a held-out week, the pass line,
the share, the length it fixes, and that it prints ONLY the share and scores ONLY A+M against D), the reference archive
(nothing before START, first value seen kept, no silent fresh archive, references only, cumulative 90-day artifact),
the workflows' triggers and credentials, and that nothing served imports any of it."""
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts" / "tide_g4"))
import g4_rules as R4                                    # noqa: E402

POWER = (BACKEND / "scripts" / "tide_g4" / "g4_power.py").read_text(encoding="utf-8")
ARCHIVE = (BACKEND / "scripts" / "tide_g4" / "g4_archive.py").read_text(encoding="utf-8")
WF_POWER = (BACKEND.parent / ".github" / "workflows" / "tide-g4-power.yml").read_text(encoding="utf-8")
WF_ARC = (BACKEND.parent / ".github" / "workflows" / "tide-g4-reference-archive.yml").read_text(encoding="utf-8")
UTC = timezone.utc


def _hours(a, b, held=()):
    out, t = [], a
    while t <= b:
        if not any(x <= t < y for x, y in held):
            out.append(t)
        t += timedelta(hours=1)
    return out


def test_served_backend_never_imports_the_g4_jobs():
    pat = re.compile(r"^\s*(from|import)\s+.*\b(tide_g4|g4_rules|g4_power|g4_archive)\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []


def test_gauges_are_g3ts_26_and_the_reported_rows_are_separate():
    sys.path.insert(0, str(BACKEND / "scripts" / "tide_fes"))
    from fes_gate import IDS
    assert list(R4.GAUGES) == IDS and len(R4.GAUGES) == 26
    assert set(R4.REPORTED_GAUGES) == {"8679598", "8760922", "8770822"}
    assert not set(R4.REPORTED_GAUGES) & set(R4.GAUGES)


def test_stretches_are_whole_calendar_runs_that_never_bridge_a_held_out_week():
    a, b = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 4, 30, 23, tzinfo=UTC)
    held = ((datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 8, tzinfo=UTC)),)
    hrs = _hours(a, b, held)
    st = R4.stretches(hrs, held, 20)
    assert st, "some stretches fit"
    for idx in st:
        ts = [hrs[i] for i in idx]
        assert len(ts) == 20 * 24 and ts[0].hour == 0
        assert all((y - x) == timedelta(hours=1) for x, y in zip(ts, ts[1:]))       # contiguous: no gap bridged
        assert not any(h0 <= t < h1 for t in ts for h0, h1 in held)
    # Jan 1 .. Mar 1 has 59 days -> 40 starts; Mar 8 .. Apr 30 has 54 days -> 35 starts
    assert len(st) == 40 + 35


def test_real_g3t_window_gives_the_56_day_stretch_count():
    sys.path.insert(0, str(BACKEND / "scripts" / "tide_g3t"))
    import g3t_rules as R
    st = R4.stretches(R.window_hours(), R.HELD_OUT, R4.POWER_LEN_DAYS)
    # Jan 1 .. Mar 15 (73 d) -> 18; Mar 22 .. Jun 15 (85 d) -> 30; Jun 22 .. Jul 24 (33 d) -> 0
    assert len(st) == 48


def test_pass_line_share_and_the_length_it_fixes():
    assert R4.stretch_passes(-0.02) and R4.stretch_passes(-0.05)
    assert not R4.stretch_passes(-0.0199) and not R4.stretch_passes(float("nan")) and not R4.stretch_passes(None)
    assert R4.pass_share([-0.03, -0.01, float("nan"), -0.02]) == (0.5, 4)
    s, n = R4.pass_share([])
    assert n == 0 and np.isnan(s)
    assert R4.window_length(0.8) == 56 and R4.window_length(0.79) == 84
    assert R4.window_length(float("nan")) == 84 and R4.window_length(None) == 84


def test_power_check_scores_only_a_plus_m_against_d_and_prints_only_the_share():
    calls = re.findall(r"paired_median_diff\(([^)]*)\)", POWER)
    assert calls == ["AM, D, obs, gauges, draws=R.DRAWS, seed=SEED, hours_idx=idx"]
    for banned in ("references(", "C_reference", "CL[", "item1(", "per_gauge_rmse", "label_swap"):
        assert banned not in POWER
    assert "_pt, _lo, hi, _per" in POWER                     # point, lower end and per-gauge values are discarded
    printed = re.findall(r'"(\w+)":', POWER.split("def main")[1])
    assert set(printed) <= {"registration", "job", "window", "length_days", "line_m", "seed", "pass_share",
                            "n_stretches", "n_gauges", "g4_length_days", "why", "__main__"}
    assert "SEED = 20261119" in POWER


def test_power_workflow_is_one_shot_with_scoped_credentials():
    code = "\n".join(ln.split("#")[0] for ln in WF_POWER.splitlines())
    assert "tags: [tide-g4-power]" in code and "workflow_dispatch" not in code
    assert "schedule:" not in code and "branches" not in code
    jobs = WF_POWER.split("\n  check:")
    assert "AVISO_PASSWORD" in jobs[0] and "COPERNICUSMARINE" not in jobs[0]
    assert "COPERNICUSMARINE_SERVICE_PASSWORD" in jobs[1] and "AVISO" not in jobs[1]
    assert WF_POWER.count("secrets.") == 4
    assert '"pyfes==2026.5.2"' in WF_POWER


def test_archive_does_nothing_before_start_and_stops_after_window_plus_lag():
    s = datetime(2026, 11, 22, tzinfo=UTC)
    assert R4.archive_phase(s, None, 56) == "not-started"
    assert R4.archive_phase(s, s, None) == "not-started"
    assert R4.archive_phase(s - timedelta(minutes=1), s, 56) == "not-started"
    assert R4.archive_phase(s, s, 56) == "archiving"
    assert R4.archive_phase(s + timedelta(days=59), s, 56) == "archiving"
    assert R4.archive_phase(s + timedelta(days=59, seconds=1), s, 56) == "complete"
    assert R4.START is None and R4.LEN_DAYS is None            # set only by G4 FINAL


def test_archive_days_look_back_three_days_and_never_before_start():
    s = datetime(2026, 11, 22, tzinfo=UTC)
    now = datetime(2026, 11, 30, 7, 17, tzinfo=UTC)
    assert R4.archive_days(now, s) == [datetime(2026, 11, d, tzinfo=UTC) for d in (27, 28, 29)]
    assert R4.archive_days(datetime(2026, 11, 23, 7, tzinfo=UTC), s) == [s]
    assert R4.archive_days(datetime(2026, 11, 22, 7, tzinfo=UTC), s) == []


def test_archive_keeps_the_first_value_seen_and_refuses_a_silent_fresh_archive():
    a = {}
    assert R4.merge_first_seen(a, {"2026-11-22T00:00": 0.1, "2026-11-22T01:00": None}, "t1") == 1
    assert R4.merge_first_seen(a, {"2026-11-22T00:00": 0.9, "2026-11-22T02:00": 0.3}, "t2") == 1
    assert a == {"2026-11-22T00:00": [0.1, "t1"], "2026-11-22T02:00": [0.3, "t2"]}
    s = datetime(2026, 11, 22, tzinfo=UTC)
    assert R4.fresh_archive_allowed(s + timedelta(days=3), s)
    assert not R4.fresh_archive_allowed(s + timedelta(days=3, seconds=1), s)
    assert not R4.fresh_archive_allowed(s, None)


def test_archive_fetches_references_only_and_uploads_cumulatively_for_90_days():
    assert "marine-api.open-meteo.com" in ARCHIVE
    for truth in ("water_level", "datagetter", "uhslc", "erddap", "product=", "coops_obs"):
        assert truth not in ARCHIVE                            # never observed water: the embargo holds
    assert R4.ARCHIVE_VARS == ("sea_level_height_msl", "sea_level_height_msl_previous_day1",
                               "sea_level_height_msl_previous_day2")
    assert "secrets." not in WF_ARC
    assert "retention-days: 90" in WF_ARC and "steps.arc.outputs.phase == 'archiving'" in WF_ARC
    assert "gh run download" in WF_ARC and "name: tide-g4-reference-archive" in WF_ARC
    assert "contents: read" in WF_ARC and "contents: write" not in WF_ARC
    cron = re.search(r"cron: '(\d+) (\d+) ", WF_ARC)
    assert cron and not (3 <= int(cron.group(2)) <= 5)          # outside the 03:00-05:30 UTC quiet window
