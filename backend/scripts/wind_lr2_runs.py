"""wind_lr2_runs.py - run lists, lead bins and regions for the long-range wind v2 registration. Serves nothing.

Registration: docs/weather-program/gates/wind-long-range-v2.md (frozen, gate PASS at 8ea5fd219) and its amendment
docs/weather-program/gates/wind-long-range-v2-amendment-1.md. Nothing here reads data.
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

UTC = timezone.utc
FIT_START = datetime(2025, 12, 17, 0, tzinfo=UTC)      # AIGEFS operational (earlier archive is experimental, not used)
FIT_END = datetime(2026, 9, 30, 0, tzinfo=UTC)
FIT_EVERY_DAYS = 4
TEST_FIRST = datetime(2026, 12, 1, 0, tzinfo=UTC)
TEST_RUNS = 90                                         # 45 days of 00Z + 12Z inits
STEPS = list(range(180, 337, 6))                       # 180/240 bracket the seams; 186..336 are scored leads
SCORED_LEADS = [s for s in STEPS if s > 180]
# lead bins (left-open) and the bin centres the coefficients belong to (smooth-in-lead rule)
BINS = {"B1": (180, 216), "B2": (216, 264), "B3": (264, 336)}
CENTRES = {"B1": 198.0, "B2": 240.0, "B3": 300.0}
GATE_BINS = list(BINS)


def bin_of(lead: float) -> Optional[str]:
    for name, (lo, hi) in BINS.items():
        if lo < lead <= hi:
            return name
    return None


def fit_runs() -> List[datetime]:
    """FIT inits: every 4th calendar day at 00Z from FIT_START to FIT_END (about 69 runs)."""
    out, t = [], FIT_START
    while t <= FIT_END:
        out.append(t)
        t += timedelta(days=FIT_EVERY_DAYS)
    return out


def test_window_runs(freeze_commit_time: Optional[datetime] = None) -> List[datetime]:
    """TEST inits: 90 runs, 00Z and 12Z, starting at TEST_FIRST, or at the first 00Z at or after the freeze commit's
    committer timestamp when that is later (the registered missed-freeze rule). The count stays 90."""
    start = TEST_FIRST
    if freeze_commit_time is not None:
        ft = freeze_commit_time.astimezone(UTC)
        first = ft.replace(hour=0, minute=0, second=0, microsecond=0)
        if first < ft:
            first += timedelta(days=1)
        start = max(TEST_FIRST, first)
    out = []
    for k in range(TEST_RUNS):
        out.append(start + timedelta(days=k // 2, hours=12 * (k % 2)))
    return out


def last_valid(runs: List[datetime]) -> datetime:
    return max(runs) + timedelta(hours=STEPS[-1])


def snapshot_end(runs: List[datetime]) -> datetime:
    """Truth snapshots continue to the last valid time plus the 7-day shuffle shift (registration section 4)."""
    return last_valid(runs).replace(hour=0, minute=0) + timedelta(days=7)


# Regions (the registration names five; the boxes are fixed HERE, before any data, by amendment 1)
REGIONS = ["US_PACIFIC", "US_ATLANTIC_GULF", "HAWAII", "EUROPE_ATLANTIC", "MEDITERRANEAN"]


def region_of(lat: float, lon: float) -> Optional[str]:
    """Rule-based; stations outside every box are 'OTHER' (reported, borrow pooled coefficients)."""
    if 18.0 <= lat <= 23.0 and -161.0 <= lon <= -154.0:
        return "HAWAII"
    if 30.0 <= lat <= 50.0 and -135.0 <= lon <= -117.0:
        return "US_PACIFIC"
    if 24.0 <= lat <= 48.0 and -98.0 <= lon <= -60.0:
        return "US_ATLANTIC_GULF"
    if 30.0 <= lat <= 46.0 and -6.0 <= lon <= 37.0:
        return "MEDITERRANEAN"
    if 35.0 <= lat <= 62.0 and -25.0 <= lon <= 10.0:
        return "EUROPE_ATLANTIC"
    return "OTHER"
