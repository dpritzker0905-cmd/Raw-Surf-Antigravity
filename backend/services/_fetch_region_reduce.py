"""The GFS-Wave pass's VECTORIZED per-region reductions, as functions (2026-11-16; a bit-identical move out of
noaa_gfs_wave_fetcher.fetch_global_coarse's hour loop, which sits at the 800-line cap).

WHY. The 0.5-degree world tier (option B, docs/weather-program/log/2026-11-16-opus-world-0p5-tier.md) must produce each node
by the SAME reduction the pass applies to a 0.5-degree region (gate 1a), but for 238,651 nodes an hour, which the pass's
per-point Python series cannot hold (~10 GB). So the reductions the loop ran inline are moved here, unchanged, and return
arrays; the loop calls them exactly where the inline code was and appends to its series as before. Guards:
tests/test_vector_blockmean_loop_shadow.py (the real fetch_global_coarse, flag on vs off, identical payloads, and a count that
the batch branch is reached), tests/test_blockmean_vectorized_parity.py, tests/test_regrid_native_cell.py.

Fetched as a sibling by path (services is not importable in the subprocess): the try / except ImportError idiom.
"""
from __future__ import annotations

try:
    from _fetch_common import (  # script-by-path
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_direction_block_partition_conf, energy_mean_height_block, energy_mean_scalar_block,
        DIR_TOTAL_COHERENCE_RAMP_LO, DIR_TOTAL_COHERENCE_RAMP_HI,
    )
    from _fetch_blockmean_vec import (
        multi_dir_conf_batch, partition_dir_conf_batch, direction_block_batch, height_block_batch, scalar_block_batch,
    )
    from _fetch_native_cell import native_multi, native_reduce
except ImportError:
    from services._fetch_common import (  # package
        energy_mean_direction_block, energy_mean_direction_block_multi_conf,
        energy_mean_direction_block_partition_conf, energy_mean_height_block, energy_mean_scalar_block,
        DIR_TOTAL_COHERENCE_RAMP_LO, DIR_TOTAL_COHERENCE_RAMP_HI,
    )
    from services._fetch_blockmean_vec import (
        multi_dir_conf_batch, partition_dir_conf_batch, direction_block_batch, height_block_batch, scalar_block_batch,
    )
    from services._fetch_native_cell import native_multi, native_reduce


def total_direction(arr, partition_pairs, total_h, hs_native, rs, cs, half, nat):
    """The total-sea direction ('wave_direction') for nodes (rs, cs): (direction, confidence, has-confidence) arrays, the
    coherence-gated blend of the partitions and DIRPW. `nat`: the exact native cell (a LAND cell answers from its 3 x 3)."""
    import numpy as np
    if nat:
        return native_multi(
            multi_dir_conf_batch, energy_mean_direction_block_multi_conf, partition_pairs,
            arr, total_h, rs, cs, ~np.isfinite(hs_native[rs, cs]),
            ramp_lo=DIR_TOTAL_COHERENCE_RAMP_LO, ramp_hi=DIR_TOTAL_COHERENCE_RAMP_HI)
    scalar = (lambda _r, _c, _h=half:
              energy_mean_direction_block_multi_conf(partition_pairs, arr, _r, _c, _h, True, total_h))
    return multi_dir_conf_batch(
        partition_pairs, arr, rs, cs, half, True, scalar,
        total_h_arr=total_h, ramp_lo=DIR_TOTAL_COHERENCE_RAMP_LO, ramp_hi=DIR_TOTAL_COHERENCE_RAMP_HI)


def variable(arr, h_arr, is_height, p_h_arr, part_conf, hs_native, rs, cs, half, nat, part_support="finite"):
    """One variable's reduction for nodes (rs, cs): (values, partition confidences or None), or None when the variable has no
    reduction (the caller then samples arr[r, c], as the loop always did).
    h_arr: the height weighting a DIRECTION (None otherwise); is_height: a height (block RMS); p_h_arr: the height weighting a
    PERIOD; part_conf: export the partition's R x coverage confidence with its direction; part_support: its coverage
    denominator, "finite" (as always) or "height" (_fetch_partition_mask Fix B: zero-filled subcells count too)."""
    import functools
    import numpy as np
    reduces = h_arr is not None or is_height or p_h_arr is not None
    if nat and reduces:   # the exact native cell; a LAND cell answers from its centred 3x3
        bt, fn, gr = ((functools.partial(partition_dir_conf_batch, support=part_support),
                       functools.partial(energy_mean_direction_block_partition_conf, support=part_support), (arr, h_arr))
                      if h_arr is not None and part_conf else
                      (direction_block_batch, energy_mean_direction_block, (arr, h_arr)) if h_arr is not None else
                      (height_block_batch, energy_mean_height_block, (arr,)) if is_height else
                      (scalar_block_batch, energy_mean_scalar_block, (arr, p_h_arr)))
        out = native_reduce(bt, fn, gr, rs, cs, ~np.isfinite(hs_native[rs, cs]),
                            "partition" if (h_arr is not None and part_conf) else "value")
        return out[0], (out[1] if len(out) > 1 else None)
    if h_arr is not None and part_conf:
        return partition_dir_conf_batch(
            arr, h_arr, rs, cs, half, True,
            lambda _r, _c, _h=half: energy_mean_direction_block_partition_conf(arr, h_arr, _r, _c, _h, True, part_support),
            support=part_support)
    if h_arr is not None:
        return direction_block_batch(
            arr, h_arr, rs, cs, half, True,
            lambda _r, _c, _h=half: energy_mean_direction_block(arr, h_arr, _r, _c, _h, True)), None
    if is_height:
        return height_block_batch(
            arr, rs, cs, half, True, lambda _r, _c, _h=half: energy_mean_height_block(arr, _r, _c, _h, True)), None
    if p_h_arr is not None:
        return scalar_block_batch(
            arr, p_h_arr, rs, cs, half, True,
            lambda _r, _c, _h=half: energy_mean_scalar_block(arr, p_h_arr, _r, _c, _h, True)), None
    return None
