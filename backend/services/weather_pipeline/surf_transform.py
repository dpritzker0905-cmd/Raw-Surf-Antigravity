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
import os

G = 9.81            # gravitational acceleration (m/s^2)
GAMMA = 0.78        # reference depth-limited breaking index (solitary-wave / McCowan limit); used when the
                    # period is unknown and as the centre of the period-dependent breaker_index() below.
GAMMA_MIN = 0.62    # short-period windchop breaks low + mushy (spilling)
GAMMA_MAX = 1.05    # long-period groundswell breaks tall + violent (plunging)
GAMMA_MAX_STEEP = 1.25  # slope-aware ceiling (v3.2): steep-reef plunging γ_b reaches ~1.1-1.2 in the
                        # incipient-breaking literature (Weggel 1972 b(m)→1.19 at m=0.1; Kaminsky 1994)
DEEP_RATIO = 0.5    # d/L0 > 0.5 == deep water (shoaling negligible) — standard linear-theory cutoff


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def breaker_index(Tp_s, slope=None):
    """Depth-limited breaker index gamma_b = H_b / h_b as a function of swell PERIOD (the f(s0,kh) breaker
    index of the nearshore literature — Galvin 1968; Battjes 1974 via the Iribarren number; Goda 2010).

    The fixed 0.78 ignores that LONG-PERIOD groundswell breaks TALLER and more violently (plunging, high
    gamma_b) while short-period windchop breaks lower and mushier (spilling, low gamma_b): the breaker index
    rises as deep-water steepness s0 = Hs/L0 FALLS, and for fixed Hs the PERIOD is the dominant steepness
    lever (L0 = gTp^2/2pi). We key gamma_b to Tp ONLY — not Hs — so the depth-limited cap stays INDEPENDENT
    of offshore height (a 5 m and a 2 m swell of the same period still break to the same depth-limited height,
    the shelf physics). Centred so a typical ~10.5 s swell ~= the legacy 0.78; bounded [GAMMA_MIN, GAMMA_MAX].

    SLOPE TERM (SURF v3.2, 2026-07-18 literature pass): gamma_b also RISES with bottom slope — the
    universal-γ assumption fails across bathymetries (Harris et al. 2018 reef flats: γ>0.85 at the crest;
    Lin et al. 2017: non-linear slope dependence; Chen et al. 2022 Goda-type steepness+slope forms;
    Zhang et al. 2021 composite s0/kh dependence). We adopt Weggel (1972)'s slope factor
    b(m) = 1.56 / (1 + e^(-19.5 m)) as the CENTER of the period-adjusted index: b(m→0) → 0.78 exactly
    (flat wide shelves — Florida — keep the legacy calibration byte-identical), while a steep shelf
    (volcanic reef coasts, m ~ 0.03+) raises the cap toward ~1.0-1.2 — the taller, plunging reef break
    (Pipeline-class) the flat-γ model under-capped. `slope` = the SHELF-SCALE proxy depth/width the
    caller derives from the global bathymetry; None keeps the legacy fixed-0.78 center.
    Bounds widen to GAMMA_MAX_STEEP only when a slope is supplied. Kill: SURF_V3_SLOPE_GAMMA=0."""
    if Tp_s is None or Tp_s <= 0:
        return GAMMA
    period_adj = (Tp_s - 10.5) * 0.027
    if (slope is not None and slope > 0
            and os.environ.get("SURF_V3_SLOPE_GAMMA", "1") != "0"):
        try:
            center = 1.56 / (1.0 + math.exp(-19.5 * float(slope)))
        except OverflowError:
            center = 1.56
        return _clamp(center + period_adj, GAMMA_MIN, GAMMA_MAX_STEEP)
    return _clamp(0.78 + period_adj, GAMMA_MIN, GAMMA_MAX)


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


def iribarren(slope, Hs_m, Tp_s):
    """Deep-water Iribarren (surf-similarity) number ξ0 = tan(β) / sqrt(H0/L0), L0 = gTp²/2π. Governs the
    BREAKER TYPE (Battjes 1974): the relative steepness of the BEACH (slope) vs the swell. Returns None if any
    input is missing/non-physical. `slope` is the bed slope (rise/run, m/m). NOTE: needs a true nearshore beach
    slope to be quantitative — the bundled 0.25° ETOPO is too coarse (shelf-scale), which is why the
    breaker-type rating factor only activates with a finer slope asset (build_bathymetry_asset.py --slope)."""
    if slope is None or Hs_m is None or Tp_s is None or slope <= 0 or Hs_m <= 0 or Tp_s <= 0:
        return None
    L0 = G * Tp_s * Tp_s / (2.0 * math.pi)
    if L0 <= 0:
        return None
    s0 = Hs_m / L0                              # deep-water steepness
    if s0 <= 0:
        return None
    return slope / math.sqrt(s0)


def breaker_type(xi):
    """Breaker TYPE from the Iribarren number ξ0 (Battjes 1974): spilling (mushy, gentle/steep-swell),
    plunging (hollow + powerful — the prized type), surging/collapsing (very steep shore, often closeout).
    Returns 'unknown' when ξ0 is None."""
    if xi is None:
        return "unknown"
    if xi < 0.5:
        return "spilling"
    if xi < 3.3:
        return "plunging"
    return "surging"


def shoaling_coefficient(period_s: float, depth_m: float) -> float:
    """Linear shoaling coefficient Ks = sqrt(Cg_deep / Cg(depth)). ~1.0 in deep water; dips slightly at
    intermediate depth then rises sharply approaching the breakpoint. Returns 1.0 if it can't be solved."""
    k = wavenumber(period_s, depth_m)
    if not k or k <= 0:
        return 1.0
    kd = k * depth_m
    if kd > 20.0:            # deep water: sinh(2kd) below would overflow (math range error) and Ks -> 1.0
        return 1.0           # (no shoaling) anyway. Mirrors the kd guards in shelf_dissipation/shelf_factor.
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
      - ``'breaking'`` depth-limited: height capped at breaker_index(Tp) * depth (period-dependent)
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
    H_break_limit = breaker_index(Tp_s) * depth_m
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


# Calibrated so a Florida-class shelf (~80-100 km wide, ~25 m deep, ~8-10 s swell) keeps roughly half the
# offshore height, while a steep/deep coast keeps ~all of it. Universal (not region-specific) — the variation
# is carried by shelf WIDTH + depth, which come from the global bathymetry, so the model is worldwide.
SHELF_FRICTION_CF = 0.40
_CELL_KM = 27.75          # ~0.25 deg ≈ 27.75 km

# ── THE EVIDENCE FLOOR (2026-07-29) ─────────────────────────────────────────────────────────────
# `exp(-CF * cells * /sinh(kd))` is UNBOUNDED BELOW, and it is fed a `shelf_depth_at` that is a
# ~139 km MEDIAN — the same one-depth-two-jobs quantity that made the breaking cap dead (2026-07-27).
# Measured over the live catalogue (1,773 spots): that depth spans p10 24 m to p90 2,389 m, and
# 47.2% of spots read deeper than 200 m, where kd > 8 switches this term OFF entirely. At the other
# extreme it extrapolates far outside its own calibration envelope (the docstring's ~80-100 km /
# ~25 m case, which the formula still reproduces exactly at Kf = 0.844):
#     SALTHILL BEACH   shelf   1.0 m, width 194 km  ->  Kf 0.0039  = 0.4% of the wave survives
#     Fort Myers/Naples/Sanibel (W Florida shelf)   ->  Kf 0.16-0.18 at 16 s
# A spot retaining 0.4% of its swell reads FLAT forever — worse than a naive baseline, the same
# category as the fabricated GFS zeros.
#
# THE BOUND IS THE DOCSTRING'S OWN CITATION. Ardhuin (2003) reports up to ~90% ENERGY loss on the
# widest shelves; height goes as sqrt(energy), so 90% energy loss is a height retention of
# sqrt(0.10) = 0.316. Below that the model is claiming more dissipation than the literature it cites
# supports, on a depth sample it cannot trust. Floor it there.
#
# ⚠️ This can only ever RESTORE height, never remove more, so it cannot make a currently-good spot
# worse; anything it raises is still bounded above by the depth-limited breaking cap. It binds on
# 0.9% of spots at Tp 12 s and 2.5% at 16 s. Kill: SURF_SHELF_KF_FLOOR=0.
SHELF_KF_FLOOR = 0.316    # = sqrt(1 - 0.90): the ~90% ENERGY-loss ceiling in Ardhuin (2003)


def shelf_dissipation(Tp_s, depth_m, width_km):
    """Fraction of offshore swell HEIGHT that survives crossing the shelf, lost to bottom friction. ~1.0 over a
    narrow/steep or deep shelf; << 1 over a WIDE SHALLOW shelf where swell crosses many wavelengths of shallow
    water and bleeds energy to the bed — up to ~90% energy loss on the widest shelves (Ardhuin 2003, NC/VA
    shelf), far more on gentle/wide than steep/narrow (Kurian 1987). This is the dominant, grid-resolvable
    nearshore effect (the surf-zone shoaling jump is sub-grid at 0.25°).

    Form: exp(-CF * shelf_width_in_cells * bed_feel), bed_feel = 1/sinh(kd) (near-bed orbital influence:
    ~0 in deep water, large in shallow). Returns 1.0 (no loss) for deep water or zero shelf width."""
    if (Tp_s is None or Tp_s <= 0 or depth_m is None or depth_m <= 0
            or width_km is None or width_km <= 0):
        return 1.0
    k = wavenumber(Tp_s, depth_m)
    if not k or k <= 0:
        return 1.0
    kd = k * depth_m
    if kd > 8.0:                               # deep: the wave doesn't feel the bed -> no friction
        return 1.0
    feel = 1.0 / math.sinh(kd)
    width_cells = width_km / _CELL_KM
    kf = math.exp(-SHELF_FRICTION_CF * _shelf_cf_scale() * width_cells * feel)
    # Never claim more dissipation than the cited literature supports (see SHELF_KF_FLOOR).
    if os.environ.get("SURF_SHELF_KF_FLOOR", "1") != "0":
        return max(kf, SHELF_KF_FLOOR)
    return kf


# ── SURF v3 (2026-07-17 nearshore-science audit vs same-day Surfline/forecaster ground truth) ──
# The v2 chain read FL beaches ~2.5-3x LOW (Flagler Ave: offshore 1.2ft@7.4s → v2 surf 0.6ft vs
# real-world knee ~1-1.5ft) and had no surf>offshore path (komar_breaker_height was DEAD CODE, so
# steep-coast reef jacking never engaged). Each leg is independently env-kill-switched:
#   SURF_V3_KOMAR=0        legacy Ks-shoaling instead of the Komar breaker estimate
#   SURF_V3_SHELF_RECAL=0  legacy full-strength shelf friction (the 2.5-3x FL underread)
#   SURF_V3_EXPOSURE=0     no swell-angle factor on the HEIGHT (rating keeps its own)
#   SURF_V3_MAGNETS=0      ignore per-spot wave-magnet factors (see surf_magnets.py)
# Levers: SURF_SHELF_CF_SCALE (default 0.25 — calibrated so FL-class Kf lands ~0.85 instead of
# ~0.5) and SURF_V3_JACK_MAX (default 2.0 — bounds Komar amplification; literature shoaling
# amplification rarely exceeds ~1.6-2x without focusing).
def _v3(flag: str) -> bool:
    return os.environ.get(flag, "1") != "0"


def _shelf_cf_scale() -> float:
    if not _v3("SURF_V3_SHELF_RECAL"):
        return 1.0
    try:
        return float(os.environ.get("SURF_SHELF_CF_SCALE", "0.25"))
    except (TypeError, ValueError):
        return 0.25


def _height_exposure_factor(swell_from_deg, shore_normal_deg) -> float:
    """Swell-angle factor for the surf HEIGHT — a softened form of the rating model's
    swell_exposure (energy), since height scales gentler than energy with incidence. Head-on 1.0;
    the exposure floor (0.10) maps to 0.595. Unknown geometry FAILS OPEN to 1.0 (07-03 lesson)."""
    if not _v3("SURF_V3_EXPOSURE"):
        return 1.0
    if swell_from_deg is None or shore_normal_deg is None:
        return 1.0
    align = math.cos(math.radians(swell_from_deg - shore_normal_deg))
    exposure = _clamp(0.10 + 0.90 * max(0.0, align), 0.0, 1.0)
    return 0.55 + 0.45 * exposure


def estimate_surf(Hs_m, Tp_s, depth_m, coastal: bool = True, shelf_width_km: float = 0.0,
                  swell_from_deg=None, shore_normal_deg=None, magnet_factor: float = 1.0,
                  break_depth_m=None):
    """SURF (breaking) height estimate in metres + regime, from offshore Hs/Tp, the representative shelf depth,
    the shelf WIDTH, and whether the point is near a coast. Worldwide — every input comes from the global
    bathymetry, so the same physics applies on any coast.

    Physics (literature-grounded):
      1. Cross-shelf bottom friction (Kf, ``shelf_dissipation``): swell crossing a WIDE SHALLOW shelf loses
         energy to the bed (Ardhuin 2003; Kurian 1987). Scaled by shelf WIDTH and 1/sinh(kd).
      2. Local shoaling (Ks) from deep/intermediate water to the shelf-cell depth (linear wave theory).
      3. Depth-limited breaking: capped at breaker_index(Tp)*depth (period-dependent: long-period plunges taller).
      4. Surf only exists near a shore: an OPEN-OCEAN point (no nearby land) carries swell but no surf ->
         regime 'open_ocean', offshore height returned, callers hide/transparency-mask it.

    Net effect: a WIDE SHALLOW shelf (Florida, the US East/Gulf, Patagonia, the Yellow Sea…) yields surf MUCH
    SMALLER than the offshore swell; a STEEP/DEEP coast passes most of it through. Sub-grid reef shoaling /
    refraction amplification (surf > offshore) needs finer bathymetry + a shore-normal -> deferred to v3.

    Returns ``(surf_height_m, regime)`` in: calm | unknown | open_ocean | shelf (friction-reduced) |
    shoaling (locally raised) | breaking (depth-capped). ESTIMATE from bulk params — callers MUST tag is_estimated."""
    if Hs_m is None or Tp_s is None:
        return None, 'unknown'
    if Hs_m != Hs_m or Tp_s != Tp_s:
        return None, 'unknown'   # NaN passes every <=/>= guard and would propagate to the display
    if Hs_m <= 0:
        return 0.0, 'calm'
    if Tp_s <= 0:
        return None, 'unknown'
    if not coastal:
        return float(Hs_m), 'open_ocean'           # swell with no shore to break on -> not surf
    if depth_m is None or depth_m <= 0:
        return float(Hs_m), 'shelf'                # coastal but no usable depth -> pass through
    Kf = shelf_dissipation(Tp_s, depth_m, shelf_width_km)   # v3 recal scales CF inside (kill-switched)
    Hs_surviving = Kf * Hs_m                       # the swell that makes it across the shelf
    # v3.2 SLOPE-AWARE CAP: shelf-scale slope proxy = depth / width. A flat wide shelf (FL:
    # ~25 m / 90 km ≈ 0.0003) keeps the legacy 0.78-centred cap byte-identical; a steep shelf
    # (volcanic reef coast: ~100 m / 3 km ≈ 0.03) raises γ_b toward the plunging-reef range —
    # "Pipeline breaks taller than a beach break in the same depth". Kill: SURF_V3_SLOPE_GAMMA=0.
    _slope_proxy = (depth_m / (shelf_width_km * 1000.0)) if (shelf_width_km and shelf_width_km > 0) else None
    # ★ THE CAP USES THE NEARSHORE DEPTH, NOT THE SHELF DEPTH. `depth_m` is a ~139 km median — the
    # right answer for cross-shelf friction above, and nonsense here: measured 2026-07-27 across 395
    # live spots the cap BOUND ON ZERO of them, median cap 107x the wave (Santa Cruz "limits" waves
    # to 350 m because its shelf median is 452 m — the Monterey Canyon). `break_depth_m` comes from
    # ETOPO 2022 15s at ~463 m (8.5 m at Cowell's, 13.4 m at Steamer Lane) so H <= gamma*d becomes
    # real physics again. Absent -> legacy behaviour byte-identical. Kill: SURF_BREAK_DEPTH=0.
    _cap_depth = depth_m
    if break_depth_m is not None and break_depth_m > 0 and os.environ.get("SURF_BREAK_DEPTH", "1") != "0":
        _cap_depth = float(break_depth_m)
    cap = breaker_index(Tp_s, slope=_slope_proxy) * _cap_depth  # period+slope: long-period/steep breaks taller
    if _v3("SURF_V3_KOMAR"):
        # v3: the surviving swell shoals up to the Komar & Gaughan breaker height at the (sub-grid)
        # break — surf CAN exceed offshore Hs on steep coasts (the reef-jack v2 never modeled;
        # komar_breaker_height sat unwired). Bounded by SURF_V3_JACK_MAX so short-period noise
        # can't over-amplify; falls back to legacy Ks shoaling on non-physical Komar inputs.
        try:
            jack_max = float(os.environ.get("SURF_V3_JACK_MAX", "2.0"))
        except (TypeError, ValueError):
            jack_max = 2.0
        Hb = komar_breaker_height(Hs_surviving, Tp_s)
        H = min(Hb, jack_max * Hs_surviving) if (Hb is not None and Hb > 0) \
            else shoaling_coefficient(Tp_s, depth_m) * Hs_surviving
    else:
        H = shoaling_coefficient(Tp_s, depth_m) * Hs_surviving   # legacy v2 chain
    H *= _height_exposure_factor(swell_from_deg, shore_normal_deg)
    if magnet_factor and magnet_factor != 1.0 and _v3("SURF_V3_MAGNETS"):
        H *= float(magnet_factor)                  # per-spot wave-magnet focusing (surf_magnets.py)
    if H >= cap:
        return float(cap), 'breaking'              # depth-limited on a shallow shelf cell
    return (float(H), 'shelf') if H <= Hs_m else (float(H), 'shoaling')


def surf_transform_grid(vectors, depth_fn, coastal_fn=None, width_fn=None):
    """In-place SURF-BAND transform of a marine grid for the Swell<->Surf heatmap toggle.

    Surf is a COASTLINE property, not an open-ocean field, so this does two things per cell:
      - COASTAL cells: replace the offshore wave HEIGHT (``speed``) with the bathymetry surf estimate
        (``estimate_surf`` — cross-shelf friction + shoaling + depth-limited breaking), scaling ``u``/``v`` by
        the same ratio so direction is preserved. Wide shallow shelves reduce; steep/deep coasts pass through.
      - OPEN-OCEAN cells: transparency-mask them (``is_valid = False``) so the heatmap renders only a
        nearshore SURF BAND hugging the coast instead of washing the whole ocean.

    ``depth_fn(lat,lng)->depth_m|None``, ``coastal_fn(lat,lng)->bool`` and ``width_fn(lat,lng)->km`` are
    injected (pass ``bathymetry.shelf_depth_at`` / ``is_coastal`` / ``shelf_width_km``) so this stays pure +
    unit-testable. When ``coastal_fn`` is None every cell is treated coastal (no masking); when ``width_fn`` is
    None no shelf-width friction is applied. Returns ``(n_transformed, n_masked)``. Mutates the vector objects
    (any object with speed/u/v/period/lat/lng[/is_valid] attributes)."""
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
        width = 0.0
        if width_fn is not None:
            try:
                width = width_fn(lat, lng) or 0.0
            except Exception:
                width = 0.0
        surf, regime = estimate_surf(sp, getattr(vec, "period", None), depth, coastal=True, shelf_width_km=width)
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
