"""Shared conventions of the point archive (schema `point-archive/1`; gate served-wave-verify-v1 sections 0.1-0.3). PURE."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

SCHEMA = "point-archive/1"
WRITER_VERSION = "point-archive-writer/1"
PURPOSES = ("served", "nearshore_eval")
ROOT = "verify/point-archive/v1"
TRUTH_ROOT = ROOT + "/truth"
SUMS = "SHA256SUMS"

# Statuses (gate section 6 + 7a). The SAMPLER writes these on a record:
SAMPLER_STATUSES = ("ok", "out_of_domain", "cell_masked", "distance_exceeded", "sampler_fail")
# ...these are census-only, one count per (model, set, tier, run), never a per-lead record:
CENSUS_ONLY = ("no_regional_tier", "set_unpublished")
# ...and the SCORER adds these on the JOINED row (the raw record is never edited):
SCORER_STATUSES = ("buoy_qc_fail", "no_obs")
NO_OBS_CAUSES = ("no_report", "fetch_gap")

# Lead bins (gate section 7): the edges are written in the gate and fixed. [lo, hi) hours.
LEAD_BINS = ((0, 24), (24, 48), (48, 72), (72, 120), (120, 168), (168, 240))
MAX_LEAD_H = 240


def canon(obj):
    """Canonical JSON text: sorted keys, no spaces, no NaN (a NaN is a bug, never a value)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=False)


def sha256_hex(data):
    return hashlib.sha256(data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8")).hexdigest()


def parse_time(ts):
    """ISO 8601 (with Z or an offset) or epoch seconds -> aware UTC datetime."""
    if isinstance(ts, datetime):
        return ts.astimezone(timezone.utc) if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(timezone.utc)


def iso_z(ts):
    """-> YYYY-MM-DDTHH:MM:SSZ (UTC)."""
    return parse_time(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_stamp(ts):
    """A run's file name stem, ISO basic form: 2027-01-15T00:00:00Z -> 20270115T0000Z (as #1156 names its files)."""
    return parse_time(ts).strftime("%Y%m%dT%H%MZ")


def lead_h(run_time, valid_time):
    """valid - run as an INTEGER number of hours; a lead that is not a whole hour raises (it would mis-bin)."""
    s = (parse_time(valid_time) - parse_time(run_time)).total_seconds()
    if s % 3600 != 0:
        raise ValueError(f"lead {s} s is not a whole number of hours")
    return int(s // 3600)


def lead_bin(h):
    """'[lo,hi)' for a lead in hours, or None past the last edge (not scored)."""
    for lo, hi in LEAD_BINS:
        if lo <= h < hi:
            return f"[{lo},{hi})"
    return None


def run_path(purpose, model, run_time):
    """verify/point-archive/v1/<purpose>/<model>/<run>.jsonl.gz: ONE immutable object per (purpose, model, run)."""
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose {purpose!r}")
    return f"{ROOT}/{purpose}/{str(model).lower()}/{run_stamp(run_time)}.jsonl.gz"


def model_prefix(purpose, model):
    return f"{ROOT}/{purpose}/{str(model).lower()}"


def truth_prefix(station_id):
    return f"{TRUTH_ROOT}/{str(station_id).upper()}"
