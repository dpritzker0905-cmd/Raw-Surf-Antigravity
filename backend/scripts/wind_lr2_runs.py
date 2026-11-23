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


# Regions (the registration names five; the rules are fixed HERE, before any data, by amendment 1 A3 as corrected by the
# advisor's hold on #1139). Ordered rules, not first-box-wins over overlapping boxes.
# Amendment R1 (2026-11-23, before any fit, score or forecast read): ALASKA and CARIBBEAN_PR are FIXED gated regions, added to the five
# registered ones. They were chosen from the frozen station counts only (see the amendment); every floor stays as registered.
REGIONS = ["US_PACIFIC", "US_ATLANTIC_GULF", "HAWAII", "EUROPE_ATLANTIC", "MEDITERRANEAN", "ALASKA", "CARIBBEAN_PR"]
EXCLUDED_REGIONS = ("GREAT_LAKES",)       # lakes are not the open sea: never marine-exposed, never in a gated region


def region_of(lat: float, lon: float) -> str:
    """Region of a station. GREAT_LAKES is EXCLUDED (its NDBC buoys pass the buoy branch of the marine-exposed rule, so the
    flag is forced off in wind_lr2_geo.pair_list). BLACK_SEA is not one of the five registered regions: it is handled as
    OTHER (pooled coefficients, reported, no G6 line). The Mediterranean is the sea east of Gibraltar: the Atlantic Iberian,
    Biscay and French/Spanish Atlantic surf coasts (Hossegor, Mundaka, Santander) belong to EUROPE_ATLANTIC. Longitude is
    normalised to -180..180 on entry (a 0..360 source such as 203 E is -157)."""
    lon = ((float(lon) + 180.0) % 360.0) - 180.0
    if 41.3 <= lat <= 49.5 and -92.5 <= lon <= -76.0:
        return "GREAT_LAKES"
    if 18.0 <= lat <= 23.0 and -161.0 <= lon <= -154.0:
        return "HAWAII"
    if 30.0 <= lat <= 50.0 and -135.0 <= lon <= -117.0:
        return "US_PACIFIC"
    if 40.5 <= lat <= 47.5 and 27.0 <= lon <= 42.0:
        return "BLACK_SEA"
    if 30.0 <= lat <= 46.5 and -5.6 <= lon <= 37.0 and (lat < 42.0 or lon >= 2.5):
        return "MEDITERRANEAN"
    if 24.0 <= lat <= 48.0 and -98.0 <= lon <= -60.0:
        return "US_ATLANTIC_GULF"
    if 35.0 <= lat <= 62.0 and -25.0 <= lon <= 10.0:
        return "EUROPE_ATLANTIC"
    # Amendment R1. ALASKA: north of 50 N (lat == 50.0 exactly is US_PACIFIC, which is tested first) and east of the dateline
    # at or west of 125 W: the Gulf of Alaska, the Alaska coast and the Aleutians as normalised to -180..180. CARIBBEAN_PR: 10 N
    # up to (not including) 24 N and 90 W..58 W: the Caribbean, Puerto Rico and the Virgin Islands; Florida and the Keys are
    # US_ATLANTIC_GULF (24 N and north), the Gulf of Mexico west of 90 W stays OTHER.
    if lat > 50.0 and lon <= -125.0:
        return "ALASKA"
    if 10.0 <= lat < 24.0 and -90.0 <= lon <= -58.0:
        return "CARIBBEAN_PR"
    return "OTHER"
