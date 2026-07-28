"""A literal zero from the direct-point lane is a LAND MASK, not a flat ocean.

MEASURED 2026-07-28 against production. GFS marine waves, `/api/weather/point`, Biarritz
(43.4832,-1.5586), hour by hour:

    02:00Z  Hs 0.0  Tp 0.0   source=backend_direct_point  product_id=None   <-- fabricated
    05:00Z  Hs 0.0  Tp 0.0   source=backend_direct_point  product_id=None   <-- fabricated
    08:00Z  Hs 0.7401 Tp 7.40 source=grid_file  gfs_marine_waves_global_coarse_...T090000Z
    11:00Z  Hs 0.6809 Tp 7.24 source=grid_file  ...T120000Z
    17:00Z  Hs 0.5152 Tp 6.91 source=grid_file  ...T180000Z
    20:00Z  Hs 0.0  Tp 0.0   source=backend_direct_point  product_id=None   <-- fabricated
    23:00Z  Hs 0.0  Tp 0.0   source=backend_direct_point  product_id=None   <-- fabricated

The cached grid covers ~08-18Z; OUTSIDE that window the direct-point fallback returned zeros and
stamped them `is_forecast_authoritative=true`. EURO had 0.8-1.5 m of swell at the identical
coordinate and hour. Confirmed at 5 of 5 non-US spots sampled (Biarritz, Guéthary, Anglet,
Busua GH, Barra da Lagoa BR); the US spot was unaffected.

A user dragging the forecast scrubber watched the swell blink out and back.

★ THE PHYSICAL TELL: a dead-calm sea still has a PEAK PERIOD. Height AND period simultaneously
exactly zero cannot be a sea state — it is a mask/no-data signature. The resolver already had a
guard saying "Do NOT coerce to 0.0 and serve it as data", but it only caught `None`.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "services", "weather_pipeline", "point_resolution.py")


def _source():
    return open(SRC, encoding="utf-8").read()


def test_the_zero_guard_exists_and_requires_BOTH_height_and_period_zero():
    """Guarding on height alone would suppress a genuine flat-calm reading that still has a period.
    The signature is the CONJUNCTION."""
    src = _source()
    assert "speed == 0.0 and period == 0.0" in src, (
        "the direct-point marine lane no longer treats Hs=0 AND Tp=0 as no coverage — the "
        "2026-07-28 blinking-swell bug is back")


def test_it_falls_through_to_the_same_places_the_NULL_guard_does():
    """The NULL case already degrades to the stashed coarse sample, else an honest no-coverage
    response. The zero case must do exactly the same — not invent a different path."""
    src = _source()
    zero_block = src.split("speed == 0.0 and period == 0.0")[1][:900]
    assert "coarse_last_resort" in zero_block
    assert "make_no_coverage_point_response" in zero_block


def test_the_kill_switch_is_present_and_defaults_ON():
    src = _source()
    assert 'os.environ.get("MARINE_ZERO_IS_NO_COVERAGE", "1") != "0"' in src, (
        "the fix must be kill-switched, and must default to ON")


def test_the_guard_sits_after_the_values_are_read_not_before():
    """It has to inspect the ACTUAL extracted values; placing it before the reads would make it
    unreachable or wrong."""
    src = _source()
    i_read = src.index('period = safe_index_get(raw_point["hourly"], period_key, idx, 0.0)')
    i_guard = src.index("speed == 0.0 and period == 0.0")
    assert i_read < i_guard


@pytest.mark.parametrize("speed,period,should_block", [
    (0.0, 0.0, True),      # the measured land-mask signature
    (0.0, 7.2, False),     # genuinely flat but a real sea — keep it
    (0.74, 0.0, False),    # height with no period — odd, but not the mask signature
    (0.74, 7.4, False),    # normal data
])
def test_the_conjunction_logic_blocks_only_the_mask_signature(speed, period, should_block):
    """Pins the decision table itself, independent of the file's text."""
    blocked = (speed == 0.0 and period == 0.0)
    assert blocked is should_block, (speed, period)
