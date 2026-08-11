"""Which in-process instrument can SEE the grid_series build cost?

Before writing an oracle, prove the instrument can detect the thing. Three candidates:
  (a) tracemalloc peak   -- measures LIVE traced allocation. If the build genuinely bounds
                            retention, this reads small even though production RSS rises.
  (b) process RSS delta  -- measures the arena high-water, which is what OOM-kills the box.
  (c) the count ratio    -- vectors_before_bound / vectors_total, deterministic, no timing.

If (a) reads "bounded" while (b) reads "expensive", then tracemalloc is the WRONG instrument
and an oracle built on it would pass while the box dies -- the exact failure this mission exists
to prevent.
"""
import asyncio
import gc
import os
import sys
import tracemalloc
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "Raw-Surf", "backend"))
sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")

from services.weather_pipeline import grid_series_helper as gsh  # noqa: E402

GLOBAL_COLS, GLOBAL_ROWS = 181, 83
FRAMES = 48

# The PRODUCTION vector shape, from series_vector_budget.py's own docstring:
# "one vector = an 11-key dict (lat lng speed direction u v period gust value is_valid
#  dir_confidence) = 1,226 B deep getsizeof"
def _vec(i):
    return {"lat": 0.0, "lng": float(i), "speed": 1.0, "direction": 180.0,
            "u": 0.5, "v": -0.5, "period": 10.0, "gust": 2.0,
            "value": 1.5, "is_valid": True, "dir_confidence": 0.9}


def _product(cols, rows):
    return SimpleNamespace(
        grid=SimpleNamespace(
            cols=cols, rows=rows,
            vectors=[_vec(i) for i in range(cols * rows)],
            bounds=SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0),
        ),
        valid_time=datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc),
        provider="open-meteo", is_estimated=False, run_time=None,
        upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
        served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False,
    )


def _rss_mb():
    try:
        import psutil
        return psutil.Process().memory_info().rss / 1048576.0
    except Exception:
        return None


def run_series(cols, rows, n_frames):
    async def resolve_grid(**kw):
        return _product(cols, rows)
    hours = ",".join(str(h * 3) for h in range(n_frames))
    return asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))


def measure(label, cols, rows, n_frames):
    gc.collect()
    rss0 = _rss_mb()
    tracemalloc.start()
    resp = run_series(cols, rows, n_frames)
    cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    served = sum(len(f["vectors"]) for f in resp["frames"])
    before = resp.get("vectors_before_bound", served)
    gc.collect()
    rss1 = _rss_mb()
    print(f"\n=== {label}: {cols}x{rows} x{n_frames} frames ===")
    print(f"  bounded_at        = {resp.get('bounded_at')}   stride = {resp.get('decimated_stride')}")
    print(f"  vectors_before    = {before:,}")
    print(f"  vectors_served    = {served:,}")
    print(f"  RATIO before/served = {before / max(1, served):.2f}x")
    print(f"  (a) tracemalloc PEAK live = {peak/1048576:8.1f} MB   (current at end {cur/1048576:.1f} MB)")
    print(f"  (b) process RSS delta     = {(rss1 - rss0):8.1f} MB   ({rss0:.1f} -> {rss1:.1f})")
    print(f"  peak per served vector    = {peak / max(1, served):8.0f} B")
    return {"before": before, "served": served, "peak": peak,
            "rss_delta": (rss1 - rss0) if rss0 is not None else None}


if __name__ == "__main__":
    print("warm-up (sizes the arena so the measured call is about the CALL)…")
    run_series(GLOBAL_COLS, GLOBAL_ROWS, 4)
    gc.collect()

    big = measure("GLOBAL (the measured live geometry)", GLOBAL_COLS, GLOBAL_ROWS, FRAMES)
    small = measure("SMALL (positive control)", 20, 10, FRAMES)

    print("\n=== VERDICT ===")
    print(f"  count ratio  global {big['before']/max(1,big['served']):.2f}x  "
          f"vs small {small['before']/max(1,small['served']):.2f}x")
    print(f"  tracemalloc  global {big['peak']/1048576:.1f} MB  vs small {small['peak']/1048576:.1f} MB")
    if big["rss_delta"] is not None:
        print(f"  RSS delta    global {big['rss_delta']:.1f} MB  vs small {small['rss_delta']:.1f} MB")
    print("\n  If tracemalloc's global figure is SMALL while the count ratio is LARGE, tracemalloc")
    print("  cannot see this defect and must not be the oracle.")
