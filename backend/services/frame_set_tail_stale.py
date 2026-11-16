"""A tail product on the runner's disk from another run is re-downloaded, not trusted (2026-11-15, FRAME_TAIL_REFETCH_STALE, ON).

WHY. The ICON/EURO world estimated tails are baked by the CORE lane; the pilots publisher downloads each tail product that is not on
its disk (publish_frame_images.TailDownloads.prefetch). But a pilots job that READS a tail (the ICON swell_2 blend reads the EURO
swell_2 tail, Consensus Marine Shadow the ICON waves tail) restores it from L2 to this disk. When a core run re-bakes the tail between
that restore and the frames step, the disk copy is an older run than the manifest names: prefetch skipped it ("on disk") and
publish_set then refused it as `stale_local`, so those hours went unbuilt and /grid served them. Measured: 3 of 8 pilots runs
(2026-11-14/15): EURO swell_2 42 and 40, ICON waves 19 (docs/weather-program/log/2026-11-15-opus-euro-swell2-stale-tail.md).

WHAT. prefetch asks `is_stale` of a disk copy (publish_set's exact run check: model_run_time and run_time against the manifest
entry) and downloads the current product in its place, under the same cap and accounting; the download is read before the disk copy.
A refetched copy that is STILL another run (a storage read racing the core lane's write) is refused by publish_set as before: this
never builds a frame publish_set would not.
"""
from __future__ import annotations

import json
import os

from services import frame_set as fs

FLAG = "FRAME_TAIL_REFETCH_STALE"


def enabled():
    return os.environ.get(FLAG, "1") != "0"


def is_stale(raw, entry):
    """True when the stored bytes are not the run the manifest entry names (unreadable bytes count as stale: refetch them)."""
    try:
        product = json.loads(raw)
    except (ValueError, TypeError):
        return True
    if not isinstance(product, dict):
        return True
    return (fs.iso(product.get("model_run_time")) != fs.iso(entry.get("model_run_time"))
            or fs.iso(product.get("run_time")) != fs.iso(entry.get("run_time")))
