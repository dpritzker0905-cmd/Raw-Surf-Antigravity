"""
Shared utilities for the direct-source GRIB fetchers + their service wrappers.

Consolidates the ~80% logic that every ``<src>_<model>_<layer>`` fetcher/service repeated, so a new
or changed source is provider-specifics only (decode + var names), not another 250-LOC copy:

  - ``coarse_axis``            endpoint-INCLUSIVE grid axis (full-wrap lon stays exclusive) — the
                               ONE axis truth; the fetchers' ``_coarse_axis`` names delegate here
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


def http_session(kill_env: str = "FETCH_HTTP_SESSION"):
    """A connection-POOLED stand-in for the bare ``requests`` module, for the byte-range fetchers.

    THE DEFECT (measured 2026-08-06, MASTER-AUDIT-9.0 §1.3). Not one of the six GRIB fetchers used a
    ``requests.Session``: every ``requests.get``/``.head`` was a module-level call, so each one paid a
    fresh TCP connect + TLS handshake. Measured against the real upstream (nomads.ncep.noaa.gov,
    n=6 after DNS warm)::

        bare requests.head   480.6 ms/call
        pooled Session.head  134.1 ms/call      -> 346.5 ms saved per call (3.6x)

    A NOAA wave step makes 4 calls (one ``.idx`` GET + three coalesced range GETs) = ~1.39 s/step, and
    a 14-day run is ``range(0, 337, 3)`` = 113 steps => **~157 s of pure handshake per run**, against a
    ``NOAA_FETCH_BUDGET_S`` of 2400 with only 27% headroom (the 2026-08-02 lane loss was upstream
    merely SLOWING into that margin).

    ★ WHY THIS IS A ONE-LINE CHANGE AT EACH SITE. Every fetcher already INJECTS its HTTP client into
    the helpers that use it — ``_pick_cycle(requests, ...)``, ``_fetch_message_bytes(requests, ...)``,
    ``_download_grib(requests, ...)``, ``_download_decode(requests, pygrib, ...)``. A ``Session``
    exposes the identical ``.get``/``.head`` interface, so it drops into that seam with no signature
    change anywhere. The seam was already there; nothing was using it.

    ⚠️ ``requests`` is imported INSIDE this function on purpose — this module's contract is that it
    stays importable on machines without the GRIB stack (see the module docstring), and a top-level
    ``import requests`` would quietly break that for the unit tests.

    Kill switch: ``FETCH_HTTP_SESSION=0`` returns the bare module, restoring per-call connections
    byte-for-byte. Callers are short-lived subprocesses, so the pool is reclaimed at process exit.
    """
    import requests
    if os.environ.get(kill_env, "1") == "0":
        return requests
    # ⚠️ A SUBSTITUTED MODULE IS ALREADY A CLIENT — caught by `test_icon_wind_multi_bbox_fetch.py`
    # on this change's first run. The fetcher tests install a double with
    # `monkeypatch.setitem(sys.modules, "requests", fake)`, and it exposes `.get`/`.head` and nothing
    # else. Calling `.Session()` on that raises — and the tempting "fix", reaching past it to the real
    # module, would be far worse: the suite would make LIVE NETWORK CALLS to NOMADS and DWD while
    # looking green. No `Session` factory means "I am the client", so hand it straight back.
    if not hasattr(requests, "Session"):
        return requests
    return requests.Session()


# ─────────────────────────────── grid ───────────────────────────────
def coarse_axis(lo: float, hi: float, step: float) -> List[float]:
    """Axis ``lo..hi`` INCLUSIVE of both endpoints, rounded to 4dp — matching
    ``generate_bbox_coords`` / the open-meteo generator (both ``<= hi + eps``).

    FENCEPOST (2026-07-18, round 2): the previous half-open ``[lo, hi)`` form under-supplied every
    consumer's product by one east COLUMN and one north ROW relative to the normalizer's
    bbox-declared inclusive grid, which back-filled them as explicit ``is_valid=false`` — the live
    "hard vertical no-anim line". ``noaa_gfs_wave_fetcher`` was fixed first (79d34611, goldens);
    the sweep missed these siblings: this shared copy (ECMWF/EURO all layers + ICON pressure) and
    the five inlined ``_coarse_axis`` copies (NOAA wind/pressure, ICON wind, GWAM, Copernicus
    global) — which now all delegate here.
    EXCEPTION: a full-wrap 360° longitude axis stays endpoint-exclusive (+180 duplicates -180)."""
    vals: List[float] = []
    lo = float(lo)
    hi = float(hi)
    step = float(step)
    full_wrap = (hi - lo) >= 360.0 - step * 0.5
    limit = (hi - step * 0.5) if full_wrap else (hi + 1e-4)
    v = lo
    while v <= limit:
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


def energy_mean_direction_block_partition_conf(dir_arr, h_arr, r: int, c: int, half: int,
                                               wrap_cols: bool):
    """A PARTITION's block direction plus an honest confidence — ``(direction_deg, conf)``.

    ⚠️⚠️ WHY A PARTITION NEEDS ITS OWN CONFIDENCE, DIFFERENT FROM THE TOTAL'S (2026-07-31, measured).
    `energy_mean_direction_block` weights by energy and therefore only ever sees subcells where the
    partition EXISTS (``h > 0``). A partition is exact-0 wherever WW3 classified that subcell's
    energy to a different partition, so a block can be almost empty of a train and still yield a
    perfectly confident bearing for it. Measured live on the served 2° products:

        s_ocean    swell_2      1 of 64 subcells carried the train   -> R = 1.00
        s_pacific  swell_2      4 of 64                              -> R = 1.00
        n_pacific  wind_waves   1 of 64                              -> R = 1.00

    Those cells paint ~200 km of ocean with a direction that exists in 2-6 % of it, and the
    resultant length CANNOT catch it — R measures agreement AMONG CONTRIBUTORS, and a handful of
    agreeing subcells agree perfectly. The honest signal is therefore

        conf = R x coverage      coverage = (subcells with energy) / (finite subcells)

    which collapses to R on a fully-populated block (the total-sea case, unchanged) and goes to ~0
    exactly where the layer is claiming a train it does not have. Nothing is dropped here: the
    direction is still returned, and the CONSUMER decides — the frontend already carries
    `dir_confidence` per vector into the texture encoder.

    ★ The HEIGHT half is already honest: `energy_mean_height_block` includes genuine 0.0 subcells,
    so it reports a correctly small Hs. It was only the direction that spoke with false confidence.
    Pure/NaN-safe. Unit-tested in backend/tests/test_partition_direction_coverage.py."""
    nrows, ncols = dir_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(
        max(0, c - half), min(ncols, c + half))
    d = dir_arr[r0:r1][:, cols_idx]
    h = h_arr[r0:r1][:, cols_idx]
    finite = np.isfinite(d) & np.isfinite(h)
    ok = finite & (h > 0.0)
    n_finite = int(np.count_nonzero(finite))
    if not ok.any():
        x = dir_arr[r, c]
        return (float(x) if x == x else float("nan")), 0.0
    e = h[ok] ** 2
    rad = np.deg2rad(d[ok])
    s = float(np.sum(e * np.sin(rad)))
    co = float(np.sum(e * np.cos(rad)))
    tot_e = float(np.sum(e))
    if (s == 0.0 and co == 0.0) or tot_e <= 0.0:
        x = dir_arr[r, c]
        return (float(x) if x == x else float("nan")), 0.0
    resultant = float(np.hypot(s, co) / tot_e)          # R in [0,1]: agreement among contributors
    coverage = (int(np.count_nonzero(ok)) / n_finite) if n_finite else 0.0
    direction = float(np.rad2deg(np.arctan2(s, co)) % 360.0)
    return direction, max(0.0, min(1.0, resultant * coverage))


# Coherence ramp for the two-tier total-sea direction (see energy_mean_direction_block_multi):
# below RAMP_LO the model's own total-direction field (DIRPW) is treated as incoherent (bimodal
# flip-zone) and the partition blend is used alone; above RAMP_HI DIRPW is fully trusted; between,
# the two are mixed continuously (unit-vector blend) so adjacent blocks can never seam across the gate.
DIR_TOTAL_COHERENCE_RAMP_LO = 0.35
DIR_TOTAL_COHERENCE_RAMP_HI = 0.65


def energy_mean_direction_block_multi(pairs, fallback_dir_arr, r: int, c: int, half: int, wrap_cols: bool,
                                      total_h_arr=None) -> float:
    """Direction-only wrapper — see energy_mean_direction_block_multi_conf for the full contract."""
    return energy_mean_direction_block_multi_conf(pairs, fallback_dir_arr, r, c, half, wrap_cols, total_h_arr)[0]


def energy_mean_direction_block_multi_conf(pairs, fallback_dir_arr, r: int, c: int, half: int, wrap_cols: bool,
                                           total_h_arr=None):
    """TOTAL-SEA mean direction over the block — coherence-gated two-tier (third pass, 2026-07-02).

    Tier 1 (partitions): θ = atan2(ΣₚΣ E·sinθₚ, ΣₚΣ E·cosθₚ), E ∝ Hₚ², across all (dir, height)
    partition pairs AND block cells. Introduced because the per-cell PEAK direction (NOAA DIRPW) is
    BIMODAL in two-system water — its block mean cancels and flips (N-Atl measured mean 50°/max 154°).

    Tier 2 (the model's own total field): the partition reconstruction has its OWN failure mode,
    found live off Baja (block 20°N,-120°, user-visible east→west crest motion): in TRI-modal water
    the partition energy vectors mutually cancel (swell1 TO≈163 vs swell2 TO≈332 annihilate) and the
    blend lands on the residual minority system (windwave, TO≈257) while the model's own
    full-spectrum total (DIRPW) is stably N across the block (TO 16–18 at 7/9 pinned-reference
    points; H²-weighted block mean TO=6; ECMWF best_match TO≈348). A 3-partition-peaks
    reconstruction cannot see the full 2-D spectrum; DIRPW can.

    Gate: R_d = |Σ E·unit(DIRPW)| / Σ E over the block (circular-statistics resultant length,
    E ∝ total-H²). R_d high → DIRPW's block mean IS the stable truth (use it). R_d low → DIRPW is
    flip-zone bimodal → partition blend (its verified-at-parity regime). In between: continuous
    unit-vector mix (no block seams). total_h_arr=None disables tier 2 (legacy partition-only —
    the callers' NOAA_COARSE_DIR_TOTAL_FIELD=0 kill-switch path).

    Falls back to the point sample of fallback_dir_arr (DIRPW) when the block carries no energy.

    Returns (direction_deg, confidence) — confidence is the circular resultant length of whatever
    estimator produced the direction (0..1, §0B-a render-confidence export, 2026-07-03):
      · partition-only tier → R_p = |Σ E·unit(θₚ)| / Σ E (LOW exactly when partitions annihilate —
        the (20,-120) Baja class whose blend direction is a meaningless residual);
      · DIRPW tier → R_d (the gate value itself);
      · mixed tier → the w-blend of the two, additionally scaled by |mixed unit vector| (→0 when
        the two tiers point opposite ways — the direction between them is arbitrary);
      · point-sample fallback → None (no blockwise evidence either way).
    Consumers fade crest rendering below ~0.65 (heatmap untouched): show nothing confidently wrong."""
    nrows, ncols = fallback_dir_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(max(0, c - half), min(ncols, c + half))
    s = 0.0
    co = 0.0
    e_sum_p = 0.0
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
        e_sum_p += float(np.sum(e))

    # Tier 2: block mean + coherence of the model's own total-direction field, weighted by total H².
    w = 0.0
    r_d = 0.0
    ds = dco = 0.0
    if total_h_arr is not None:
        dt = fallback_dir_arr[r0:r1][:, cols_idx]
        ht = total_h_arr[r0:r1][:, cols_idx]
        okt = np.isfinite(dt) & np.isfinite(ht) & (ht > 0.0)
        if okt.any():
            et = ht[okt] ** 2
            radt = np.deg2rad(dt[okt])
            ds = float(np.sum(et * np.sin(radt)))
            dco = float(np.sum(et * np.cos(radt)))
            e_sum = float(np.sum(et))
            if e_sum > 0.0:
                r_d = float(np.hypot(ds, dco)) / e_sum
                w = min(1.0, max(0.0, (r_d - DIR_TOTAL_COHERENCE_RAMP_LO)
                                 / (DIR_TOTAL_COHERENCE_RAMP_HI - DIR_TOTAL_COHERENCE_RAMP_LO)))

    r_p = (float(np.hypot(s, co)) / e_sum_p) if e_sum_p > 0.0 else 0.0

    have_partition = any_ok and not (s == 0.0 and co == 0.0)
    have_total = w > 0.0 and not (ds == 0.0 and dco == 0.0)
    if have_partition and have_total:
        # continuous mix of the two UNIT vectors — degrees-safe, seam-free across the gate
        pm = float(np.hypot(s, co)) or 1.0
        tm = float(np.hypot(ds, dco)) or 1.0
        mx = (1.0 - w) * (s / pm) + w * (ds / tm)
        my = (1.0 - w) * (co / pm) + w * (dco / tm)
        if mx != 0.0 or my != 0.0:
            conf = ((1.0 - w) * r_p + w * r_d) * float(np.hypot(mx, my))
            return float(np.rad2deg(np.arctan2(mx, my)) % 360.0), min(1.0, max(0.0, conf))
    if have_total and not have_partition:
        return float(np.rad2deg(np.arctan2(ds, dco)) % 360.0), min(1.0, max(0.0, r_d))
    if have_partition:
        return float(np.rad2deg(np.arctan2(s, co)) % 360.0), min(1.0, max(0.0, r_p))
    x = fallback_dir_arr[r, c]
    return (float(x) if x == x else float("nan")), None


def energy_mean_height_block(h_arr, r: int, c: int, half: int, wrap_cols: bool) -> float:
    """RMS significant height over the (2·half)² block of native cells centred on (r, c) —
    Hs² ∝ energy, so the block's honest Hs is the root-mean-square of subcell heights over VALID
    (finite) subcells. Land/ice-masked NaN subcells are excluded; genuine 0.0 ocean subcells are
    INCLUDED so calm blocks stay honest. Falls back to the point sample when the block is all-NaN.

    WHY (wind_waves tri-model forensics 2026-07-04): PARTITIONED fields (WW3 WVHGT / SWELL_2) are
    exact-0.0 wherever a subcell classifies to another partition, and that classification flickers
    per forecast hour. Center-point sampling turned partially-windsea 10° blocks into 0.0 heatmap
    pixels that pothole in time — live: cell (-60,-50) read 0.0 at T00 / 4.7 m at T12 in OUR product
    while both the open-meteo reference and our own /point direct ladder read 7.64 m; 9/629 cells
    contradicted the reference. Directions already block-aggregate (energy_mean_direction_block);
    this is the symmetric height treatment."""
    nrows, ncols = h_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(max(0, c - half), min(ncols, c + half))
    h = h_arr[r0:r1][:, cols_idx]
    ok = np.isfinite(h)
    if not ok.any():
        x = h_arr[r, c]
        return float(x) if x == x else float("nan")
    return float(np.sqrt(np.mean(h[ok] ** 2)))


def energy_mean_scalar_block(x_arr, h_arr, r: int, c: int, half: int, wrap_cols: bool) -> float:
    """Energy-weighted (E ∝ H²) block mean of a scalar PAIRED with a height field (wave periods).
    Subcells without energy (h ≤ 0 / NaN) carry no meaningful period and are excluded. Falls back
    to the point sample when the block carries no energy — same degenerate-block contract as
    energy_mean_direction_block."""
    nrows, ncols = x_arr.shape
    r0, r1 = max(0, r - half), min(nrows, r + half)
    cols_idx = (np.arange(c - half, c + half) % ncols) if wrap_cols else np.arange(max(0, c - half), min(ncols, c + half))
    xs = x_arr[r0:r1][:, cols_idx]
    h = h_arr[r0:r1][:, cols_idx]
    ok = np.isfinite(xs) & np.isfinite(h) & (h > 0.0)
    if not ok.any():
        x = x_arr[r, c]
        return float(x) if x == x else float("nan")
    e = h[ok] ** 2
    return float(np.sum(e * xs[ok]) / np.sum(e))


def energy_mean_direction_lonspan(dir_tyx, h_tyx, col: int, half_cols: int):
    """Direction-only wrapper — see energy_mean_direction_lonspan_conf for the full contract."""
    return energy_mean_direction_lonspan_conf(dir_tyx, h_tyx, col, half_cols)[0]


def energy_mean_direction_lonspan_conf(dir_tyx, h_tyx, col: int, half_cols: int):
    """Per-TIMESTEP energy-weighted circular-mean direction over a LONGITUDE window (all band rows).
    For the thin-latitude-band fetcher (Copernicus CMEMS): the full 10° 2-D block is never in memory
    (bands are ~0.2° tall by design), so smoothing is longitudinal-only — CMEMS VMDR is already a MEAN
    direction (far smoother than a peak/partition direction), so 1-D smoothing suffices to kill the
    spatial aliasing. Inputs shaped (T, Y, X); columns CLAMP at the band edge (band subsets are not
    360°-continuous).

    Returns (directions, confidence): (T,) float arrays. directions in degrees, with the plain point
    sample (dir[:, 0, col]) per timestep wherever the window has no energy, and NaN where nothing is
    valid. confidence is the circular resultant length R = |Σ E·unit(θ)| / Σ E of the window
    (0..1 — the §0B-a render-confidence export the NOAA coarse fetcher already ships): R low = the
    window's mean direction is a meaningless bimodal residual (crest consumers fade below ~0.65);
    NaN wherever the direction fell back to the point sample (no windowed evidence either way)."""
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
    e_sum = np.sum(e, axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        conf = np.where(e_sum > 0.0, np.hypot(s, co) / np.where(e_sum > 0.0, e_sum, 1.0), np.nan)
    conf = np.clip(conf, 0.0, 1.0)
    # timesteps with no energy in the window -> fall back to the point sample (row nearest the coarse lat is
    # the caller's `row`, but any band row is equivalent at 0.083°; use the window centre column, first row)
    empty = ~ok.any(axis=(1, 2))
    if empty.any():
        point = dir_tyx[:, 0, col]
        out = np.where(empty, point, out)
        conf = np.where(empty, np.nan, conf)
    return out, conf


def energy_mean_height_lonspan(h_tyx, col: int, half_cols: int):
    """Per-TIMESTEP RMS significant height over a LONGITUDE window (all band rows) — the HEIGHT sibling
    of energy_mean_direction_lonspan for the thin-band Copernicus (CMEMS) fetcher. Hs² ∝ energy, so the
    honest coarse Hs is the RMS of the window's FINITE subcells (genuine 0.0 ocean subcells INCLUDED so
    calm blocks stay honest; land/ice-masked NaN excluded). THE ENCLOSED-SEA DROPOUT FIX (2026-07-22):
    the height was point-sampled at one native column (a[:, row, col]); a coarse cell whose exact column
    lands on masked land (a coastline / delta / enclosed-sea edge) sampled NaN and dropped the whole
    cell — so the Gulf of Mexico / Mediterranean / Gulf of California / … went BLANK for EURO. The window
    RMS survives such a cell as long as ANY ocean subcell exists in ±half_cols; an all-NaN (true land)
    window still falls back to the NaN point sample → the cell stays empty (nothing paints on land).
    Inputs shaped (T, Y, X); columns clamp at the band edge. Returns a (T,) float array."""
    T, Y, X = h_tyx.shape
    c0, c1 = max(0, col - half_cols), min(X, col + half_cols)
    h = h_tyx[:, :, c0:c1]
    ok = np.isfinite(h)
    cnt = np.sum(ok, axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        e_sum = np.sum(np.where(ok, h, 0.0) ** 2, axis=(1, 2))
        rms = np.sqrt(e_sum / np.where(cnt > 0, cnt, 1))
    empty = cnt == 0
    if empty.any():
        rms = np.where(empty, h_tyx[:, 0, col], rms)
    return rms


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
def fill_masked_waves_from_gfs(waves_points, gfs_points, height_key="wave_height",
                               dir_key="wave_direction", period_key="wave_period", _diag=None):
    """GULF / ENCLOSED-SEA / ANTARCTIC FIX (2026-07-22). The EURO coarse `waves` source (ECMWF-WAM or
    CMEMS) structurally MASKS enclosed seas (Gulf of Mexico, E Med, Black Sea, Sea of Japan, Gulf of
    California) AND the Southern Ocean south of ~-60 (the "Antarctic projection" regression): those cells
    come back NaN/None -> is_valid=FALSE and the heatmap inflates them from distant open-ocean cells
    (~4-5ft where reality is ~1.5ft). NOAA GFS/WW3's land-sea mask DOES carry those cells (why GFS renders
    correctly). This fills every masked wave-height cell from the ALIGNED GFS coarse grid (all coarse
    fetchers share coarse_axis -> identical cell centres), leaving the ECMWF/CMEMS open-ocean values
    untouched; direction/period are filled alongside so the arrows stay honest. Matches by (lat,lon) cell
    and by TIME value (GFS is hourly, waves 3-hourly -> a superset). Mutates waves_points in place and
    returns the number of (cell,hour) values filled. Pure + side-effect-scoped for unit testing."""
    if not waves_points or not gfs_points:
        return 0

    def _key(p):
        try:
            return (round(float(p.get("latitude")), 3), round(float(p.get("longitude")), 3))
        except (TypeError, ValueError):
            return None

    def _masked(v):
        return v is None or (isinstance(v, float) and math.isnan(v))

    # Time-value match must be FORMAT-ROBUST: GFS via open-meteo is offset-NAIVE ('...T00:00'), while
    # ECMWF/CMEMS/NOAA-direct are aware ('...T00:00:00Z'). String-matching them would silently fill 0
    # cells. Normalize every timestamp to a UTC-aware datetime key (falls back to the raw string).
    from datetime import datetime, timezone

    def _tkey(t):
        if not t:
            return None
        try:
            dt = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return str(t)

    # GFS lookup: cell -> {time_key: (height, dir, period)}
    gfs = {}
    for gp in gfs_points:
        k = _key(gp)
        if k is None:
            continue
        gh = gp.get("hourly", {}) or {}
        gt = gh.get("time", []) or []
        ghh = gh.get(height_key, []) or []
        gdd = gh.get(dir_key, []) or []
        gpp = gh.get(period_key, []) or []
        m = {}
        for i, t in enumerate(gt):
            tk = _tkey(t)
            if tk is not None:
                m[tk] = (ghh[i] if i < len(ghh) else None,
                         gdd[i] if i < len(gdd) else None,
                         gpp[i] if i < len(gpp) else None)
        gfs[k] = m

    filled = 0
    # DIAGNOSTIC (2026-07-22): the fill ran with valid GFS data in hand yet filled 0 cells in prod bakes
    # (run 29933575013) while a served-data reproduction fills 126 — the mismatch is invisible to static
    # analysis, so instrument the RAW ingest data. When `_diag` is a dict, record the breakdown + one sample
    # so a single re-bake pinpoints the cause (cell-key miss vs time-value miss vs GFS-also-masked). Cheap;
    # no behavior change. See scheduler.ingest_euro_marine_global.
    d_cellhit = d_cellmiss = d_masked = d_timemiss = d_gfsmasked = 0
    d_sample = None
    for wp in waves_points:
        cell = gfs.get(_key(wp))
        if not cell:
            d_cellmiss += 1
            if _diag is not None and d_sample is None and gfs:
                # first waves cell with NO matching GFS cell: capture both keys for comparison
                _gk = next(iter(gfs))
                d_sample = {"reason": "cell_miss", "wkey": list(_key(wp) or ()), "sample_gfs_key": list(_gk)}
            continue
        d_cellhit += 1
        wh = wp.get("hourly", {}) or {}
        wt = wh.get("time", []) or []
        whh = wh.get(height_key, [])
        wdd = wh.get(dir_key, [])
        wpp = wh.get(period_key, [])
        for i, t in enumerate(wt):
            if i >= len(whh) or not _masked(whh[i]):
                continue
            d_masked += 1
            g = cell.get(_tkey(t))
            if not g:
                d_timemiss += 1
                if _diag is not None and (d_sample is None or d_sample.get("reason") == "cell_miss"):
                    d_sample = {"reason": "time_miss", "wkey": list(_key(wp) or ()),
                                "wtime": str(t), "gfs_times": [str(x) for x in list(cell.keys())[:4]]}
                continue
            if _masked(g[0]):
                d_gfsmasked += 1
                continue  # GFS also has no ocean cell here (true land) -> leave masked (nothing on land)
            whh[i] = g[0]
            if i < len(wdd) and _masked(wdd[i]) and g[1] is not None:
                wdd[i] = g[1]
            if i < len(wpp) and _masked(wpp[i]) and g[2] is not None:
                wpp[i] = g[2]
            filled += 1
    if _diag is not None:
        _diag.update({"n_waves": len(waves_points), "n_gfs": len(gfs_points), "gfs_cells": len(gfs),
                      "cell_hit": d_cellhit, "cell_miss": d_cellmiss, "masked_seen": d_masked,
                      "time_miss": d_timemiss, "gfs_masked": d_gfsmasked, "filled": filled, "sample": d_sample})
    return filled


def make_point_dict(lat: float, lon: float, provider: str, hourly_units: dict, hourly: dict) -> dict:
    """Open-Meteo-shaped point dict — the exact shape the normalizer consumes. ``provider`` is the
    ``__provider`` provenance tag ('noaa'/'dwd'/'ecmwf'/...); the caller still saves with
    provider='open-meteo' so the manifest stays byte-identical.

    ⚠️ THIS DOCSTRING USED TO CLAIM "true origin lives in source_dataset/upstream_*" AND IT WAS NOT
    TRUE. Measured 2026-07-30: `upstream_provider` merely echoed the dispatch `provider`, so EURO
    marine waves reported `open-meteo` for both while the data came from ECMWF Open Data direct —
    and `source_dataset` ('ecmwf_wam025') names the MODEL, which Open-Meteo also serves under that
    exact name. Nothing recorded the fetch ROUTE, so the manifest could not answer "is EURO on
    open-meteo?" at all. `__provider` was being dropped on the floor.
    The normalizer now propagates this tag into `upstream_provider`, which finally makes the
    sentence above true — keep stamping it."""
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
        # stdin=DEVNULL: fetchers read argv, never stdin — and inheriting the parent's stdin
        # handle fails CreateProcess (WinError 50) when the parent's fds are redirected
        # (pytest capture; some daemon contexts). Explicit is strictly safer everywhere.
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=timeout,
            stdin=subprocess.DEVNULL,
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
