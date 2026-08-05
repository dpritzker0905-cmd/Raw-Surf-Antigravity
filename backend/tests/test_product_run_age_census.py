"""Tests for the product RUN-AGE census (the regional-freshness instrument).

An instrument that is merely plausible is worse than none — five false positives in one session all
came from probes that answered when their precondition had failed. These pin the two properties that
make this one trustworthy: the TIER thresholds (a single bound cry-wolfs or goes blind), and the
refusal to report a clean bill of health from an empty input.
"""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "product_run_age_census",
    Path(__file__).resolve().parents[1] / "scripts" / "product_run_age_census.py")
prac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prac)

NOW = datetime(2026, 7, 31, 19, 34, tzinfo=timezone.utc)


def _p(model, domain, layer, region, age_h, horizon_h=192.0):
    """horizon_h: hours from NOW that this product's valid_time_end reaches. Default +8d = covering."""
    return {"model": model, "domain": domain, "layer": layer, "region_id": region,
            "run_time": (NOW - timedelta(hours=age_h)).isoformat(),
            "valid_time_end": (NOW + timedelta(hours=horizon_h)).isoformat()}


def _row(rows, model, domain, region):
    return next(r for r in rows if r["model"] == model and r["domain"] == domain
                and r["region"] == region)


def test_the_live_failing_instance_reports_critical():
    """GFS marine uk_ireland at 447.5 h, measured live 2026-07-31 — the case both existing
    instruments reported as healthy."""
    rows = prac.census([_p("GFS", "marine", "waves", "uk_ireland", 447.5)], NOW)
    r = rows[0]
    assert r["verdict"] == "CRITICAL" and r["tier"] == "worldwide" and r["age_h"] == 447.5


def test_hawaii_75_hour_wind_run_is_caught():
    """The original #12 report: a 75 h GFS run behind a CURRENT valid_time, which is exactly why a
    valid_time-based census could not see it."""
    assert prac.census([_p("GFS", "wind", "wind", "hawaii", 75.0)], NOW)[0]["verdict"] == "CRITICAL"


def test_tiers_get_different_thresholds_from_the_same_age():
    """22 h is healthy for a rotating worldwide region, stale for a flagship, dead for a global —
    one fixed threshold cannot serve all three."""
    rows = prac.census([
        _p("GFS", "marine", "waves", "south_africa", 22.0),        # worldwide, ~32h cadence
        _p("GFS", "marine", "waves", "florida_east_coast", 22.0),  # flagship, 8h cadence
        _p("GFS", "marine", "waves", "global_coarse", 22.0),       # global, 4h cadence
    ], NOW)
    assert _row(rows, "GFS", "marine", "south_africa")["verdict"] == "ok"
    assert _row(rows, "GFS", "marine", "florida_east_coast")["verdict"] == "warn"
    assert _row(rows, "GFS", "marine", "global_coarse")["verdict"] == "CRITICAL"


def test_global_mid_is_not_judged_against_the_four_hourly_cron():
    """⛔ THE 21%-FALSE-PAGE FIX, pinned. `global_mid` is the MID-RES tier and is not ingested on
    every forecast-ingest cycle, but `tier_of` bucketed every `global*` region into the 4-hourly
    `global` tier — so it was judged against a cadence it has never been on.

    MEASURED 2026-08-05: the cron itself is healthy (median gap 225.4 min vs a 240 min nominal over
    368 h, n=92, max gap 6.86 h, ZERO gaps above 8 h), and 100% of CRITICAL rows across the last ten
    failed monitor runs were `global_mid` at 13.4-22.3 h — never a regional lane, never
    `global_coarse`. On one of those runs the lane refreshed 14 minutes after the census sampled it.

    ★ The point is NOT that the alarm was annoying. A monitor paging on 21 of 100 runs stops being
      read, which is the same deaf spot that let a 12 h outage on 07-13 be found by a USER first.
    """
    rows = prac.census([
        _p("EURO", "wind", "wind", "global_mid", 16.1),      # the observed-normal band
        _p("GFS", "marine", "waves", "global_mid", 22.3),    # the worst observed while healthy
        _p("GFS", "marine", "waves", "global_coarse", 16.1),  # CONTROL: same age, tight tier
    ], NOW)
    assert _row(rows, "EURO", "wind", "global_mid")["verdict"] == "ok"
    assert _row(rows, "GFS", "marine", "global_mid")["verdict"] == "ok"
    # ★ THE CONTROL. If this also went quiet the change would be "relax everything until green".
    assert _row(rows, "GFS", "marine", "global_coarse")["verdict"] == "CRITICAL"


def test_a_genuinely_dead_mid_res_lane_still_pages():
    """The other half of the same change: widening the band must not blind it. A mid-res lane that
    has actually stopped is still caught — the alarm is retuned, not removed."""
    rows = prac.census([
        _p("EURO", "wind", "wind", "global_mid", 25.0),   # past anything observed while healthy
        _p("GFS", "marine", "waves", "global_mid", 40.0),  # dead
    ], NOW)
    assert _row(rows, "EURO", "wind", "global_mid")["verdict"] == "warn"
    assert _row(rows, "GFS", "marine", "global_mid")["verdict"] == "CRITICAL"


def test_an_unknown_global_variant_falls_into_the_TIGHT_tier():
    """⚠️ Fail loudly, not silently. A future `global_mid_v2` must NOT inherit the forgiving mid-res
    bound by prefix — an unrecognised global region gets the strict 4-hourly tier, so a new lane
    announces itself by paging rather than by being quietly unmonitored."""
    assert prac.tier_of("global_mid", "GFS", "marine") == "global_mid"
    assert prac.tier_of("global_mid_v2", "GFS", "marine") == "global"
    assert prac.tier_of("global_coarse", "GFS", "marine") == "global"


def test_icon_and_euro_marine_are_held_to_the_flagship_cadence():
    """They use get_all_pilot_regions() — every region every cycle — so the rotation allowance would
    hide a real 30 h stall. --strict drops the allowance."""
    prods = [_p("ICON", "marine", "waves", "hawaii", 30.0),
             _p("GFS", "marine", "waves", "hawaii", 30.0)]
    rows = prac.census(prods, NOW)
    assert _row(rows, "ICON", "marine", "hawaii")["verdict"] == "CRITICAL"   # no rotation -> 24h bound
    assert _row(rows, "GFS", "marine", "hawaii")["verdict"] == "ok"          # rotates -> 72h bound

    strict = prac.census(prods, NOW, strict=True)
    assert _row(strict, "ICON", "marine", "hawaii")["tier"] == "worldwide"
    assert _row(strict, "ICON", "marine", "hawaii")["verdict"] == "ok"


def test_newest_run_wins_so_one_stale_product_cannot_condemn_a_fresh_lane():
    rows = prac.census([_p("GFS", "marine", "waves", "hawaii", 400.0),
                        _p("GFS", "marine", "waves", "hawaii", 3.0)], NOW)
    assert rows[0]["age_h"] == 3.0 and rows[0]["verdict"] == "ok" and rows[0]["products"] == 2


def test_lanes_are_sorted_oldest_first():
    rows = prac.census([_p("GFS", "marine", "waves", "hawaii", 5.0),
                        _p("GFS", "marine", "waves", "uk_ireland", 447.5),
                        _p("GFS", "wind", "wind", "brazil_east", 12.0)], NOW)
    assert [r["age_h"] for r in rows] == [447.5, 12.0, 5.0]


def test_undated_products_are_counted_not_silently_dropped():
    """A product with no parseable run_time is unmeasurable, not fresh — it must be surfaced."""
    rows = prac.census([_p("GFS", "marine", "waves", "hawaii", 5.0),
                        {"model": "GFS", "domain": "marine", "layer": "waves",
                         "region_id": "hawaii", "run_time": "not-a-date"}], NOW)
    assert rows[0]["undated_products"] == 1 and rows[0]["products"] == 1


def test_an_all_undated_lane_produces_no_row_rather_than_a_fake_ok():
    """The script exits 2 on this (REFUSING TO REPORT) instead of printing a clean bill of health."""
    assert prac.census([{"model": "GFS", "domain": "marine", "layer": "waves",
                         "region_id": "hawaii", "run_time": None}], NOW) == []


def test_unknown_region_falls_to_the_most_forgiving_tier():
    """A region added later must never generate a false alarm before its cadence is known."""
    rows = prac.census([_p("GFS", "marine", "waves", "some_new_coast", 30.0)], NOW)
    assert rows[0]["tier"] == "worldwide" and rows[0]["verdict"] == "ok"


@pytest.mark.parametrize("stamp,expected", [
    ("2026-07-31T17:34:00Z", 2.0),
    ("2026-07-31T17:34:00+00:00", 2.0),
    ("2026-07-31T17:34:00", 2.0),          # naive -> UTC
])
def test_run_time_stamp_formats_all_parse(stamp, expected):
    rows = prac.census([{"model": "GFS", "domain": "wind", "layer": "wind",
                         "region_id": "hawaii", "run_time": stamp}], NOW)
    assert rows[0]["age_h"] == expected


# ─────────────── coverage vs freshness: the two axes fail independently ───────────────

def test_expired_outranks_stale_because_absence_is_worse_than_age():
    """THE MEASURED CONTRAST, 2026-07-31. south_africa: 22.2 h old, 340 products, still covering ->
    degraded. uk_ireland: 447.8 h old, 4 products, every valid_time pinned to 2026-07-20T18:00 ->
    covering NOTHING, so the resolver silently drops to the coarser global tier. A freshness-only
    census scores these alike and mis-triages the worse one."""
    rows = prac.census([
        _p("GFS", "marine", "waves", "south_africa", 22.2, horizon_h=70.0),
        _p("GFS", "marine", "waves", "uk_ireland", 447.8, horizon_h=-264.0),   # ended 11 days ago
    ], NOW)
    uk = _row(rows, "GFS", "marine", "uk_ireland")
    za = _row(rows, "GFS", "marine", "south_africa")
    assert uk["verdict"] == "EXPIRED" and uk["covers_now"] is False
    assert za["verdict"] == "ok" and za["covers_now"] is True
    assert rows[0]["region"] == "uk_ireland"        # EXPIRED sorts first, ahead of oldest-run


def test_a_fresh_run_whose_products_all_expired_is_still_expired():
    """Freshness cannot vouch for coverage: a run minutes old that saved only past hours serves
    nothing. This is the inverse of the Hawaii case (old run, current valid_time)."""
    rows = prac.census([_p("GFS", "wind", "wind", "hawaii", 0.5, horizon_h=-1.0)], NOW)
    assert rows[0]["verdict"] == "EXPIRED" and rows[0]["age_h"] == 0.5


def test_one_covering_product_rescues_a_lane_full_of_expired_ones():
    rows = prac.census([_p("GFS", "marine", "waves", "hawaii", 5.0, horizon_h=-100.0),
                        _p("GFS", "marine", "waves", "hawaii", 5.0, horizon_h=12.0)], NOW)
    assert rows[0]["covers_now"] is True and rows[0]["verdict"] == "ok"
    assert rows[0]["horizon_h"] == 12.0


def test_missing_valid_time_end_is_unknown_never_invented_coverage():
    """Absent coverage data must read as '?', not as EXPIRED and not as ok -- the instrument may not
    fabricate the axis it is measuring."""
    rows = prac.census([{"model": "GFS", "domain": "marine", "layer": "waves",
                         "region_id": "hawaii",
                         "run_time": (NOW - timedelta(hours=5)).isoformat()}], NOW)
    assert rows[0]["covers_now"] is None and rows[0]["horizon_h"] is None
    assert rows[0]["verdict"] == "ok"            # falls back to the freshness axis alone


def test_expired_lanes_trip_fail_on_stale_even_when_the_run_is_recent():
    """The monitor must page on absence, not only on age -- otherwise a lane that quietly stops
    covering the present hour passes forever."""
    rows = prac.census([_p("GFS", "marine", "waves", "uk_ireland", 2.0, horizon_h=-5.0)], NOW)
    assert rows[0]["verdict"] == "EXPIRED"
    assert [r for r in rows if r["verdict"] in ("EXPIRED", "CRITICAL")]


def test_thresholds_are_ordered_and_cover_every_tier_tier_of_can_return():
    for tier, (warn, crit) in prac.THRESHOLDS.items():
        assert 0 < warn < crit, tier
    produced = {prac.tier_of(r, "GFS", "marine") for r in
                list(prac.FLAGSHIP_REGIONS) + list(prac.WORLDWIDE_REGIONS)
                + ["global_coarse", "global_mid", None, "unknown"]}
    assert produced <= set(prac.THRESHOLDS)
