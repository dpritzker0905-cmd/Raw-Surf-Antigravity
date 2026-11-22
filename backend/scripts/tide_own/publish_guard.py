"""The tide table is NEVER published missing, short or partial (the owner, 2026-11-22: "we don't have missing tide
tables ever"). Standard library only; the workflow runs it as `python3 -I -S`, with no credential.

  guard NEW [--current CUR]       exit 1 (with ::error lines) unless NEW may replace the published table CUR
  horizon TABLE --min-days N      exit 1 (with an ::error line) when TABLE covers fewer than N days from now

A table may be published only when ALL hold:
  - its schema is the served one;
  - it covers at least MIN_PUBLISH_DAYS ahead of now (the server keeps serving the harmonic tide for as long as a
    table covers today, so a long horizon is what makes a missed build harmless);
  - it has at least MIN_KEY_SHARE of the current table's keys (a partial build cannot shrink coverage);
  - at least MIN_FILLED_SHARE of its keys have a value in the next WINDOW_DAYS days (keys present but empty count as
    missing).
When the guard refuses, the workflow stops before the publish step, so the last good table stays served.
"""
import argparse
import base64
import gzip
import json
import struct
import sys
from datetime import datetime, timedelta, timezone

SCHEMA = "raw-surf/tide-own/2"           # must equal own_rules.SCHEMA and tide_own.SCHEMA (pinned by a test)
MISSING = -32768
MIN_PUBLISH_DAYS = 60
HORIZON_ALERT_DAYS = 30
MIN_KEY_SHARE = 0.95
MIN_FILLED_SHARE = 0.95
WINDOW_DAYS = 16                         # the 14-day horizon contract plus a margin


def load(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _start(doc):
    return datetime.strptime(str(doc["start"])[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


def horizon_days(doc, now):
    """Days from `now` to the end of the table's hourly axis (negative when it has already ended)."""
    end = _start(doc) + timedelta(hours=int(doc["hours"]))
    return (end - now).total_seconds() / 86400.0


def _values(v):
    if isinstance(v, str):
        raw = base64.b64decode(v)
        return [None if x == MISSING else x for x in struct.unpack(f"<{len(raw) // 2}h", raw)]
    return list(v)


def filled_share(doc, now):
    """Share of the table's keys with at least one value in [00Z today, + WINDOW_DAYS)."""
    keys = doc.get("keys") or {}
    if not keys:
        return 0.0
    day0 = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    i0 = int((day0 - _start(doc)).total_seconds() // 3600)
    i1 = i0 + 24 * WINDOW_DAYS
    if i0 < 0:
        return 0.0
    n = sum(1 for v in keys.values() if any(x is not None for x in _values(v)[i0:i1]))
    return n / len(keys)


def check(new, current, now):
    """[reason, ...] for refusing NEW; empty means it may be published."""
    why = []
    if not isinstance(new, dict) or new.get("schema") != SCHEMA:
        return [f"schema is {new.get('schema') if isinstance(new, dict) else type(new).__name__}, not {SCHEMA}"]
    h = horizon_days(new, now)
    if h < MIN_PUBLISH_DAYS:
        why.append(f"covers {h:.1f} days ahead, fewer than {MIN_PUBLISH_DAYS}")
    n_new = len(new.get("keys") or {})
    if isinstance(current, dict) and current.get("keys"):
        n_cur = len(current["keys"])
        if n_new < MIN_KEY_SHARE * n_cur:
            why.append(f"{n_new} keys, fewer than {MIN_KEY_SHARE:.0%} of the published table's {n_cur}")
    elif n_new == 0:
        why.append("no keys")
    f = filled_share(new, now)
    if f < MIN_FILLED_SHARE:
        why.append(f"only {f:.1%} of keys have a value in the next {WINDOW_DAYS} days (need {MIN_FILLED_SHARE:.0%})")
    return why


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("guard")
    g.add_argument("new")
    g.add_argument("--current", default=None)
    h = sub.add_parser("horizon")
    h.add_argument("table")
    h.add_argument("--min-days", type=float, default=HORIZON_ALERT_DAYS)
    a = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    if a.cmd == "guard":
        new = load(a.new)
        cur = None
        if a.current:
            try:
                cur = load(a.current)
            except FileNotFoundError:
                cur = None                      # no published table yet: only the absolute checks apply
        why = check(new, cur, now)
        for w in why:
            print(f"::error title=Tide table NOT published::{w}; the last good table stays served")
        print(f"guard: {'REFUSED' if why else 'OK'}; horizon {horizon_days(new, now):.1f} d, "
              f"{len(new.get('keys') or {})} keys, filled {filled_share(new, now):.1%}")
        return 1 if why else 0
    try:
        doc = load(a.table)
    except FileNotFoundError:
        print("::error title=Tide table missing::no published tide table was found")
        return 1
    d = horizon_days(doc, now)
    if d < a.min_days:
        print(f"::error title=Tide table horizon low::the published table covers {d:.1f} days ahead, below "
              f"{a.min_days:g}; the build has not published for a while")
        return 1
    print(f"horizon: {d:.1f} days ahead (alert below {a.min_days:g})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
