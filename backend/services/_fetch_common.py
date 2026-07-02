"""
Shared utilities for the direct-source GRIB fetchers + their service wrappers.

Consolidates the ~80% logic that every ``<src>_<model>_<layer>`` fetcher/service repeated, so a new
or changed source is provider-specifics only (decode + var names), not another 250-LOC copy:

  - ``coarse_axis``            half-open grid axis (identical to every fetcher's ``_coarse_axis``)
  - ``sanitize_*``            physical-range guards (NaN/masked/out-of-range -> None)
  - ``meteo_wind_dir``        u/v -> meteorological "from" direction
  - ``build_regular_nn``      nearest-neighbor map for a regular lat/lon source grid (NOAA / GWAM)
  - ``build_icosahedral_nn``  3D-unit-vector NN for the ICON icosahedral cell cloud (pole-safe,
                              lon-convention-agnostic)
  - ``make_point_dict``       the Open-Meteo-shaped point dict the normalizer consumes
  - ``run_fetcher_subprocess`` the async runner every service used to spawn a fetcher off the request path

LANDMINE NOTE: GRIB values must already be ``np.ma.filled(np.ma.asarray(values), np.nan)`` BEFORE the
sanitizers (``np.asarray`` on a masked array silently leaks the _FillValue — the EURO "10,000-ft waves"
bug). The sanitizers are the second line of defence (physical-range clamp), not the mask strip.

IMPORT STYLE — a fetcher is run both as ``python backend/services/x_fetcher.py`` (sys.path[0] =
backend/services) and imported as the package module ``services.x_fetcher``, so import defensively:

    try:    from _fetch_common import coarse_axis            # script-by-path
    except ImportError:
            from services._fetch_common import coarse_axis    # package context

numpy loads at import (present everywhere incl. Windows dev). pygrib / requests are intentionally NOT
imported here — each fetcher imports those lazily so this module stays importable for unit tests on
machines without the GRIB stack.
"""
import os
import sys
import math
import logging
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


# ─────────────────────────────── environment ───────────────────────────────
def is_test_environment() -> bool:
    """Service-level test detection (the exact predicate the per-service ``_is_test_environment`` used).

    Production env (NODE_ENV/ENV=production or IS_PROD=true) is never test. Otherwise pytest OR an
    explicit test flag => test. Services return None in test so the open-meteo mock path runs unchanged.
    """
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod_env = os.environ.get("IS_PROD", "").lower()
    if node_env == "production" or env == "production" or is_prod_env == "true":
        return False
    return (
        "pytest" in sys.modules
        or os.environ.get("NODE_ENV") == "test"
        or os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        or os.environ.get("TESTING") == "1"
    )


# ─────────────────────────────── grid ───────────────────────────────
def coarse_axis(lo: float, hi: float, step: float) -> List[float]:
    """Half-open ``[lo, hi)`` axis at ``step``, rounded to 4dp."""
    vals: List[float] = []
    v = float(lo)
    hi = float(hi)
    step = float(step)
    while v < hi - 1e-9:
        vals.append(round(v, 4))
        v += step
    return vals


# ─────────────────────────── direction downsampling ───────────────────────────
# WHY (vortex forensics 2026-07-02): the coarse products used to POINT-SAMPLE the wave-direction
# variable at one native cell per 10° coarse point. Primary/partition direction switches
# discontinuously between neighbouring sample points (live GFS grid: mean adjacent-cell delta 41°,
# p90 117°, 15% of pairs >90°, near-180° flips inside 2-4 m swell) — magnified at z4-6 that aliased
# field advects crests in a rotating pattern (the "vortex"). These helpers replace the point sample
# with the standard spectral MEAN wave direction θm = atan2(ΣE·sinθ, ΣE·cosθ), E ∝ H², which is
# smooth across neighbours and physically meaningful. FROM-convention degrees in and out.

def energy_mean_direction_block(dir_arr, h_arr, r: int, c: int, half: int, wrap_cols: bool) -> float:
    """Energy-weighted circular-mean direction (deg) over the (2·half)² block of native cells centred
    on (r, c). Latitude clamps at the array edge; longitude WRAPS when the native grid is global
    (wrap_cols=True). NaN-safe; a block with no energy (calm/land) falls back to the plain point
    sample so degenerate areas keep legacy behaviour. Used by the full-array fetchers (NOAA GFS-Wave,
    DWD GWAM). Pure — unit-tested in backend/tests/test_noaa_wave_blockmean.py."""
    nrows, ncols = dir_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(max(0, c - half), min(ncols, c + half))
    d = dir_arr[r0:r1][:, cols_idx]
    h = h_arr[r0:r1][:, cols_idx]
    ok = np.isfinite(d) & np.isfinite(h) & (h > 0.0)
    if not ok.any():
        x = dir_arr[r, c]
        return float(x) if x == x else float("nan")
    e = h[ok] ** 2
    rad = np.deg2rad(d[ok])
    s = float(np.sum(e * np.sin(rad)))
    co = float(np.sum(e * np.cos(rad)))
    if s == 0.0 and co == 0.0:
        x = dir_arr[r, c]
        return float(x) if x == x else float("nan")
    return float(np.rad2deg(np.arctan2(s, co)) % 360.0)


def energy_mean_direction_block_multi(pairs, fallback_dir_arr, r: int, c: int, half: int, wrap_cols: bool,
                                      total_h_arr=None) -> float:
    """TOTAL-SEA mean direction over the block — ENERGY-VECTOR FUSION of partitions + the model's own
    total field (fourth pass, 2026-07-02).

    Signal 1 (partitions): Σ E·unit(θₚ) across all (dir, height) partition pairs AND block cells,
    E ∝ Hₚ². Stable where the per-cell PEAK direction (NOAA DIRPW) is BIMODAL flip-zone water
    (windsea/swell trading dominance — its own sum self-cancels there).

    Signal 2 (DIRPW): Σ E·unit(DIRPW) over the block, E ∝ total-H². Stable exactly where the
    partition reconstruction fails: TRI-modal water where partition vectors mutually annihilate and
    the blend lands on a residual minority system (Baja block 20°N,-120° served TO≈257 while DIRPW
    is majority-N; ECMWF reference TO≈335–348). A 3-partition-peaks reconstruction cannot see the
    full 2-D spectrum; DIRPW can.

    FUSION: θ = atan2(s_part + s_dirpw, c_part + c_dirpw) — the raw vector sums added. Each signal
    weighs ITSELF by its own coherence × energy: an incoherent signal contributes a short vector, a
    coherent one a long vector, so the stable signal wins automatically with NO threshold and NO
    ramp (the third-pass R_d gate at 0.35 proved miscalibrated live: the Baja block's DIRPW
    coherence fell just under it, weight→0, and the wrong partition answer was retained
    byte-identically). Flip-zones: DIRPW sum ≈ 0 → partitions win (verified-at-parity regime).
    Agreeing water: both reinforce. total_h_arr=None disables signal 2 (legacy partition-only —
    the callers' NOAA_COARSE_DIR_TOTAL_FIELD=0 kill-switch path).

    Falls back to the point sample of fallback_dir_arr (DIRPW) when the block carries no energy."""
    nrows, ncols = fallback_dir_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(max(0, c - half), min(ncols, c + half))
    s = 0.0
    co = 0.0
    any_ok = False
    for dir_arr, h_arr in pairs:
        d = dir_arr[r0:r1][:, cols_idx]
        h = h_arr[r0:r1][:, cols_idx]
        ok = np.isfinite(d) & np.isfinite(h) & (h > 0.0)
        if not ok.any():
            continue
        any_ok = True
        e = h[ok] ** 2
        rad = np.deg2rad(d[ok])
        s += float(np.sum(e * np.sin(rad)))
        co += float(np.sum(e * np.cos(rad)))

    # Signal 2: the model's own total-direction field, energy-weighted by total H².
    if total_h_arr is not None:
        dt = fallback_dir_arr[r0:r1][:, cols_idx]
        ht = total_h_arr[r0:r1][:, cols_idx]
        okt = np.isfinite(dt) & np.isfinite(ht) & (ht > 0.0)
        if okt.any():
            et = ht[okt] ** 2
            radt = np.deg2rad(dt[okt])
            s += float(np.sum(et * np.sin(radt)))
            co += float(np.sum(et * np.cos(radt)))
            any_ok = True

    if not any_ok or (s == 0.0 and co == 0.0):
        x = fallback_dir_arr[r, c]
        return float(x) if x == x else float("nan")
    return float(np.rad2deg(np.arctan2(s, co)) % 360.0)


def energy_mean_direction_lonspan(dir_tyx, h_tyx, col: int, half_cols: int):
    """Per-TIMESTEP energy-weighted circular-mean direction over a LONGITUDE window (all band rows).
    For the thin-latitude-band fetcher (Copernicus CMEMS): the full 10° 2-D block is never in memory
    (bands are ~0.2° tall by design), so smoothing is longitudinal-only — CMEMS VMDR is already a MEAN
    direction (far smoother than a peak/partition direction), so 1-D smoothing suffices to kill the
    spatial aliasing. Inputs shaped (T, Y, X); columns CLAMP at the band edge (band subsets are not
    360°-continuous). Returns a (T,) float array of degrees, with the plain point sample (dir[:, row0,
    col]) per timestep wherever the window has no energy, and NaN where nothing is valid."""
    T, Y, X = dir_tyx.shape
    c0, c1 = max(0, col - half_cols), min(X, col + half_cols)
    d = dir_tyx[:, :, c0:c1]
    h = h_tyx[:, :, c0:c1]
    ok = np.isfinite(d) & np.isfinite(h) & (h > 0.0)
    e = np.where(ok, h, 0.0) ** 2
    rad = np.deg2rad(np.where(ok, d, 0.0))
    s = np.sum(e * np.sin(rad), axis=(1, 2))
    co = np.sum(e * np.cos(rad), axis=(1, 2))
    out = np.rad2deg(np.arctan2(s, co)) % 360.0
    # timesteps with no energy in the window -> fall back to the point sample (row nearest the coarse lat is
    # the caller's `row`, but any band row is equivalent at 0.083°; use the window centre column, first row)
    empty = ~ok.any(axis=(1, 2))
    if empty.any():
        point = dir_tyx[:, 0, col]
        out = np.where(empty, point, out)
    return out


# ─────────────────────────────── sanitizers ───────────────────────────────
# Each maps NaN/masked/out-of-physical-range -> None. (Inputs already np.ma.filled(..., nan) upstream.)
def sanitize_pressure_hpa(x) -> Optional[float]:
    """Pa -> hPa; valid MSL ~800-1100 hPa (≈870 typhoon .. ≈1085 Siberian high) else None."""
    if x != x:  # NaN
        return None
    hpa = float(x) / 100.0
    return round(hpa, 4) if 800.0 <= hpa <= 1100.0 else None


def sanitize_speed_ms(x, hi: float = 150.0) -> Optional[float]:
    """Wind/current speed in m/s; 0..hi else None."""
    if x != x:
        return None
    s = float(x)
    return round(s, 4) if 0.0 <= s <= hi else None


def sanitize_height_m(x, hi: float = 30.0) -> Optional[float]:
    """Wave/swell height in metres; 0..hi else None."""
    if x != x:
        return None
    h = float(x)
    return round(h, 4) if 0.0 <= h <= hi else None


def sanitize_period_s(x, hi: float = 40.0) -> Optional[float]:
    """Wave period in seconds; 0..hi else None."""
    if x != x:
        return None
    p = float(x)
    return round(p, 4) if 0.0 <= p <= hi else None


def sanitize_direction_deg(x) -> Optional[float]:
    """Any angle -> [0,360); NaN -> None."""
    if x != x:
        return None
    return round(float(x) % 360.0, 4)


def meteo_wind_dir(u: float, v: float) -> float:
    """Meteorological 'from' direction in degrees from u/v wind components: ``(270 - atan2(v,u))%360``."""
    return (270.0 - math.degrees(math.atan2(v, u))) % 360.0


# ─────────────────────────── nearest-neighbor maps ───────────────────────────
def build_regular_nn(lats, lons, lat1d, lon1d, is_360: Optional[bool] = None) -> List[Tuple[int, int]]:
    """NN map for a regular lat/lon source grid. Returns ``[(row, col)]`` for each (lat, lon) in
    row-major order (lats outer, lons inner). Auto-detects 0-360 vs -180..180 longitudes if ``is_360``
    is None and wraps query longitudes accordingly."""
    lat1d = np.asarray(lat1d, dtype=float)
    lon1d = np.asarray(lon1d, dtype=float)
    if is_360 is None:
        is_360 = bool(lon1d.max() > 180.0)
    idx: List[Tuple[int, int]] = []
    for la in lats:
        r = int(np.abs(lat1d - la).argmin())
        for lo in lons:
            tlon = (lo % 360.0) if is_360 else lo
            c = int(np.abs(lon1d - tlon).argmin())
            idx.append((r, c))
    return idx


def build_icosahedral_nn(lats, lons, clat, clon) -> List[int]:
    """3D-unit-vector NN for the ICON icosahedral cell cloud. ``clat``/``clon`` are the time-invariant
    cell coordinates in the SAME ordering as the data GRIB (radians OR degrees — auto-detected).
    Returns a flat cell index per (lat, lon) in row-major order. 3D so it is pole-safe and agnostic
    to the 0-360 vs -180..180 longitude convention."""
    clat = np.asarray(clat, dtype=float)
    clon = np.asarray(clon, dtype=float)
    if np.nanmax(np.abs(clat)) <= (math.pi + 0.01):  # radians -> degrees
        clat = np.degrees(clat)
        clon = np.degrees(clon)
    latr = np.radians(clat)
    lonr = np.radians(clon)
    X = (np.cos(latr) * np.cos(lonr)).astype(np.float32)
    Y = (np.cos(latr) * np.sin(lonr)).astype(np.float32)
    Z = np.sin(latr).astype(np.float32)
    idx: List[int] = []
    for la in lats:
        for lo in lons:
            lar = math.radians(la)
            lor = math.radians(lo)
            x0 = math.cos(lar) * math.cos(lor)
            y0 = math.cos(lar) * math.sin(lor)
            z0 = math.sin(lar)
            dot = X * x0 + Y * y0 + Z * z0
            idx.append(int(dot.argmax()))
    return idx


# ─────────────────────────── point-dict shaping ───────────────────────────
def make_point_dict(lat: float, lon: float, provider: str, hourly_units: dict, hourly: dict) -> dict:
    """Open-Meteo-shaped point dict — the exact shape the normalizer consumes. ``provider`` is the
    ``__provider`` provenance tag ('noaa'/'dwd'/...); the caller still saves with provider='open-meteo'
    so the manifest stays byte-identical (true origin lives in source_dataset/upstream_*)."""
    return {
        "latitude": float(lat), "longitude": float(lon),
        "generationtime_ms": 0, "utc_offset_seconds": 0,
        "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
        "__provider": provider,
        "hourly_units": hourly_units,
        "hourly": hourly,
    }


# ─────────────────────── async subprocess runner (services) ───────────────────────
async def run_fetcher_subprocess(
    script_name: str,
    bbox: dict,
    resolution: float,
    forecast_days: int,
    log_tag: str,
    out_prefix: str,
    timeout: int = 1800,
    extra_payload: Optional[dict] = None,
) -> Optional[List[dict]]:
    """Spawn a sibling ``<fetcher>.py`` off the request path and return its Open-Meteo-shaped points,
    or None on any failure (so the caller falls back to open-meteo).

    Returns None immediately in a test environment so the existing open-meteo mock path runs unchanged
    (every service relied on this short-circuit). ``script_name`` resolves relative to backend/services/
    unless it is already an absolute path. ``extra_payload`` (e.g. {"layer": "wind"}) is merged into the
    JSON payload for fetchers that serve more than one layer.
    """
    if is_test_environment():
        return None

    import asyncio
    import subprocess
    import json
    import tempfile
    import uuid
    from pathlib import Path

    tmp = Path(tempfile.gettempdir())
    out = tmp / f"{out_prefix}_{uuid.uuid4().hex}.json"
    payload = {
        "bbox": bbox,
        "resolution": resolution,
        "forecast_days": int(forecast_days),
        "output_path": str(out),
    }
    if extra_payload:
        payload.update(extra_payload)
    # os.path.join returns the 2nd arg unchanged when it is absolute (lets tests point at a temp script).
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), script_name)

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=timeout,
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[{log_tag}] {result.stdout.strip().splitlines()[-1]}")
        if result.returncode != 0:
            logger.error(f"[{log_tag}] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        if not out.exists():
            logger.error(f"[{log_tag}] fetcher produced no output file")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        logger.error(f"[{log_tag}] fetcher subprocess timed out (>{timeout}s)")
        return None
    except Exception as e:
        logger.error(f"[{log_tag}] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass
