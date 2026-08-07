"""Ask the container what its limits are, instead of hardcoding a guess about them.

THE DEFECT THIS EXISTS FOR (measured 2026-08-06). `APP_MEMORY_LIMIT_MB` defaulted to **512.0** and
`render.yaml` never set it. The real container, read from its own cgroup, is **2048 MB**. Every
memory judgement in this repo was therefore made against a denominator 4x too small:

  * `/admin/system/health` computed `min(used / 512 MB, 100.0)` — and production plateaus at ~891 MB,
    so that expression returned a CLAMPED **100.0%** permanently. The dashboard has been reporting
    "memory completely full" on a box running at 43% utilisation. A gauge pinned at its maximum is
    indistinguishable from a broken gauge, and both get ignored.
  * The 2026-07-24 restart-under-load lever was sized as "16 concurrent 15,023-vector product parses
    (~15-20 MB each) on a **512 MB** box" and left OPEN for 13 days on that basis. Against the real
    2048 MB — with a measured plateau of 891 MB and ~1.15 GB of headroom — that same spike fits.

⭐ WHY A SHARED HELPER AND NOT A SECOND FIX. The first repair patched `routes/health.py` alone and
left this identical constant live in `routes/admin/system.py` — the "a fix at the incident site is
not a fix to the class" shape this repo has now recorded four times (a disclosure reaching 1 of 4
renderers; a salvage in 1 of 7 fetchers; a stubbing mechanism guarded in 1 of 2 forms). One function,
both callers.

CONTRACT: returns ``(limit_mb, source)`` where source is ``"cgroup"`` (MEASURED), ``"env"``
(operator-declared) or ``"default_assumed"`` (a guess). **Callers should publish the source.** A
number whose provenance is unstated is exactly how a 512 that meant nothing survived this long.
"""
from __future__ import annotations

import os
from typing import Optional, Tuple

# cgroup v2 first, then v1. Both report bytes.
_CGROUP_PATHS = (
    "/sys/fs/cgroup/memory.max",                    # v2
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",  # v1
)

# v1 writes a near-2^63 sentinel when unlimited, and a sub-16 MB reading is a parse error rather
# than a container. Anything outside this band is not believed.
_MIN_PLAUSIBLE_MB = 16.0
_MAX_PLAUSIBLE_MB = 1024.0 * 1024.0        # 1 TB

DEFAULT_ASSUMED_MB = 512.0


def container_memory_limit_mb() -> Tuple[float, str]:
    """The container's real memory ceiling in MB, and where that number came from."""
    for path in _CGROUP_PATHS:
        try:
            with open(path) as fh:
                raw = fh.read().strip()
        except OSError:
            continue                       # not Linux, or no cgroup mounted (the Windows dev box)
        if not raw or raw == "max":
            continue                       # explicitly unlimited
        try:
            val = int(raw) / (1024 * 1024)
        except ValueError:
            continue
        if _MIN_PLAUSIBLE_MB < val < _MAX_PLAUSIBLE_MB:
            return val, "cgroup"

    env = os.environ.get("APP_MEMORY_LIMIT_MB")
    if env:
        try:
            return float(env), "env"
        except ValueError:
            pass
    return DEFAULT_ASSUMED_MB, "default_assumed"


def memory_used_percent(used_bytes: float, limit_mb: Optional[float] = None) -> float:
    """Percent of the container limit in use — UNCLAMPED, deliberately.

    ⛔ The previous form was `min(used / limit * 100, 1.0 * 100)`. Clamping hides the one case worth
    seeing: a reading ABOVE 100% means the limit is wrong (as it was here, at 174%), not that memory
    is exactly full. A gauge that cannot exceed its maximum can never tell you its maximum is fiction.
    """
    if limit_mb is None:
        limit_mb, _ = container_memory_limit_mb()
    if not limit_mb or limit_mb <= 0:
        return 0.0
    return round((used_bytes / (limit_mb * 1024 * 1024)) * 100.0, 1)
