"""
surf_transform.py — bathymetry-driven nearshore wave transformation (offshore swell -> surf height).

OPTION-2 surf transform (shelf-scale first cut). Takes deep/intermediate-water bulk swell (significant
height Hs, peak period Tp) plus a nearshore water depth, and applies LINEAR WAVE THEORY shoaling +
depth-limited breaking to estimate the breaking ("surf") wave height.

WHY THIS IS THE RIGHT FIRST CUT:
  - Shoaling (Ks): as a wave train moves into shallower water its group speed drops and the height rises.
  - Depth-limited breaking: a wave cannot stand taller than ~gamma * depth (gamma ~= 0.78); past that it
    breaks. So a broad SHALLOW shelf caps even a big offshore swell to small surf (why Florida's east coast
    is much smaller than the offshore swell), while a STEEP shelf lets more energy through (much of the US
    West Coast). That depth-limited cap is the dominant physical effect, captured here.
  - Refraction (Kr, needs a per-point shore-normal) and bottom friction are deliberate PHASE-2 refinements.

This is an ESTIMATE from BULK parameters (we have Hs/Tp/dir, not the full directional spectrum), so callers
MUST tag it is_estimated and present it as "surf", never as authoritative model output.

Pure ``math`` only — no I/O, no network, no numpy dependency — so it runs in-process on the serve-only box
(cheap, per-point) and is fully unit-testable without the GRIB/data stack.
"""
import math

G = 9.81            # gravitational acceleration (m/s^2)
GAMMA = 0.78        # depth-limited breaking index: H_break ~= GAMMA * depth
DEEP_RATIO = 0.5    # d/L0 > 0.5 == deep water (shoaling negligible) — standard linear-theory cutoff


def wavenumber(period_s: float, depth_m: float):
    """Solve the linear dispersion relation omega^2 = g k tanh(k d) for the wavenumber k (rad/m), by
    Newton iteration seeded with the deep-water value. Returns None for non-physical inputs."""
    if period_s is None or depth_m is None or period_s <= 0 or depth_m <= 0:
        return None
    omega = 2.0 * math.pi / period_s
    k = omega * omega / G  # deep-water seed: k0 = omega^2 / g
    for _ in range(60):
        tkd = math.tanh(k * depth_m)
        f = G * k * tkd - omega * omega
        sech2 = 1.0 - tkd * tkd                      # sech^2 = 1 - tanh^2
        df = G * tkd + G * k * depth_m * sech2        # d/dk [g k tanh(kd)]
        if df == 0:
            break
        k_new = k - f / df
        if k_new <= 0:
            k_new = k / 2.0                           # keep the iterate positive
        if abs(k_new - k) < 1e-9:
            return k_new
        k = k_new
    return k


def shoaling_coefficient(period_s: float, depth_m: float) -> float:
    """Linear shoaling coefficient Ks = sqrt(Cg_deep / Cg(depth)). ~1.0 in deep water; dips slightly at
    intermediate depth then rises sharply approaching the breakpoint. Returns 1.0 if it can't be solved."""
    k = wavenumber(period_s, depth_m)
    if not k or k <= 0:
        return 1.0
    kd = k * depth_m
    C0 = G * period_s / (2.0 * math.pi)              # deep-water phase speed C0 = gT/2pi
    Cg0 = 0.5 * C0                                   # deep-water group speed = C0/2
    C = (2.0 * math.pi / k) / period_s              # phase speed at depth = L/T = (2pi/k)/T
    s2 = math.sinh(2.0 * kd)
    n = 0.5 * (1.0 + (2.0 * kd / s2)) if s2 > 0 else 1.0
    Cg = n * C
    if Cg <= 0:
        return 1.0
    return math.sqrt(Cg0 / Cg)


def transform_surf(Hs_m, Tp_s, depth_m):
    """Estimate breaking ("surf") height (metres) from offshore Hs/Tp at a given water depth.

    Returns ``(surf_height_m, regime)`` where regime is one of:
      - ``'calm'``     Hs <= 0
      - ``'unknown'``  missing Hs or Tp (cannot transform)
      - ``'deep'``     depth beyond the shoaling zone (d/L0 > 0.5) OR no usable depth -> offshore Hs passes
                       through unchanged (no surf transformation in deep water)
      - ``'shoaling'`` intermediate depth: height = Ks(depth) * Hs, below the breaking cap
      - ``'breaking'`` depth-limited: height capped at GAMMA * depth (the dominant shelf effect)
    """
    if Hs_m is None or Tp_s is None:
        return None, 'unknown'
    if Hs_m <= 0:
        return 0.0, 'calm'
    if Tp_s <= 0:
        return None, 'unknown'
    # No usable depth (land/no-data) -> we can't shoal; treat as deep (offshore swell unchanged).
    if depth_m is None or depth_m <= 0:
        return float(Hs_m), 'deep'
    # Deep water: beyond ~half a deep-water wavelength the wave doesn't feel the bottom.
    L0 = G * Tp_s * Tp_s / (2.0 * math.pi)
    if depth_m > DEEP_RATIO * L0:
        return float(Hs_m), 'deep'
    Ks = shoaling_coefficient(Tp_s, depth_m)
    H_shoaled = Ks * Hs_m
    H_break_limit = GAMMA * depth_m
    if H_shoaled >= H_break_limit:
        return float(H_break_limit), 'breaking'
    return float(H_shoaled), 'shoaling'


# Shelf bottom-friction attenuation: tuned so a typical wide shallow shelf (e.g. Florida east coast,
# ~30-40 m at the 0.25° offshore cell, ~10 s swell) survives ~0.7 of the offshore height, while a
# steep/deep shelf passes ~all of it. Tunable against known spots later.
SHELF_CF = 0.65


def shelf_factor(Tp_s, depth_m, cf: float = SHELF_CF) -> float:
    """Fraction of offshore swell HEIGHT that survives crossing a shelf of the given depth, from bottom
    friction. ~1.0 in deep water (the wave doesn't feel the bottom); <1 over a shallow shelf where the
    wave's near-bed orbital velocity (~1/sinh(kd)) drives dissipation.

    Form: Kf = sinh(kd)/(sinh(kd)+cf) — bounded (0, 1], monotonic increasing in depth, -> 1 as kd grows.
    This is the coarse-grid driver of the 'wide shallow shelf bleeds swell energy' effect (Florida vs a
    steep-shelf coast). cf tunes the strength."""
    if Tp_s is None or Tp_s <= 0 or depth_m is None or depth_m <= 0:
        return 1.0
    k = wavenumber(Tp_s, depth_m)
    if not k or k <= 0:
        return 1.0
    kd = k * depth_m
    if kd > 10.0:            # deep water: sinh(kd) overflows and Kf is ~1 anyway
        return 1.0
    s = math.sinh(kd)
    return s / (s + cf)


def komar_breaker_height(Hs_m, Tp_s):
    """Breaker height (m) from offshore Hs/Tp — Komar & Gaughan (1972):

        Hb = 0.56 * Hs * (Hs / L0) ** (-1/5),   L0 = g * Tp^2 / (2*pi)   (deep-water wavelength)

    Predicts the depth-limited BREAKING height a swell shoals up to at the shore from deep-water bulk
    parameters alone (no local depth) — the dominant surf-zone predictor in the literature (deep-water
    height + period dominate Hb). Long-period / low-steepness groundswell amplifies more (jacks up bigger)
    than short-period wind chop. Returns None for non-physical inputs."""
    if Hs_m is None or Tp_s is None or Hs_m <= 0 or Tp_s <= 0:
        return None
    L0 = G * Tp_s * Tp_s / (2.0 * math.pi)
    if L0 <= 0:
        return None
    return 0.56 * Hs_m * (Hs_m / L0) ** (-0.2)


def estimate_surf(Hs_m, Tp_s, depth_m, coastal: bool = True):
    """SURF (breaking) height estimate in metres + regime, from offshore Hs/Tp, the representative 0.25°
    shelf depth, and whether the point is near a coast.

    Physics (literature-grounded — Komar & Gaughan 1972 shoaling breaker; Caldwell 2007 surf-from-deepwater):
      1. Shelf bottom-friction (Kf) bleeds energy from swell crossing a WIDE SHALLOW shelf (e.g. Florida);
         ~1 over a steep/deep shelf (e.g. Mavericks/Nazaré).
      2. Komar & Gaughan shoaling lifts the (friction-reduced) swell to its breaking height — so a STEEP
         reef breaks LARGER than the offshore swell, a wide shallow shelf SMALLER.
      3. Depth-limited breaking caps the height at GAMMA*depth where the coarse shelf cell is itself shallow
         enough to break the wave offshore.
      4. Surf only exists where there is a shore to break on: an OPEN-OCEAN point (no nearby land) carries
         swell but no surf -> regime 'open_ocean', offshore height returned, callers hide/transparency-mask it.

    Refraction (Kr, Caldwell 2007) is a deliberate v2 (needs a per-point shore-normal / exposure angle).

    Returns ``(surf_height_m, regime)`` with regime in:
      calm | unknown | open_ocean | reef (shoaling-amplified) | shelf (friction-reduced) | breaking (depth-capped).
    An ESTIMATE from bulk parameters — callers MUST tag is_estimated and present it as surf, not model truth."""
    if Hs_m is None or Tp_s is None:
        return None, 'unknown'
    if Hs_m <= 0:
        return 0.0, 'calm'
    if Tp_s <= 0:
        return None, 'unknown'
    if not coastal:
        return float(Hs_m), 'open_ocean'           # swell with no shore to break on -> not surf
    Kf = shelf_factor(Tp_s, depth_m) if (depth_m and depth_m > 0) else 1.0
    Hs_eff = Kf * Hs_m
    Hb = komar_breaker_height(Hs_eff, Tp_s)
    if Hb is None:
        Hb = Hs_eff
    if depth_m and depth_m > 0:
        cap = GAMMA * depth_m
        if Hb >= cap:
            return float(cap), 'breaking'           # depth-limited on a shallow shelf cell
    if Hb >= Hs_m:
        return float(Hb), 'reef'                    # shoaling amplification dominates (steep coast)
    return float(Hb), 'shelf'                       # friction-dominated reduction (wide shallow shelf)


def surf_transform_grid(vectors, depth_fn, coastal_fn=None):
    """In-place SURF-BAND transform of a marine grid for the Swell<->Surf heatmap toggle.

    Surf is a COASTLINE property, not an open-ocean field, so this does two things per cell:
      - COASTAL cells: replace the offshore wave HEIGHT (``speed``) with the bathymetry breaker estimate
        (``estimate_surf``), scaling ``u``/``v`` by the same ratio so direction is preserved. Breakers can be
        LARGER than the offshore swell (steep reefs) or smaller (wide shallow shelves).
      - OPEN-OCEAN cells: transparency-mask them (``is_valid = False``) so the heatmap renders only a
        nearshore SURF BAND hugging the coast instead of washing the whole ocean.

    ``depth_fn(lat,lng)->depth_m|None`` and ``coastal_fn(lat,lng)->bool`` are injected (pass
    ``bathymetry.shelf_depth_at`` / ``bathymetry.is_coastal``) so this stays pure + unit-testable. When
    ``coastal_fn`` is None every cell is treated coastal (no masking). Returns ``(n_transformed, n_masked)``.
    Mutates the vector objects (any object with speed/u/v/period/lat/lng[/is_valid] attributes)."""
    n_transformed = 0
    n_masked = 0
    for vec in vectors:
        sp = getattr(vec, "speed", 0) or 0
        if sp <= 0:
            continue
        lat = getattr(vec, "lat", None)
        lng = getattr(vec, "lng", None)
        if coastal_fn is not None:
            try:
                is_coastal_cell = bool(coastal_fn(lat, lng))
            except Exception:
                is_coastal_cell = True
            if not is_coastal_cell:
                # open ocean: swell, not surf -> hide from the coastal band
                if hasattr(vec, "is_valid"):
                    vec.is_valid = False
                n_masked += 1
                continue
        try:
            depth = depth_fn(lat, lng)
        except Exception:
            depth = None
        surf, regime = estimate_surf(sp, getattr(vec, "period", None), depth, coastal=True)
        if surf is None or regime in ("open_ocean", "calm", "unknown"):
            continue
        ratio = (surf / sp) if sp else 1.0
        vec.speed = round(float(surf), 4)
        if getattr(vec, "u", None) is not None:
            vec.u = round(vec.u * ratio, 4)
        if getattr(vec, "v", None) is not None:
            vec.v = round(vec.v * ratio, 4)
        n_transformed += 1
    return n_transformed, n_masked
