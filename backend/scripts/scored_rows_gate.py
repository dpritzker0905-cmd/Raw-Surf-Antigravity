#!/usr/bin/env python3
"""scored_rows_gate.py - ONE-OFF, READ-ONLY gate for the scalar-height flip (ledger commitment 1335). Delete after use.

WHAT. Reads the skill ledger's scored archive with the SAME loader the Forecast Accuracy Monitor uses
(`forecast_accuracy_monitor._fetch_scored_month`: the frozen monthly object plus every day object, a missing day normal,
an unreadable part fatal) and prints AGGREGATES: served `raw_surf` vs `raw_surf:GFS_SCALAR` paired, by coast and by
FORECAST-height band, per lead; the gate sentence; the exact bias/spread split of the scalar gain; the scalar and served
lanes against the Open-Meteo control; and the built CONSENSUS shadow against the computed equal mean at +48/+72 h by tier,
coast, frame and cycle. The arithmetic is `services/weather_pipeline/scored_rows_analysis.py` (pure, tested).

AGGREGATES ONLY. The repo is public and so is every Actions log and step summary. No row, no per-buoy line, no per-pair
value is printed or written anywhere; a cell under n = 10 prints `n<10`. There is no artifact upload.

READ-ONLY, ENFORCED IN CODE. `read_only_http` wraps `http.client.HTTPConnection.request` and `.putrequest`, the layer every
stdlib and urllib3 HTTP call passes through: any method other than GET, any request body, and any host other than the
Supabase project's own raises `ReadOnlyViolation`. That is a BaseException on purpose, so the loader's broad
`except Exception` cannot swallow it into "unreadable". Nothing here imports a Storage client, writes Storage or a
database, or dispatches a workflow. The only write is the runner's own `$GITHUB_STEP_SUMMARY` file.

SECRETS. Only the NAMES `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are used, read from the environment exactly as
the monitor reads them. No value, and no URL, is ever printed.

Usage (CI): python3 scripts/scored_rows_gate.py --since 2026-10-03T00:00:00Z
Exit: 0 gate computed (YES or NO), 3 blind or refused (archive unreadable, no cell reached n, credentials absent).

GATES_V2 (default off; science audit 2026-11-01): when the env flag is on, the same rows are also judged by validation
gates v2 (services/weather_pipeline/gate_v2*.py: DM/HAC, block bootstrap, big-swell bias bands, Holm-corrected harm,
hull and sea-state strata, periods against DPD and a parabolic-fit Tp) and a section is APPENDED, including where v1 and
v2 disagree. The guard then admits NDBC's public host too (GET only; scripts/gate_v2_ndbc.py). v1's verdict and the
exit code do not change.
"""
import argparse
import contextlib
import http.client
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts import forecast_accuracy_monitor as monitor            # noqa: E402  the monitor's own loader
from services.weather_pipeline import forecast_skill as fs           # noqa: E402
from services.weather_pipeline import scored_rows_analysis as sra    # noqa: E402
from services.weather_pipeline import gate_v2_config                 # noqa: E402  GATES_V2 (default off)

DONE, BLIND = 0, 3
DEFAULT_SINCE = "2026-10-03T00:00:00Z"      # the first monitor read with GFS_SCALAR rows
MAX_MONTHS = 6


class ReadOnlyViolation(BaseException):
    """A request that was not a plain GET to the Supabase project. BaseException, not Exception: the loader wraps its
    reads in `except Exception`, which would otherwise turn a violation into a quiet 'unreadable'."""


class Unreadable(Exception):
    """A scored object exists but could not be read. Carries the month only, never a URL."""


@contextlib.contextmanager
def read_only_http(allowed_host=None, extra_hosts=()):
    """Inside, every http.client request must be a GET without a body to `allowed_host` (when given) or one of
    `extra_hosts` (GATES_V2 adds exactly NDBC's public host, for hull metadata and spectra)."""
    cls = http.client.HTTPConnection
    request, putrequest = cls.request, cls.putrequest
    allowed = {h.lower() for h in ((allowed_host,) if allowed_host else ()) + tuple(extra_hosts or ())}

    def check(self, method, body=None):
        if str(method).upper() != "GET":
            raise ReadOnlyViolation("refused a non-GET request: " + str(method).upper())
        if body is not None:
            raise ReadOnlyViolation("refused a GET that carries a body")
        if allowed and (self.host or "").lower() not in allowed:
            raise ReadOnlyViolation("refused a request to a host other than the Supabase project")

    def guarded_request(self, method, url, body=None, *args, **kwargs):
        check(self, method, body)
        return request(self, method, url, body, *args, **kwargs)

    def guarded_putrequest(self, method, url, *args, **kwargs):
        check(self, method)
        return putrequest(self, method, url, *args, **kwargs)

    cls.request, cls.putrequest = guarded_request, guarded_putrequest
    try:
        yield
    finally:
        cls.request, cls.putrequest = request, putrequest


def months_between(since: datetime, now: datetime) -> list:
    out, year, month = [], since.year, since.month
    while (year, month) <= (now.year, now.month) and len(out) < MAX_MONTHS:
        out.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def load_rows(months, through, fetch=None):
    """(rows_read, rows kept) from the monitor's loader. Rows of lanes the gate does not grade are dropped as each
    month arrives (the frozen October object is ~50 MB). An unreadable month raises Unreadable."""
    fetch = fetch or monitor._fetch_scored_month
    read, kept = 0, []
    for month in months:
        got = fetch(month, through)
        if got is None:
            raise Unreadable(month)
        read += len(got)
        kept.extend(r for r in got if r.get("source") in sra.KEEP)
    return read, kept


def in_window(rows, since, until=None):
    out = []
    for r in rows:
        t = fs._parse_iso(r.get("target_time"))
        if t is not None and t >= since and (until is None or t <= until):
            out.append(r)
    return out


V2_NDBC_HOST = "www.ndbc.noaa.gov"     # = gate_v2_ndbc.NDBC_HOST (pinned equal by a test)


def fetch_v2_truth(rows, fetch=None):
    """GATES_V2 only: NDBC hull metadata and spectra for the buoys the graded lanes scored at. Never fatal."""
    from scripts import gate_v2_ndbc
    from services.weather_pipeline import gate_v2_truth
    buoys = {r.get("buoy_id") for r in rows if r.get("source") in sra.KEEP}
    return (fetch or gate_v2_ndbc.fetch_truth)(buoys, gate_v2_truth.parse_station_metadata,
                                               gate_v2_truth.parse_data_spec)


def main(argv=None, now=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since", default=DEFAULT_SINCE, help="first target time to include (UTC ISO)")
    ap.add_argument("--until", default=None, help="last target time to include (UTC ISO); default now")
    ap.add_argument("--min-n", type=int, default=sra.GATE_MIN_N, help="pairs a cell needs to decide the gate")
    ap.add_argument("--max-loss", type=float, default=sra.GATE_MAX_LOSS_M, help="largest MAE loss (m) a cell may show")
    args = ap.parse_args(argv)
    now = now or datetime.now(timezone.utc)
    since = fs._parse_iso(args.since)
    until = fs._parse_iso(args.until) if args.until else None
    if since is None:
        print("REFUSED: --since is not a UTC ISO time")
        return BLIND
    host = urlparse(os.environ.get("SUPABASE_URL", "")).hostname
    if not host or not (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")):
        print("REFUSED: archive credentials absent (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set); blind, not healthy")
        return BLIND
    v2 = gate_v2_config.enabled()
    truth_data = None
    try:
        with read_only_http(host, extra_hosts=(V2_NDBC_HOST,) if v2 else ()):
            read, rows = load_rows(months_between(since, now), (now + timedelta(days=1)).date())
            rows = in_window(rows, since, until)
            if v2:
                truth_data = fetch_v2_truth(rows)
    except Unreadable as e:
        print(f"REFUSED: the scored archive for {e} could not be read; blind, not healthy")
        return BLIND
    report = sra.render_report({"since": args.since, "until": args.until or "now", "rows_read": read},
                               rows, max(args.min_n, sra.MIN_CELL_N), args.max_loss)
    if v2:      # BESIDE v1 on the same rows; v1's verdict and this job's exit code are unchanged by it
        from services.weather_pipeline import gate_v2_report
        report += gate_v2_report.build_v2_section(
            rows, sra.gate(sra.tables(rows), max(args.min_n, sra.MIN_CELL_N), args.max_loss), truth_data)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(report)
    verdict = sra.gate(sra.tables(rows), max(args.min_n, sra.MIN_CELL_N), args.max_loss)["verdict"]
    return DONE if verdict in ("YES", "NO") else BLIND


if __name__ == "__main__":
    sys.exit(main())
