"""
wave_wrapping.py -- directional-spectrum wave wrapping around a headland (the J-Bay term).

DEFAULT OFF. Nothing in production calls this module. `SURF_WAVE_WRAPPING` (default "0") gates the
geometry-resolving helpers only; the physics function below is pure and always computable so it can
be tested and A/B'd without touching a serving path. Wiring is a separate, reviewed step.

ASCII only -- this module may end up imported by the MCP weather sim, whose stdout is cp1252.

---------------------------------------------------------------------------------------------------
THE DEFECT THIS EXISTS TO FIX
---------------------------------------------------------------------------------------------------
The shipped chain models "how much of this swell is aimed at this coast" as a pure cosine of the
misalignment dtheta = swell_from_deg - shore_normal_deg, in two places:

    quality  surf_rating.swell_exposure            clamp(0.10 + 0.90 * max(0, cos dtheta))
    height   surf_transform._height_exposure_factor 0.55 + 0.45 * exposure

Past dtheta = 90 deg BOTH pin at a flat floor (0.100 energy / 0.595 height) for the entire remaining
half-plane. Measured 2026-08-09: 18.9% of all served spot-hours (n=13,166) sit on that floor.

At Jeffreys Bay the served sea is Hs 3.91 m / Tp 11.93 s from 229.5 deg and the resolved shore
normals across the cluster are 102.9-107.6 deg -- both audited and correct -- giving dtheta 124.5,
cos -0.566, exposure floored, and a served "9.6 ft / score 2.7 very_poor". Supertubes is the most
famous right-hand point break on earth and it works BECAUSE that south-west Southern Ocean swell
wraps the Cape St Francis headland. The sea is right and the shore normal is right; the MODEL is
wrong.

    *** A PURE FUNCTION OF dtheta CANNOT BE THE FIX. ***

It cannot tell a wrapping POINT from a straight BEACH. At dtheta 120 on a straight beach the
shoreward flux is already far BELOW the 0.10 floor, so any term that merely raises the floor makes
straight beaches MORE wrong. The term has to be a function of dtheta AND local coastline geometry.
That is the single constraint this module is built around, and `test_wave_wrapping.py` asserts it:
with no headland this function is never more generous than the shipped floor, at any angle.

---------------------------------------------------------------------------------------------------
WHAT THE LITERATURE ACTUALLY SAYS (three results, two of them negative)
---------------------------------------------------------------------------------------------------
1. SNELL REFRACTION IS REGIME-FORBIDDEN PAST 90 DEG -- it is a domain boundary, not a soft limit.
   Over straight parallel contours Kr = sqrt(cos phi0 / cos phi_b) with sin phi_b = (Cb/C0) sin phi0
   (Bosboom & Stive, *Coastal Dynamics* 5.2.3, open textbook; CEM EM 1110-2-1100 Part II-3). Kr goes
   to EXACTLY zero at phi0 = 90 deg and has no solution beyond: the wave is travelling offshore.
   Do not try to extend it. Note also that phi_b saturates near 16.9 deg at the J-Bay sea state, so
   Kr^2 = cos phi0 / cos phi_b is within 4.5% of a plain cos phi0 -- which is WHY the shipped cosine
   form works so well inside the regime. The half-plane past 90 needs a DIFFERENT term with a
   DIFFERENT input, and that input is the coastline geometry.

2. MONOCHROMATIC EDGE DIFFRACTION IS REAL BUT NUMERICALLY NEGLIGIBLE AT OCEAN SCALE.
   Penney & Price (1952), after Sommerfeld (1896), gives Kd = 0.5 exactly on the geometric shadow
   boundary. At J-Bay's real geometry (25.9 deg into shadow, 20.9 km from the headland tip, kr ~ 660)
   it evaluates to Kd = 0.037 -- 0.13% of the energy. Implementing the Wiegel/SPM diffraction
   diagrams would leave J-Bay WORSE than the shipped floor, in the other direction. Strong negative
   result: the obvious literature answer is the wrong one.

3. THE MECHANISM THAT ACTUALLY DELIVERS ENERGY BEHIND A HEADLAND IS THE DIRECTIONAL SPREAD OF THE
   INCIDENT SPECTRUM. Goda, Takayama & Suzuki (ICCE 1978, ch. 35, "Diffraction Diagrams for
   Directional Random Waves") state that the random-wave diffraction coefficient is about 0.7 along
   the geometric shadow boundary, "about 1.4 times" the monochromatic value, and Irie's Akita Port
   field data had monochromatic theory giving one half to one quarter of the observed value.
   In the large-kr limit the Fresnel integral collapses to a closed form with NO r/L dependence:

       Kd_eff^2 = the cumulative fraction of DIRECTIONAL energy lying on the lit side of the edge

   (agrees with the full Fresnel integral to within 0.003 over 0-60 deg into shadow). That is cheap
   enough to run per cell and needs no bathymetry asset. `lit_energy_fraction()` below is exactly
   that quantity, and the module's control test reproduces Goda's published 0.7 / 1.4x from it.

---------------------------------------------------------------------------------------------------
THE MODEL
---------------------------------------------------------------------------------------------------
One directional integral, over the offset x of a spectral component from the swell mean direction:

    W(dtheta, rot) = INTEGRAL D(x) * a(dtheta + x, rot) dx   /   INTEGRAL D(x) * a(x, 0) dx

  * D(x) is the directional spreading density -- a wrapped Gaussian of standard deviation
    `spread_sigma_deg`, the circular-sigma equivalent of Goda's cos^(2s)(theta/2) form (see
    SPREAD_SIGMA_DEG).

  * a(d, rot) is the shoreward energy a component arriving at incidence d (relative to THIS spot's
    normal) actually delivers, taking the better of TWO capture routes:

        direct   this spot's own face captures it        ->  Kr^2(d)
        wrap     a nearby coast rotated `rot` toward the
                 swell captures it, then the flux is
                 projected across the corner to this spot ->  cos(rot) * Kr^2(d - rot)

    a(d, rot) = max(direct, wrap), zero once |d| > 90 on the direct route and |d - rot| > 90 on the
    wrap route. The two routes cross at exactly d = rot where they are equal, so `a` is CONTINUOUS
    and monotone non-increasing in d over [0, 90 + rot] -- there is no step to tune away, and the
    headland is a pure bonus that can never make a head-on swell worse. With rot = 0 the wrap route
    is identically the direct route and the whole term collapses to the straight-beach case.

  * The DENOMINATOR is the same integral at dtheta = 0, rot = 0, evaluated by the same code path.
    So this is an exposure factor RELATIVE TO HEAD-ON, which is what the two shipped factors are
    too, and W(0, 0) == 1.0 exactly (bitwise: numerator and denominator are the same call).

WHY `rot` AND NOT CURVATURE. The geometry investigation refuted d(shore_normal)/d(alongshore) as a
headland detector at every runtime-available resolution: on a 0.1 deg mask the POINT class had the
LOWER median turning rate (0.430 vs 0.823 deg/km, n=10/10, classes inverted), and on the 463 m asset
J-Bay sits at only the 68.4th percentile of all 920 computable entries. What separates is RELIEF --
"is there nearby coast whose normal actually FACES this swell" -- which at the served 229.5 deg
gives J-Bay 39.7-44.9 deg against New Smyrna 6.7, Sebastian 8.3, Cocoa Beach 11.2. A 4-7x
separation, one subtraction off signals that already exist. `resolve_headland_rotation()` is that
measurement, and it REFUSES (returns None) below a minimum neighbour count, because 4 of 10 known
point breaks read relief 0 purely from having 1-3 asset neighbours in range -- a measurement that
cannot tell "not sampled" from "no headland" is worthless.

---------------------------------------------------------------------------------------------------
WHAT THIS TERM IS NOT -- READ BEFORE WIRING
---------------------------------------------------------------------------------------------------
- It is a REPLACEMENT for `surf_rating.swell_exposure`, not a multiplier on top of it. Both are
  "energy relative to head-on". Multiplying them applies the aim cosine twice; the estate has
  already paid for that class of error once (`surf_transform` header: a Kr fitted against a chain
  believed direction-blind would double-count direction by up to 40.5%).
- It carries the DIRECTIONAL SHAPE of refraction only, normalised to 1.0 head-on. The MAGNITUDE of
  refraction stays with `surf_transform.REFRACTION_KR = 0.797`, which is a median over direction.
  This term does not replace that constant and must not be multiplied into its calibration.
- It is an ENERGY factor. Height goes as sqrt(energy) -- use `wrap_height_factor()`. Do not feed the
  energy number into `_height_exposure_factor`'s 0.55 + 0.45 * e mapping, which was calibrated
  against the OLD exposure's range.
- The straight-beach guarantee is conditional on the spread. It holds for
  spread_sigma_deg <= 13.70 deg (measured, see SPREAD_SIGMA_MAX_DEG) and the module clamps there.
  A windsea spectrum (Goda smax 10, sigma 25.0 deg) genuinely leaks more energy past 90 than the
  shipped floor allows, and this module is NOT licensed to say so.
"""
import math
import os
from functools import lru_cache
from typing import Optional

from services.weather_pipeline import shore_normal_asset

# --------------------------------------------------------------------------------------------------
# CONSTANTS -- every one carries its source.
# --------------------------------------------------------------------------------------------------

# Directional spreading width. Goda's cos^(2s)(theta/2) spreading function with the peak-frequency
# parameter smax has mean resultant length s/(s+1), hence circular standard deviation
# sqrt(-2 * ln(s/(s+1))). Goda & Suzuki (1975), tabulated in Goda, *Random Seas and Design of
# Maritime Structures* (3rd ed., 2010) sec. 2.3:
#     smax = 10  wind waves                    -> sigma 25.0 deg
#     smax = 25  swell, short decay distance   -> sigma 16.0 deg
#     smax = 75  swell, long decay distance    -> sigma  9.3 deg   <-- this module's default
# The wrapping question is a GROUNDSWELL question (J-Bay's swell crosses the whole Southern Ocean),
# so smax = 75 is the correct regime, and it is also the conservative end: a narrower spectrum leaks
# LESS past the shadow edge on a straight beach, which is the constraint that binds hardest here.
SPREAD_SIGMA_DEG = 9.3

# Measured 2026-08-09 by bisection over dtheta 0-180 at 0.1 deg: the straight-beach guarantee
# (rot = 0 is never more generous than clamp(0.10 + 0.90 max(0, cos dtheta))) holds up to
# sigma = 13.70 deg and fails above it, because near dtheta 90 the honest spectral flux exceeds the
# shipped 0.10 floor. Clamped one notch below the measured bound so the guarantee has margin.
# THIS IS A MODEL LIMIT, NOT A PHYSICAL ONE: past 13.7 deg the physics and the shipped floor
# genuinely disagree, and resolving that disagreement is not this module's job.
SPREAD_SIGMA_MAX_DEG = 13.0

# Celerity ratio Cb/C0 for the Snell refraction term. 0.2912 is the J-Bay sea state: Tp 11.93 s
# (C0 = gT/2pi = 18.63 m/s) breaking in 3 m (Cb = sqrt(g*d) = 5.42 m/s). Bosboom & Stive 5.2.3.
# Its whole effect is bounded: Kr^2 = cos phi0 / cos phi_b and phi_b saturates at
# asin(0.2912) = 16.93 deg, so Kr^2 is at most 1/cos(16.93) = 1.045 times a plain cosine, ever.
# Passing a real per-spot ratio is supported and changes little; that bound is why.
CELERITY_RATIO_DEFAULT = 0.2912

# Beyond a 90 deg rotation the "sheltering" coast faces away from this spot and can deliver nothing
# across the corner -- cos(rot) is already zero there, so this clamp is a domain statement, not a
# tuning knob.
HEADLAND_ROTATION_MAX_DEG = 90.0

# Integration half-width in units of sigma. The wrapped-Gaussian mass beyond 6 sigma is 2e-9, which
# is four orders below the smallest factor any caller can act on.
_TAIL_SIGMA = 6.0

# 16-point Gauss-Legendre nodes and weights on [-1, 1] (Abramowitz & Stegun 25.4.30). Exact for
# polynomials to degree 31; verified in the test suite against sum(w) = 2 and integral x^30.
# The integrand is smooth ONLY between the breakpoints of `_aim`, so the integral is split at those
# breakpoints and this rule is applied per segment -- a global rule would be blind to the corners.
_GL_X = (0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438,
         0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499)
_GL_W = (0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767,
         0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541)
_GL_NODES = tuple(sorted([(-x, w) for x, w in zip(_GL_X, _GL_W)] +
                         [(x, w) for x, w in zip(_GL_X, _GL_W)]))

_INV_SQRT_2PI = 1.0 / math.sqrt(2.0 * math.pi)

# --- resolver defaults (geometry investigation, 2026-08-09) ---------------------------------------
# 25 km is the radius at which the 463 m shore-normal asset separated the classes: J-Bay relief 39.7
# (n=12 neighbours) against New Smyrna 6.7, Sebastian 8.3, Cocoa Beach 11.2.
RELIEF_RADIUS_KM = 25.0
# 4 of 10 known point breaks read relief 0 at this radius purely from having 1-3 asset neighbours.
# Below this count the measurement cannot tell "no headland" from "not sampled", so it REFUSES.
RELIEF_MIN_NEIGHBOURS = 4


# --------------------------------------------------------------------------------------------------
# PURE PHYSICS -- no I/O, no env reads, safe to call per cell.
# --------------------------------------------------------------------------------------------------

def _wrap180(deg: float) -> float:
    """Signed angular difference folded into (-180, 180]."""
    return (float(deg) + 180.0) % 360.0 - 180.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def refraction_kr_sq(incidence_deg: float, celerity_ratio: float = CELERITY_RATIO_DEFAULT) -> float:
    """Snell refraction as an ENERGY coefficient: Kr^2 = cos(phi0) / cos(phi_b).

    Straight parallel depth contours, sin(phi_b) = (Cb/C0) * sin(phi0) (Bosboom & Stive 5.2.3).
    Zero at |phi0| >= 90 -- exactly, and by domain: the ray is travelling offshore and the formula
    has no solution there. This is the term the shipped 0.10 + 0.90 cos form approximates; it is
    kept in its published shape rather than re-fitted so the difference stays visible.
    """
    a = abs(float(incidence_deg))
    if a >= 90.0:
        return 0.0
    sin_b = _clamp(float(celerity_ratio), 0.0, 1.0) * math.sin(math.radians(a))
    phi_b = math.asin(_clamp(sin_b, -1.0, 1.0))
    return math.cos(math.radians(a)) / math.cos(phi_b)


def _aim(d_deg: float, rot_deg: float, celerity_ratio: float) -> float:
    """Shoreward energy delivered by ONE spectral component arriving at incidence ``d_deg``.

    Two capture routes, best one wins (they are alternatives, never additive -- summing them would
    count the same component twice):

      direct  this spot's own face:  Kr^2(d)                        , requires |d| <= 90
      wrap    the rotated coast:     cos(rot) * Kr^2(d - rot)       , requires |d - rot| <= 90

    The cos(rot) is the ordinary flux projection paid to bring energy captured on a face rotated by
    `rot` back across the corner onto THIS spot's face -- the same cosine-of-incidence projection
    used everywhere else in the chain, applied at the second face. It is exactly 1 at rot = 0 and
    exactly 0 at rot = 90.

    The routes are EQUAL at d = rot (cos(rot)*Kr^2(0) = Kr^2(rot)) and the wrap route wins for every
    d > rot, so `_aim` is continuous, equals Kr^2(d) for d <= rot, and is monotone non-increasing on
    [0, 90 + rot]. That continuity is why the model has no free "wrap efficiency" knob: an earlier
    formulation that treated the routes as exclusive introduced a step of up to 0.5 at d = 90 and
    with it a genuine non-monotonicity near dtheta 93 at rot 60.
    """
    direct = refraction_kr_sq(d_deg, celerity_ratio) if abs(d_deg) <= 90.0 else 0.0
    off = d_deg - rot_deg
    wrap = (math.cos(math.radians(rot_deg)) * refraction_kr_sq(off, celerity_ratio)
            if abs(off) <= 90.0 else 0.0)
    best = direct if direct > wrap else wrap
    return best if best > 0.0 else 0.0


def _gaussian(x: float, sigma: float) -> float:
    return math.exp(-0.5 * (x / sigma) ** 2) * _INV_SQRT_2PI / sigma


def _breakpoints(dtheta: float, rot: float, sigma: float):
    """Segment edges for the quadrature, in component-offset (x) space.

    `_aim` is piecewise-smooth with corners at d = -90, rot, 90 and 90 + rot. Integrating across a
    corner with a high-order rule silently loses accuracy, so the segments are cut there.
    """
    lo, hi = -_TAIL_SIGMA * sigma, _TAIL_SIGMA * sigma
    edges = {lo, hi}
    for d_corner in (-90.0, rot, 90.0, 90.0 + rot):
        x = d_corner - dtheta
        if lo < x < hi:
            edges.add(x)
    return sorted(edges)


def _directional_flux(dtheta: float, rot: float, sigma: float, celerity_ratio: float) -> float:
    """INTEGRAL D(x) * _aim(dtheta + x, rot) dx -- the spectrum-weighted shoreward energy."""
    total = 0.0
    edges = _breakpoints(dtheta, rot, sigma)
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            continue
        half, mid = 0.5 * (b - a), 0.5 * (a + b)
        acc = 0.0
        for x, w in _GL_NODES:
            u = mid + half * x
            acc += w * _gaussian(u, sigma) * _aim(dtheta + u, rot, celerity_ratio)
        total += acc * half
    return total


@lru_cache(maxsize=64)
def _head_on_flux(sigma: float, celerity_ratio: float) -> float:
    """The normaliser -- the same integral at dtheta = 0, rot = 0. Cached because it depends only on
    the two model parameters, and it is otherwise half the cost of every call. Measured 2026-08-09
    (best of 3 x 5,000 calls): 90.4 us/call uncached, 53.3 us/call with this cache, so a 10,000-cell
    frame costs ~0.53 s -- the same order as the 26.8 us/call the relief measurement costs, and
    NOT free. Safe to cache despite the head-on identity, because dtheta = 0 short-circuits first."""
    return _directional_flux(0.0, 0.0, sigma, celerity_ratio)


def _resolve_sigma(spread_sigma_deg: Optional[float]) -> float:
    s = SPREAD_SIGMA_DEG if spread_sigma_deg is None else float(spread_sigma_deg)
    return _clamp(s, 0.5, SPREAD_SIGMA_MAX_DEG)


def _resolve_rot(headland_rotation_deg: Optional[float]) -> float:
    if headland_rotation_deg is None:
        return 0.0
    return _clamp(float(headland_rotation_deg), 0.0, HEADLAND_ROTATION_MAX_DEG)


def lit_energy_fraction(swell_from_deg, shore_normal_deg, headland_rotation_deg=0.0,
                        spread_sigma_deg: Optional[float] = None) -> float:
    """Kd_eff^2 -- the fraction of DIRECTIONAL energy on the lit side of the geometric shadow edge.

    This is the large-kr closed form from Goda, Takayama & Suzuki (ICCE 1978): the spectral
    diffraction coefficient squared, with no r/L dependence. It is the SHADOW factor alone and
    carries no aim -- `wrap_energy_factor` is the quantity a caller wants. It is exposed separately
    because it is the piece that can be graded against a published number: at the shadow boundary it
    is exactly 0.5, i.e. Kd_eff = 0.707 against Goda's published "about 0.7", and 1.41 times the
    monochromatic 0.5 of Penney & Price against his published "about 1.4 times".
    Returns 1.0 when geometry is unknown (fail open, matching the shipped exposure factors).
    """
    if swell_from_deg is None or shore_normal_deg is None:
        return 1.0
    dtheta = abs(_wrap180(float(swell_from_deg) - float(shore_normal_deg)))
    rot = _resolve_rot(headland_rotation_deg)
    sigma = _resolve_sigma(spread_sigma_deg)
    lo, hi = -_TAIL_SIGMA * sigma, _TAIL_SIGMA * sigma
    a = max(lo, -90.0 - dtheta)
    b = min(hi, 90.0 + rot - dtheta)
    if b <= a:
        return 0.0
    # Unlike the flux integral this one has NO interior corners to cut at, so a single 16-point rule
    # would span the whole +/-6 sigma bell and carry 4.9e-6 of error -- enough to be visible against
    # the published 0.5 anchor. Cutting at every 2 sigma takes it to 2.0e-9. Measured 2026-08-09.
    edges = sorted({a, b} | {k * 2.0 * sigma for k in (-2, -1, 0, 1, 2) if a < k * 2.0 * sigma < b})
    total = 0.0
    for i in range(len(edges) - 1):
        seg_a, seg_b = edges[i], edges[i + 1]
        half, mid = 0.5 * (seg_b - seg_a), 0.5 * (seg_a + seg_b)
        acc = 0.0
        for x, w in _GL_NODES:
            acc += w * _gaussian(mid + half * x, sigma)
        total += acc * half
    return _clamp(total, 0.0, 1.0)


def diffraction_coefficient(swell_from_deg, shore_normal_deg, headland_rotation_deg=0.0,
                            spread_sigma_deg: Optional[float] = None) -> float:
    """Kd_eff in HEIGHT -- sqrt of `lit_energy_fraction`. Directly comparable to the published
    diffraction diagrams (Goda 1978 random-wave, Wiegel/SPM monochromatic)."""
    return math.sqrt(lit_energy_fraction(swell_from_deg, shore_normal_deg,
                                         headland_rotation_deg, spread_sigma_deg))


def wrap_energy_factor(swell_from_deg, shore_normal_deg, headland_rotation_deg=0.0,
                       spread_sigma_deg: Optional[float] = None,
                       celerity_ratio: Optional[float] = None) -> float:
    """ENERGY factor in [0, 1], relative to a head-on swell on the same coast. THE function.

    Args:
        swell_from_deg:  bearing the swell comes FROM.
        shore_normal_deg: this spot's shore normal, pointing OUT TO SEA.
        headland_rotation_deg: how far a nearby sheltering coast's normal is rotated TOWARD this
            swell relative to this spot's normal, in degrees, non-negative. 0 means "straight
            beach / no headland" and is the safe default -- with 0 this function is never more
            generous than the shipped exposure floor at any angle. See
            `resolve_headland_rotation()` for how it is measured, and note that it is measured AT
            the swell bearing, which is why it needs no sign.
        spread_sigma_deg: directional spreading sigma; defaults to SPREAD_SIGMA_DEG (Goda smax=75,
            long-decay swell) and is clamped to SPREAD_SIGMA_MAX_DEG so the straight-beach
            guarantee cannot be widened out from under a caller.
        celerity_ratio: Cb/C0 for the Snell term; bounded effect (at most 1.045x), see the constant.

    Contract:
        * dtheta == 0 returns exactly 1.0, for any geometry.
        * monotone non-increasing in dtheta at fixed geometry.
        * with headland_rotation_deg == 0, <= clamp(0.10 + 0.90 max(0, cos dtheta)) at every angle.
        * unknown geometry fails OPEN to 1.0, matching `surf_rating.swell_exposure`.
    """
    if swell_from_deg is None or shore_normal_deg is None:
        return 1.0
    dtheta = abs(_wrap180(float(swell_from_deg) - float(shore_normal_deg)))
    rot = _resolve_rot(headland_rotation_deg)
    sigma = _resolve_sigma(spread_sigma_deg)
    cr = CELERITY_RATIO_DEFAULT if celerity_ratio is None else float(celerity_ratio)

    # Head-on is an exact identity by contract, not by luck: the general path returns 1 - 3e-16 here
    # because the denominator is the rot = 0 integral and a rotated coast adds a (utterly negligible)
    # far-tail sliver. The test suite asserts the general path agrees to 1e-9 just off head-on, so
    # this snap cannot hide a broken formula.
    if dtheta <= 0.0:
        return 1.0

    denominator = _head_on_flux(sigma, cr)
    if denominator <= 0.0:
        return 1.0
    return _clamp(_directional_flux(dtheta, rot, sigma, cr) / denominator, 0.0, 1.0)


def wrap_height_factor(swell_from_deg, shore_normal_deg, headland_rotation_deg=0.0,
                       spread_sigma_deg: Optional[float] = None,
                       celerity_ratio: Optional[float] = None) -> float:
    """HEIGHT factor -- sqrt of the energy factor, because H goes as sqrt(E).

    Provided so a wiring step never reaches for `surf_transform._height_exposure_factor`'s
    0.55 + 0.45 * e mapping, which was calibrated against the OLD exposure's 0.10-1.0 range and
    would re-introduce a floor this module exists to remove.
    """
    return math.sqrt(wrap_energy_factor(swell_from_deg, shore_normal_deg, headland_rotation_deg,
                                        spread_sigma_deg, celerity_ratio))


# --------------------------------------------------------------------------------------------------
# THIN RESOLVER -- reads the existing 463 m shore-normal asset. GATED, DEFAULT OFF.
# --------------------------------------------------------------------------------------------------

def is_enabled() -> bool:
    """SURF_WAVE_WRAPPING, default "0". Gates the resolving helpers only; the physics above is pure
    and always callable so it can be tested and A/B'd without a flag."""
    return os.environ.get("SURF_WAVE_WRAPPING", "0") == "1"


def _asset_entries_within(lat: float, lng: float, radius_km: float):
    """Every committed shore-normal asset entry within ``radius_km`` of (lat, lng).

    `shore_normal_asset` exposes only NEAREST-within-radius publicly, so this walks the same spatial
    index with the same bucket span and the same haversine. Read-only, no mutation, no caching of
    another module's state. A wiring step should promote a public `entries_within_km()` into that
    module rather than leaving a second scanner here -- flagged deliberately, not hidden.
    """
    index = shore_normal_asset._load()
    if not index:
        return []
    b_lat, b_lng = shore_normal_asset._bucket(lat, lng)
    lat_span, lng_span = shore_normal_asset._bucket_span(lat, radius_km)
    out = []
    for d_lat in range(-lat_span, lat_span + 1):
        for d_lng in range(-lng_span, lng_span + 1):
            for entry in index.get((b_lat + d_lat, b_lng + d_lng), ()):
                if shore_normal_asset._haversine_km(lat, lng, entry[0], entry[1]) <= radius_km:
                    out.append(entry)
    return out


def resolve_headland_rotation(lat, lng, swell_from_deg, shore_normal_deg,
                              radius_km: float = RELIEF_RADIUS_KM,
                              min_neighbours: int = RELIEF_MIN_NEIGHBOURS) -> Optional[float]:
    """RELIEF: |dtheta here| minus the smallest |dtheta| over shore normals within ``radius_km``.

    "Is there nearby coast whose normal actually FACES this swell." Measured 2026-08-09 at the
    served J-Bay swell (from 229.5): Jeffreys Bay 121.4 -> 81.7, relief 39.7 over n=12 neighbours,
    against New Smyrna 6.7 (n=10), Sebastian 8.3 (n=10), Cocoa Beach 11.2 (n=16). The Cape St
    Francis asset entry genuinely faces 147.8, so a stretch of coast 20 km from Supertubes presents
    81.7 deg to a swell Supertubes itself sees at 121.4.

    RETURNS None -- never 0.0 -- when the flag is off, when geometry is missing, or when fewer than
    ``min_neighbours`` entries are in range. 4 of 10 known point breaks read relief 0 at this radius
    purely from sparse sampling, so a 0 that could mean either "straight beach" or "nobody looked"
    is not a measurement. None means "not measured"; the caller keeps the status quo.
    """
    if not is_enabled():
        return None
    if None in (lat, lng, swell_from_deg, shore_normal_deg):
        return None
    entries = _asset_entries_within(float(lat), float(lng), float(radius_km))
    if len(entries) < int(min_neighbours):
        return None
    own = abs(_wrap180(float(swell_from_deg) - float(shore_normal_deg)))
    best = min(abs(_wrap180(float(swell_from_deg) - float(e[2]))) for e in entries)
    return _clamp(own - best, 0.0, HEADLAND_ROTATION_MAX_DEG)


def wrap_energy_factor_at(lat, lng, swell_from_deg, shore_normal_deg,
                          radius_km: float = RELIEF_RADIUS_KM,
                          min_neighbours: int = RELIEF_MIN_NEIGHBOURS,
                          spread_sigma_deg: Optional[float] = None,
                          celerity_ratio: Optional[float] = None) -> Optional[float]:
    """Resolver + physics, for a coordinate. None when the flag is off or the geometry REFUSED.

    None is deliberately not 1.0 and not the straight-beach value: a caller that cannot tell
    "wrapping not measured here" from "measured, no headland" would silently ship the second answer
    for the first case across every spot the sparse asset does not cover.
    """
    rot = resolve_headland_rotation(lat, lng, swell_from_deg, shore_normal_deg,
                                    radius_km, min_neighbours)
    if rot is None:
        return None
    return wrap_energy_factor(swell_from_deg, shore_normal_deg, rot,
                              spread_sigma_deg, celerity_ratio)
