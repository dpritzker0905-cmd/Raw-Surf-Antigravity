"""M2 -- what would "bound before materialisation" ACTUALLY save, per regime?

`ProductStore.load_product` on a cache HIT does (store.py:663-667):

    cloned = cached_product.model_copy()
    if cloned.grid is not None:
        cloned.grid = cloned.grid.model_copy()      # BOTH SHALLOW
    return cloned

so `cloned.grid.vectors` IS the list object in `_product_cache`. On a warm cache NO GridVector is
constructed -- `vectors_before_bound` counts SHARED REFERENCES, not allocations. On a miss the
product is deserialised or rebuilt and the vectors really are constructed.

Mission 2 is "bound BEFORE GridVector materialisation". That is only worth doing in the regime
where materialisation happens. This measures both regimes with the same harness:

  WARM   resolver returns the SAME shared vector list every hour (the cache-hit shape)
  COLD   resolver builds a fresh vector list every hour (the cache-miss shape)

and reports, for each, the allocations a resolution-time bound could avoid.

If WARM shows ~zero avoidable allocation, then on a warm box Mission 2 saves nothing and the
+157 MB has another cause -- which would REFUTE the mission as framed rather than deliver it.
"""
import asyncio
import gc
import sys
import tracemalloc
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")

from services.weather_pipeline import grid_series_helper as gsh          # noqa: E402
from services.weather_pipeline.series_vector_budget import stride_for    # noqa: E402

COLS, ROWS, FRAMES = 181, 83, 48


def _vec(i):
    return {"lat": 0.0, "lng": float(i), "speed": 1.0, "direction": 180.0,
            "u": 0.5, "v": -0.5, "period": 10.0, "gust": 2.0,
            "value": 1.5, "is_valid": True, "dir_confidence": 0.9}


def _product_from(vectors, cols, rows):
    return SimpleNamespace(
        grid=SimpleNamespace(cols=cols, rows=rows, vectors=vectors,
                             bounds=SimpleNamespace(west=-180.0, south=-80.0,
                                                    east=180.0, north=85.0)),
        valid_time=datetime(2026, 8, 10, 15, 0, tzinfo=timezone.utc),
        provider="open-meteo", is_estimated=False, run_time=None,
        upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
        served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False,
    )


def run(regime, stride_at_resolution=None):
    """stride_at_resolution=None reproduces HEAD. An int simulates Mission 2: the resolver
    hands back an ALREADY-strided grid, so the full one is never built."""
    shared = [_vec(i) for i in range(COLS * ROWS)] if regime == "WARM" else None
    built = {"vectors": 0}

    async def resolve_grid(**kw):
        if stride_at_resolution and stride_at_resolution > 1:
            kc = len(range(0, COLS, stride_at_resolution))
            kr = len(range(0, ROWS, stride_at_resolution))
            if regime == "WARM":
                # a strided VIEW of the cached list -- still zero construction
                v = [shared[r * COLS + c]
                     for r in range(0, ROWS, stride_at_resolution)
                     for c in range(0, COLS, stride_at_resolution)]
            else:
                v = [_vec(i) for i in range(kc * kr)]
                built["vectors"] += kc * kr
            return _product_from(v, kc, kr)
        if regime == "WARM":
            return _product_from(shared, COLS, ROWS)          # shallow: zero construction
        v = [_vec(i) for i in range(COLS * ROWS)]
        built["vectors"] += COLS * ROWS
        return _product_from(v, COLS, ROWS)

    hours = ",".join(str(h * 3) for h in range(FRAMES))
    gc.collect()
    tracemalloc.start()
    resp = asyncio.run(gsh._build_grid_series_impl(
        resolve_grid, None, "GFS", "marine", "waves", "-180,-80,180,85", hours))
    _cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    served = sum(len(f["vectors"]) for f in resp["frames"])
    before = resp.get("vectors_before_bound", served)
    return {"regime": regime, "stride_at_res": stride_at_resolution,
            "constructed": built["vectors"], "before": before, "served": served,
            "peak_mb": peak / 1048576}


if __name__ == "__main__":
    st = stride_for(COLS, ROWS, FRAMES)
    print(f"stride the bound picks: {st}\n")
    rows = [
        run("WARM", None), run("WARM", st),
        run("COLD", None), run("COLD", st),
    ]
    print(f"{'regime':7} {'bound@res':>10} {'CONSTRUCTED':>13} {'before':>10} "
          f"{'served':>8} {'peak MB':>9}")
    for r in rows:
        print(f"{r['regime']:7} {str(r['stride_at_res'] or '-'):>10} "
              f"{r['constructed']:>13,} {r['before']:>10,} {r['served']:>8,} "
              f"{r['peak_mb']:>9.1f}")

    warm_head, warm_fix, cold_head, cold_fix = rows
    print("\n=== WHAT MISSION 2 WOULD SAVE ===")
    print(f"  WARM (cache hit) : constructions {warm_head['constructed']:,} -> "
          f"{warm_fix['constructed']:,}   peak {warm_head['peak_mb']:.1f} -> "
          f"{warm_fix['peak_mb']:.1f} MB")
    print(f"  COLD (cache miss): constructions {cold_head['constructed']:,} -> "
          f"{cold_fix['constructed']:,}   peak {cold_head['peak_mb']:.1f} -> "
          f"{cold_fix['peak_mb']:.1f} MB")
    if warm_head["constructed"] == 0:
        print("\n  => On a WARM cache the bound saves ZERO constructions: the vectors already")
        print("     exist and are shared. `vectors_before_bound` counts references there.")
    saved = cold_head["constructed"] - cold_fix["constructed"]
    print(f"  => On a COLD cache it avoids {saved:,} constructions "
          f"({saved / max(1, cold_head['constructed']):.0%} of them).")
