"""sim_boot.py — what the weather-sim server must do on the MAIN THREAD before it serves anything.

Extracted from `weather_sim_mcp.py` (the 800-line ratchet). ⚠️ THE MOVE IS SAFE ONLY BECAUSE THE
MAIN-THREAD PROPERTY BELONGS TO THE CALL SITE, NOT THE DEFINITION: `weather_sim_mcp` still calls
`warm_hot_path()` at module scope, which is the main thread, before `mcp.run()`. Calling it from
inside a tool would restore the exact deadlock it exists to prevent.
"""
import logging
import os

from services.weather_pipeline.sim_rating import calculate_surf_rating
from services.weather_pipeline.sim_spots import CATALOG_DEFAULTS

logger = logging.getLogger("weather_sim_mcp")


# WITHOUT THIS THE SERVER DEADLOCKS ON ITS FIRST TOOL CALL
#
# Measured 2026-07-27 against the real stdio server: `get_surf_spots(query="Mavericks", limit=5)`
# returned NOTHING for 480 s (the MCP client gives up at 1800 s), while the identical call
# in-process took 0.02 s. faulthandler dumps of the live server — byte-identical at 25 s, 50 s and
# 75 s — put the AnyIO worker thread inside `create_module`, loading numpy's `_multiarray_umath` C
# extension, reached from `bathymetry.shelf_depth_at` where `import numpy` is a FUNCTION-level
# import. Loading that DLL from a worker thread under the running stdio event loop never returns.
#
# What the measurements ruled OUT, so nobody re-tries them:
#   * Not slowness — 3.7 s of CPU across 43 minutes of hanging.
#   * Not fastmcp and not sync-vs-async dispatch — a minimal server with a trivial sync tool
#     answers in 0.01 s on this same interpreter.
#   * Not `get_surf_spots` — whichever tool is called FIRST is the one that hangs, and a second
#     request unblocks the first (its response then arrives late, under the earlier id).
#   * Not fixed by importing `bathymetry` — numpy is imported inside the function, not at that
#     module's scope, so importing the module warms nothing.
# Importing numpy on the MAIN thread first makes the identical call return in 0.02 s.
#
# One full rating is run rather than a bare `import numpy` so that EVERY lazy import on the tool hot
# path — the bathymetry grid load, the ETOPO shore-normal asset, the magnet overrides,
# `surf_transform.estimate_surf` — is resolved here too, on the main thread. Measured cost ~0.2 s.
# Kill: SIM_EAGER_WARMUP=0.
def warm_hot_path() -> bool:
    """Resolve the tool hot path's lazy imports on the MAIN thread. Never raises."""
    if os.environ.get("SIM_EAGER_WARMUP", "1") == "0":
        return False
    try:
        import time as _time
        _t0 = _time.time()
        calculate_surf_rating(CATALOG_DEFAULTS["Mavericks"], 3.5, 16.0, 290.0, 12.0, 95.0)
        logger.info(f"hot path warmed on the main thread in {_time.time() - _t0:.2f}s")
        return True
    except Exception as e:
        # A failed warm-up must never stop the server booting — it only forfeits the protection.
        logger.warning(f"hot-path warm-up failed ({e}); the first tool call may block.")
        return False
