"""
memory_trace — in-process RSS + collection-size history, so a leak identifies itself.

WHY THIS EXISTS. 2026-09-21 the owner reported intermittent "Couldn't load surf spots" plus slow
layers. The backend's own telemetry showed 4.6% 5xx, 11.4% of all requests over 10 s, and 21
unrelated routes stalling in the same 20-45 s band — on a process that had been up 13h42m at 1,588
MB against a 2,048 MB cgroup limit (85.3% peak). A restart cleared ALL of it: 0.0% 5xx, p50 25 ms,
0.3% over 10 s, at 1,181 MB — **under higher load** (0.64 req/s vs 0.37).

⇒ The symptom tracks PROCESS UPTIME, not load. But that conclusion rests on two snapshots of two
DIFFERENT processes, which is not a growth series and cannot be one. ⭐ Comparing a 4-hour process
to a 14-hour process tells you they differ; it cannot tell you that one GREW, because they never
shared a starting point. This module exists to replace that inference with a measurement.

## WHY IT SAMPLES THE SUSPECTS, NOT JUST RSS

Total RSS says "something grew". It cannot say what. A code audit found four module-level caches
with writes and no eviction path at all:

    sim_rating._GEOMETRY_CACHE          keyed (round(lat,6), round(lng,6)) — 0.1 m precision
    sim_forecast._CATALOG_CACHE
    local_size_preview._depth_cache
    viewport_service.NEGATIVE_CACHE     written with an expiry it never acts on

...and two that ARE bounded (`ProductStore._product_cache` with a vector budget, `tide._TIDE_CACHE`),
which are registered here **as controls**: if a bounded cache is also climbing, the bound is broken,
and if every gauge is flat while RSS climbs, the leak is somewhere none of this covers and the next
search should start elsewhere. ⭐⭐ A LEAK HUNT WITHOUT A FLAT CONTROL CANNOT DISTINGUISH "I FOUND
IT" FROM "I FOUND SOMETHING THAT ALSO GROWS".

⚠️ NONE OF THESE IS YET IMPLICATED. `_GEOMETRY_CACHE` is keyed by spot coordinate and the catalogue
has 1,773 spots, so it is probably bounded in practice despite being unbounded in form. Do not read
this module's existence as an accusation of any entry in it.

## COST, BECAUSE THIS RUNS ON THE BOX IT IS MEASURING

A sample is one `psutil` RSS read plus `len()` on a handful of dicts — microseconds. History is a
ring buffer of MAX_SAMPLES entries of small scalars, so the instrument's own footprint is bounded
and tiny (~100 bytes/sample). It must never be the thing that grows: the ring is fixed-length by
construction, not by a trim that could be skipped.

Kill switch: `MEMORY_TRACE=0` disables sampling and serves an empty history.
"""
import os
import time
from collections import deque
from typing import Any, Callable, Dict, List, Optional

# 288 samples at the 5-minute scheduler cadence = 24 hours, which comfortably spans the 14-hour
# window in which the degradation was observed. Fixed-length deque: appending past the limit drops
# from the left automatically, so the history cannot itself leak.
MAX_SAMPLES = 288

_samples: deque = deque(maxlen=MAX_SAMPLES)
_gauges: Dict[str, Callable[[], Optional[int]]] = {}
_process_start = time.time()


def enabled() -> bool:
    return os.environ.get("MEMORY_TRACE") != "0"


def register_gauge(name: str, fn: Callable[[], Optional[int]]) -> None:
    """
    Register a named size probe. `fn` must be cheap and total — it runs on the serving process, and
    a probe that raises would turn an observability feature into an outage.
    """
    _gauges[name] = fn


def _rss_mb() -> Optional[float]:
    try:
        import psutil
        return round(psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024), 1)
    except Exception:
        # None, never 0.0 — the health payload already distinguishes "unmeasured" from "measured
        # zero" for exactly this reason, and a 0 here would read as a process using no memory.
        return None


def sample() -> Optional[dict]:
    """Take one sample. Never raises; a failed gauge records None rather than losing the sample."""
    if not enabled():
        return None
    entry: Dict[str, Any] = {
        "uptime_s": round(time.time() - _process_start, 1),
        "rss_mb": _rss_mb(),
    }
    sizes: Dict[str, Optional[int]] = {}
    for name, fn in _gauges.items():
        try:
            sizes[name] = fn()
        except Exception:
            sizes[name] = None
    entry["sizes"] = sizes
    _samples.append(entry)
    return entry


def history() -> List[dict]:
    return list(_samples)


# ⛔⛔ THE BOOT RAMP MUST NOT BE MEASURED AS GROWTH (fixed 2026-09-21 from this module's FIRST live
# reading, which is exactly what shipping an instrument early is for). It reported:
#
#     rss_mb_first 400.3 -> rss_mb_last 752.6 over 0.17 h  =>  "rss_mb_per_hour: 2113.4"
#
# That is not a leak, it is STARTUP: the first sample is taken inside start_scheduler(), before the
# L2 restore has loaded ~18,000 products. And because the ring is 288 samples deep, `_samples[0]`
# stays the boot sample for a full DAY — so a first-vs-last rate would have been poisoned for the
# entire window the instrument exists to observe.
# ⭐⭐⭐ AN INSTRUMENT'S ORIGIN IS AS LOAD-BEARING AS ITS READINGS. This is the same defect class as
# the cross-process comparison it replaced: a slope measured from the wrong starting point.
WARMUP_S = 900.0        # 15 min — comfortably past the restore; tune with MEMORY_TRACE_WARMUP_S.


def _warmup_s() -> float:
    try:
        return max(0.0, float(os.environ.get("MEMORY_TRACE_WARMUP_S", WARMUP_S)))
    except (TypeError, ValueError):
        return WARMUP_S


def growth_summary() -> dict:
    """
    A per-hour rate measured from the first POST-WARMUP sample, plus what moved.

    Deliberately NOT a regression or a trend test. Two endpoints over a known interval is what the
    question "does this climb with uptime" actually needs, and a fitted slope would invite reading
    significance into a handful of points. ⭐ The raw series is in `history()`; judge it there.

    Gauges are split into `growing` (the unbounded suspects) and `controls` (the bounded ones).
    Both fill from zero at boot, so lumping them together made the controls the loudest entries in
    the first live reading — technically true, and useless for finding a leak.
    """
    warm = [s for s in _samples if s["uptime_s"] >= _warmup_s()]
    out: Dict[str, Any] = {"samples": len(_samples), "warm_samples": len(warm)}
    if _samples:
        out["uptime_s"] = _samples[-1]["uptime_s"]
        # Always publish the boot ramp rather than hiding it: it is real, and a reader who sees
        # only a suppressed rate cannot tell "still warming up" from "instrument broken".
        out["boot_rss_mb"] = _samples[0].get("rss_mb")
    if len(warm) < 2:
        out["note"] = (f"need 2 samples past {_warmup_s():.0f}s uptime to state a rate; "
                       f"before that the L2 restore dominates RSS and any rate is boot, not growth")
        return out
    first, last = warm[0], warm[-1]
    hours = max((last["uptime_s"] - first["uptime_s"]) / 3600.0, 1e-9)
    out["window_hours"] = round(hours, 2)
    if first.get("rss_mb") is not None and last.get("rss_mb") is not None:
        out["rss_mb_first"] = first["rss_mb"]
        out["rss_mb_last"] = last["rss_mb"]
        out["rss_mb_per_hour"] = round((last["rss_mb"] - first["rss_mb"]) / hours, 1)
    growing, controls = {}, {}
    for name in _gauges:
        a, b = first["sizes"].get(name), last["sizes"].get(name)
        if isinstance(a, int) and isinstance(b, int) and b != a:
            entry = {"first": a, "last": b, "per_hour": round((b - a) / hours, 1)}
            (controls if name.endswith("_CONTROL") else growing)[name] = entry
    # Only the movers, so a flat gauge is visible by its ABSENCE here while still present in
    # history() — the summary answers "what is growing", the series answers "by how much, when".
    # ⭐ An empty `growing` with a climbing `rss_mb_per_hour` is the finding that says the leak is
    # OUTSIDE everything registered here, and the next search must start somewhere new.
    out["growing"] = growing
    out["controls"] = controls
    return out


def _reset_for_test() -> None:
    _samples.clear()
    _gauges.clear()
    global _process_start
    _process_start = time.time()


def register_default_gauges() -> None:
    """
    Wire the suspects and the controls. Every import is done INSIDE the try so that a module which
    moves or is renamed costs one missing gauge, never a failed startup — this is diagnostics, and
    diagnostics must not be able to take the service down.
    """
    def _size_of(module_path: str, attr: str):
        def probe() -> Optional[int]:
            try:
                import importlib
                obj = getattr(importlib.import_module(module_path), attr, None)
                return len(obj) if obj is not None else None
            except Exception:
                return None
        return probe

    # ── SUSPECTS: module-level caches with writes and no eviction path ───────────────────────
    register_gauge("geometry_cache", _size_of("services.weather_pipeline.sim_rating", "_GEOMETRY_CACHE"))
    register_gauge("catalog_cache", _size_of("services.weather_pipeline.sim_forecast", "_CATALOG_CACHE"))
    register_gauge("depth_cache", _size_of("services.weather_pipeline.local_size_preview", "_depth_cache"))

    def _negative_cache() -> Optional[int]:
        try:
            from services.weather_pipeline.viewport_service import viewport_service
            return len(getattr(viewport_service, "NEGATIVE_CACHE", {}) or {})
        except Exception:
            return None
    register_gauge("negative_cache", _negative_cache)

    def _active_revalidations() -> Optional[int]:
        # 6 `.add()` sites across 4 modules against ONE `.discard()` — an asymmetry worth watching
        # even though a set of short keys cannot by itself account for hundreds of MB.
        try:
            from services.weather_pipeline.viewport_service import viewport_service
            return len(getattr(viewport_service, "ACTIVE_REVALIDATIONS", ()) or ())
        except Exception:
            return None
    register_gauge("active_revalidations", _active_revalidations)

    # ── CONTROLS: these are bounded. If one climbs, its bound is broken; if ALL gauges stay flat
    #    while rss_mb climbs, the leak is outside everything registered here and the next search
    #    must start somewhere new rather than re-examining this list.
    def _product_cache() -> Optional[int]:
        try:
            from services.weather_pipeline.store import ProductStore
            return len(getattr(ProductStore, "_product_cache", {}) or {})
        except Exception:
            return None
    register_gauge("product_cache_CONTROL", _product_cache)

    register_gauge("tide_cache_CONTROL", _size_of("services.weather_pipeline.tide", "_TIDE_CACHE"))
