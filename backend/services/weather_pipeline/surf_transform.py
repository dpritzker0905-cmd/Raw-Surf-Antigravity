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


def estimate_surf(Hs_m, Tp_s, depth_m):
    """Shelf-scale SURF (breaking) height estimate in metres + regime, from offshore Hs/Tp and the nearshore
    shelf depth. Applies shelf bottom-friction attenuation, then the depth-limited breaking cap. This is the
    coarse-grid Option-2 first cut — it captures the dominant 'wide shallow shelf bleeds swell energy' effect.

    Returns ``(surf_height_m, regime)`` with regime in {calm, unknown, deep, shelf, breaking}. An ESTIMATE
    from bulk parameters — callers MUST tag is_estimated and present it as surf, not authoritative output."""
    if Hs_m is None or Tp_s is None:
        return None, 'unknown'
    if Hs_m <= 0:
        return 0.0, 'calm'
    if Tp_s <= 0:
        return None, 'unknown'
    if depth_m is None or depth_m <= 0:
        return float(Hs_m), 'deep'                 # no shelf depth -> offshore swell passes through
    Kf = shelf_factor(Tp_s, depth_m)
    H = Kf * Hs_m
    cap = GAMMA * depth_m
    if H >= cap:
        return float(cap), 'breaking'
    if Kf < 0.985:
        return float(H), 'shelf'
    return float(Hs_m), 'deep'                      # deep shelf: negligible attenuation
