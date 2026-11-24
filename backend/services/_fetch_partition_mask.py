"""A MASKED wave partition is ZERO energy where the total sea is valid (2026-11-24, Plan 4; flag GFS_PARTITION_MASKED_AS_ZERO).

WHY. NOAA's GFS-Wave GRIB marks a partition that holds no energy in a cell as MISSING (bitmap), never 0.0. Measured offline on
cycle 2026-11-23 12Z (docs/weather-program/evidence/2026-11-24-gfs-native-r2/): where the total Hs is valid, swell_1 is
masked in 10 % of cells, swell_2 in 23-24 %, wind_waves in 34-37 %, and exactly 0.0 in 0 %. The fetcher fills the mask with
NaN, and the block height reduction (`_fetch_common.energy_mean_height_block`, RMS over FINITE subcells) then averages each
partition only over the subcells where that train exists, while the total is averaged over the whole block. The served 2-deg
partitions read high: sum(p^2) > 1.1 H^2 in 22 % of world cells (native 0.25 deg: 1.1-1.3 %); at the 2-deg tier the
wind-wave height was 2.41x the zero-filled one at p90.

THE FIX. For the three PARTITION heights, a subcell where the partition is NaN but the total is finite counts as 0 energy;
a subcell where the total is NaN too (land, ice) stays excluded. Natively the partitions that ARE present already close the
total (median sum(p^2)/H^2 = 0.99), so the masked ones carry no energy: zero is the measured value, not an assumption.
  * A partition height can only FALL (zeros added to an RMS) and a block with no masked subcell is bit-identical.
  * A block where the partition is absent EVERYWHERE stays NaN ("no train here"), never 0.0 m: `keep_absent` re-reduces the
    unfilled array at the nodes that read exactly 0.0, so a genuine 0.0 partition is kept. That keeps the physics check's R3
    (no valid 0 m with no period) clean and the map's partition layers as they were where no train exists.
  * The TOTAL, every period and every direction value are untouched. The partition direction CONFIDENCE (R x coverage) counts
    the zero-filled subcells in its denominator (`support="height"` in the conf reducers), so a train covering 1 of 64 subcells
    reads coverage 1/64 instead of 1 (Fix B).
ICON (DWD GWAM) never masks: absent partitions arrive as 0.0 (0.0 % NaN where the total is valid), so there is no ICON flag.

Fetched as a sibling by path (services is not importable in the subprocess): numpy only, no package imports.
"""
from __future__ import annotations

TOTAL = "wave_height"
PARTITION_HEIGHTS = ("swell_wave_height", "secondary_swell_wave_height", "wind_wave_height")
PARTITION_DIR_HEIGHT = {"swell_wave_direction": "swell_wave_height",
                        "secondary_swell_wave_direction": "secondary_swell_wave_height",
                        "wind_wave_direction": "wind_wave_height"}
PAYLOAD_KEY = "partition_masked_as_zero"


def fill_masked(p_arr, total_arr):
    """A copy of partition height `p_arr` with 0.0 wherever it is NaN and `total_arr` is finite."""
    import numpy as np
    p = np.array(p_arr, dtype=float, copy=True)
    p[np.isnan(p) & np.isfinite(np.asarray(total_arr, dtype=float))] = 0.0
    return p


def prepare(arrs):
    """{partition height om: zero-filled array} from one decoded step's {om: array}; {} when the total is absent."""
    total = arrs.get(TOTAL)
    if total is None:
        return {}
    return {om: fill_masked(arrs[om], total) for om in PARTITION_HEIGHTS if arrs.get(om) is not None}


def keep_absent(values, rs, cs, old_fn):
    """A block whose partition had NO finite subcell before the fill reads exactly 0.0 after it; give it back its no-data.
    Only the 0.0 results are re-checked, by `old_fn(rs, cs)` = the SAME reduction on the unfilled array at those nodes
    (NaN = no train there). A genuine 0.0 partition (a real calm train) is kept: its unfilled reduction is 0.0, not NaN."""
    import numpy as np
    v = np.array(values, dtype=float, copy=True)
    z = np.flatnonzero(v == 0.0)
    if z.size:
        old = np.asarray(old_fn(np.asarray(rs)[z], np.asarray(cs)[z]), dtype=float)
        v[z] = np.where(np.isnan(old), np.nan, 0.0)
    return v


def old_reduction(orig, is_height, hs_native, half, nat, rs, cs):
    """The reduction of the UNFILLED partition array at nodes (rs, cs), for keep_absent: block RMS for a height, else the point
    sample, exactly as the fetch loop would have produced without the fill (_fetch_region_reduce.variable, the loop's own)."""
    import numpy as np
    try:
        import _fetch_region_reduce as _reduce  # script-by-path
    except ImportError:
        from services import _fetch_region_reduce as _reduce  # package
    rs, cs = np.asarray(rs, dtype=np.intp), np.asarray(cs, dtype=np.intp)
    got = _reduce.variable(orig, None, is_height, None, None, hs_native, rs, cs, half, nat)
    return got[0] if got is not None else orig[rs, cs]


def payload_value(payload):
    """The flag as the PARENT resolved it (runtime_flags.flag, env > manifest > code default) and passed in the payload; a
    payload without it (an old caller) takes the code default, ON. Never read from os.environ here: a raw env read is
    invisible to the manifest, so the guardrail's auto-off would never reach the fetcher."""
    v = (payload or {}).get(PAYLOAD_KEY, True)
    return str(v).strip().lower() not in ("0", "false", "off", "")
