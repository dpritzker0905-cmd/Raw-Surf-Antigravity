"""surf_transect.py: arm A1 of the S0 ablation, a cross-shore breaking transect. OFFLINE, MODEL ONLY.

RULE: docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md ("Arm A replaced", 02:31Z) and the build log
2026-11-16-fable-surf-transect-a1.md. This module is NOT part of the served chain and nothing in `services/` or `routes/`
may import it (a test pins that). It changes no served number. It takes no wind.

WHAT IT IS. Today's chain turns an offshore height into surf with Komar and Gaughan's breaker height: one formula in
height and period that knows nothing about the beach, which is why a flat beach and a reef get the same number. This
arm instead marches the wave energy flux along a shore-normal line over the actual bed and removes energy where waves
break, so a wide gentle surf zone can take height off before the waves reach the shore.

THE EQUATIONS, from the SWAN Scientific and Technical documentation, section "Depth-induced wave breaking"
(https://swanmodel.sourceforge.io/online_doc/swantech/node16.html; read from the page on 2026-11-16 and checked against
the research lead's transcription; open documentation, the Battjes and Janssen 1978 bore model):

  (2.65)  D_tot = - alpha_BJ * Q_b * sigma_mean * H_max^2 / (8 pi)        alpha_BJ = 1 in SWAN
  (2.66)  (1 - Q_b) / ln(Q_b) = -8 * E_tot / H_max^2                      Q_b = fraction of breaking waves
          H_max = gamma * d                                               d = total water depth
  gamma:  0.8 (Battjes and Janssen 1978); average 0.73 (Battjes and Stive 1985); average 0.79 (Kaminsky and Kraus 1993)

E_tot is the wave variance (m^2): H_rms^2 = 8 E_tot, so (2.66) reads (1 - Q_b) / (-ln Q_b) = (H_rms / H_max)^2, solved
here by bisection. The slope-and-depth form of gamma and the Thornton and Guza constants are NOT on that page and are
not implemented: those arms stay NOT RUNNABLE.

THE MARCH (derived here from the energy-flux balance, not copied from any code):
  d/dx [ E_tot * c_g * cos(theta) ] = D_tot          x shoreward, theta from Snell's law (sin(theta) / c constant)
with linear-theory c and c_g at each depth, explicit steps along the bed, and the standard saturation limit
H_rms <= gamma * d applied after each step so a coarse step cannot leave more wave than the water can hold.

CHOICES THE EQUATIONS LEAVE OPEN, fixed here before any run:
  - sigma_mean = 2 pi / T_peak. The chain is handed a peak period and no mean period. (2.67) defines sigma_mean as the
    spectrum's mean frequency, which is higher than the peak for a real sea; using the peak gives LESS dissipation.
  - The model's height is taken to hold at the model point's depth; flux is conserved (no breaking) from there to the
    seaward end of the transect.
  - Surf = the largest H1/10 on the transect. TWO are returned: the highest-tenth mean of the model's own truncated
    distribution (`h110_truncated`, the consistent one), and 1.27 * Hs with Hs = sqrt(2) * H_rms, the open-sea Rayleigh
    factor the served chain uses, kept for comparison. The first run reported only the second; the advisor's review
    showed it exceeds the model's own largest wave (gamma d) where the sea is breaking, and the truncated one was added
    AFTER that model-only result had been seen. No truth was involved at either point.
  - Step 10 m, shortened where the bed is steep so no step crosses more than 0.1 m of depth (never under 0.5 m); the
    transect ends where the depth falls under 0.2 m."""
import math

G = 9.81
GAMMA_BS = 0.73            # Battjes and Stive 1985 average, the SWAN page's "average of 0.73"
ALPHA_BJ = 1.0
H110_OVER_HS = 1.27
STEP_M = 10.0
MIN_STEP_M = 0.5
MAX_DEPTH_CHANGE_M = 0.1
MIN_DEPTH_M = 0.2
MIN_WET_SAMPLES = 5


def wavenumber(period_s: float, depth_m: float) -> float:
    """Linear dispersion, omega^2 = g k tanh(k d), by Newton iteration from the deep-water value."""
    omega = 2.0 * math.pi / period_s
    k = omega * omega / G
    for _ in range(60):
        t = math.tanh(k * depth_m)
        f = G * k * t - omega * omega
        df = G * t + G * k * depth_m * (1.0 - t * t)
        step = f / df
        k -= step
        if abs(step) < 1e-12 * max(k, 1e-12):
            break
    return max(k, 1e-12)


def celerities(period_s: float, depth_m: float):
    """(phase speed c, group speed c_g) from linear theory."""
    k = wavenumber(period_s, depth_m)
    c = (2.0 * math.pi / period_s) / k
    kd2 = 2.0 * k * depth_m
    n = 0.5 * (1.0 + (kd2 / math.sinh(kd2) if kd2 < 700.0 else 0.0))
    return c, n * c


def breaking_fraction(e_tot: float, h_max: float) -> float:
    """Q_b from (2.66): (1 - Q_b) / (-ln Q_b) = (H_rms / H_max)^2, with H_rms^2 = 8 E_tot. 0 with no wave or no limit
    reached, 1 at or beyond saturation. The left side rises from 0 to 1 on (0, 1), so bisection is exact."""
    if e_tot <= 0.0 or h_max <= 0.0:
        return 1.0 if (e_tot > 0.0 and h_max <= 0.0) else 0.0
    b2 = 8.0 * e_tot / (h_max * h_max)
    if b2 >= 1.0:
        return 1.0
    if b2 < 0.01:                                  # (1 - Q)/(-ln Q) < 0.01 needs Q below e^-100 (4e-44): none are breaking
        return 0.0
    lo, hi = 1e-300, 1.0 - 1e-12
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if (1.0 - mid) / (-math.log(mid)) < b2:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


_SQRT_LN10 = math.sqrt(math.log(10.0))


def h110_truncated(e_tot: float, h_max: float) -> float:
    """The mean of the highest tenth of waves in the model's OWN distribution (added 2026-11-16 on the advisor's review).

    Battjes and Janssen's model is a Rayleigh distribution TRUNCATED at H_max = gamma d: every wave that would be higher
    is a breaking wave of height H_max, so no wave, and no mean of the highest tenth, can exceed H_max. Multiplying Hs
    by the open-sea Rayleigh factor 1.27 ignores that and reports more wave than the model allows where it is breaking.

    With Q_b the breaking fraction and S the scale of the underlying Rayleigh (exp(-(H_max/S)^2) = Q_b):
      Q_b >= 0.1      the whole highest tenth is breaking: H1/10 = H_max
      0 < Q_b < 0.1   H1/10 = h10 + 5 sqrt(pi) S (erf(H_max/S) - erf(sqrt(ln 10))), h10 = S sqrt(ln 10), never above H_max
      Q_b = 0         the untruncated value, 1.800 H_rms (= 1.273 Hs), which is the 1.27 the served chain uses"""
    if e_tot <= 0.0:
        return 0.0
    h_rms = math.sqrt(8.0 * e_tot)
    open_sea = (_SQRT_LN10 + 5.0 * math.sqrt(math.pi) * math.erfc(_SQRT_LN10)) * h_rms
    if h_max <= 0.0:
        return 0.0
    qb = breaking_fraction(e_tot, h_max)
    if qb <= 0.0:
        return min(open_sea, h_max)
    if qb >= 0.1:
        return h_max
    scale = h_max / math.sqrt(-math.log(qb))
    return min(h_max, scale * _SQRT_LN10 + 5.0 * math.sqrt(math.pi) * scale * (math.erf(h_max / scale) - math.erf(_SQRT_LN10)))


def dissipation(e_tot: float, depth_m: float, period_s: float, gamma: float = GAMMA_BS, alpha: float = ALPHA_BJ) -> float:
    """D_tot from (2.65), in m^2/s of variance (negative or zero)."""
    h_max = gamma * depth_m
    qb = breaking_fraction(e_tot, h_max)
    return -alpha * qb * (2.0 * math.pi / period_s) * h_max * h_max / (8.0 * math.pi)


def march(hs_m: float, period_s: float, angle_off_normal_deg: float, model_depth_m: float, bed, gamma: float = GAMMA_BS,
          alpha: float = ALPHA_BJ, step_m: float = STEP_M, mean_period_s=None) -> dict:
    """March the flux balance shoreward over `bed`, a list of (distance_from_shore_m, depth_m) with depth positive down.

    Returns the profile and TWO surf numbers, each the largest value on the line:
      "surf_truncated_m"  the highest-tenth mean of the model's own truncated distribution (`h110_truncated`): the
                          number that is consistent with the model, never above gamma d where it is taken;
      "surf_m"            1.27 x Hs, the open-sea Rayleigh factor the served chain applies. Kept for comparison only:
                          where the sea is breaking it exceeds the model's own largest wave.
    Also "steps" and "clipped_steps" (how often the saturation limit, not the dissipation term, set the energy), so a
    reader can tell which one did the physics. `mean_period_s` sets the mean frequency in the dissipation only; the
    wave still shoals on `period_s`. A number is None when the bed has too few wet samples or the inputs are unusable."""
    wet = sorted(((float(x), float(d)) for x, d in (bed or []) if d is not None and d > MIN_DEPTH_M), reverse=True)
    out = {"surf_m": None, "surf_at_m": None, "surf_depth_m": None, "surf_truncated_m": None, "surf_truncated_at_m": None,
           "surf_truncated_depth_m": None, "profile": [], "hs_at_start_m": None, "broke": False, "wet_samples": len(wet),
           "steps": 0, "clipped_steps": 0}
    if hs_m is None or period_s is None or not hs_m > 0 or not period_s > 0 or len(wet) < MIN_WET_SAMPLES:
        return out
    theta0 = math.radians(min(abs(angle_off_normal_deg or 0.0), 89.0))
    d0 = max(float(model_depth_m or 0.0), wet[0][1])
    c0, cg0 = celerities(period_s, d0)
    snell = math.sin(theta0) / c0
    flux = (hs_m * hs_m / 16.0) * cg0 * math.cos(theta0)                     # E = Hs^2 / 16 in variance units

    def at(x):
        """Depth at distance x from shore by linear interpolation of the wet samples (seaward first)."""
        for (x1, d1), (x2, d2) in zip(wet, wet[1:]):
            if x2 <= x <= x1:
                return d2 + (d1 - d2) * (x - x2) / (x1 - x2) if x1 > x2 else d1
        return wet[-1][1] if x < wet[-1][0] else wet[0][1]

    x = wet[0][0]
    best = (0.0, None, None)
    best_t = (0.0, None, None)
    sigma_period = float(mean_period_s) if (mean_period_s and mean_period_s > 0) else period_s
    while x >= wet[-1][0]:
        d = at(x)
        if d <= MIN_DEPTH_M:
            break
        c, cg = celerities(period_s, d)
        cos_t = math.sqrt(max(1e-6, 1.0 - min(0.999999, (snell * c) ** 2)))
        e = flux / (cg * cos_t)
        h_max = gamma * d
        out["steps"] += 1
        if 8.0 * e > h_max * h_max:                                          # saturation: no more wave than the water holds
            e = h_max * h_max / 8.0
            flux = e * cg * cos_t
            out["broke"] = True
            out["clipped_steps"] += 1
        hs = 4.0 * math.sqrt(e)
        if out["hs_at_start_m"] is None:
            out["hs_at_start_m"] = hs
        out["profile"].append((round(x, 1), round(d, 2), round(hs, 4)))
        if hs > best[0]:
            best = (hs, x, d)
        h110 = h110_truncated(e, h_max)
        if h110 > best_t[0]:
            best_t = (h110, x, d)
        dis = dissipation(e, d, sigma_period, gamma, alpha)
        if dis < 0.0:
            out["broke"] = True
        # Adaptive step: never more than `step_m`, and never more than MAX_DEPTH_CHANGE_M of depth per step, so a steep
        # bed is not crossed in one stride (a 1:10 beach at 10 m steps would jump a metre of depth at a time).
        fall = abs(d - at(x - 1.0))                                          # depth change over the next metre
        dx = max(MIN_STEP_M, min(step_m, MAX_DEPTH_CHANGE_M / fall)) if fall > 1e-9 else step_m
        flux = max(0.0, flux + dis * dx)                                     # shoreward step: D removes flux
        x -= dx
    if best[1] is not None:
        out.update({"surf_m": H110_OVER_HS * best[0], "surf_at_m": round(best[1], 1), "surf_depth_m": round(best[2], 2)})
    if best_t[1] is not None:
        out.update({"surf_truncated_m": best_t[0], "surf_truncated_at_m": round(best_t[1], 1),
                    "surf_truncated_depth_m": round(best_t[2], 2)})
    return out


def bed_from_grid(lat: float, lng: float, seaward_bearing_deg: float, elevation_at, reach_m: float = 3000.0,
                  landward_m: float = 600.0, sample_m: float = 100.0, max_depth_m: float = 20.0) -> dict:
    """A shore-normal bed profile from a gridded elevation `elevation_at(lat, lng)` (metres, positive up; None = no data).

    Samples every `sample_m` from `landward_m` behind the spot to `reach_m` seaward of it along the seaward bearing,
    finds the shoreline (the most seaward dry sample that has water seaward of it), and returns the wet samples as
    (distance_from_shore_m, depth_m) out to `max_depth_m` or the end of the reach. Also the slope fitted by least squares
    over the band from 1 m depth to the deepest sample used, and counts so coverage can be printed."""
    br = math.radians(seaward_bearing_deg)
    pts = []
    s = -landward_m
    while s <= reach_m + 1e-6:
        dlat = (s * math.cos(br)) / 111_195.0
        dlng = (s * math.sin(br)) / (111_195.0 * max(0.05, math.cos(math.radians(lat))))
        z = elevation_at(lat + dlat, lng + dlng)
        pts.append((s, z))
        s += sample_m
    known = [(s, z) for s, z in pts if z is not None]
    out = {"bed": [], "slope": None, "samples": len(pts), "known": len(known), "wet": 0, "shore_at_m": None,
           "deepest_m": None, "reached_max_depth": False, "water_landward_of_shore": 0}
    shore = None
    for i, (s, z) in enumerate(known):
        if z >= 0.0 and any(z2 < 0.0 for _s2, z2 in known[i + 1:]):
            shore = s
    if shore is None:
        shore = known[0][0] - sample_m if known and all(z < 0.0 for _s, z in known) else None   # spot and reach all water
    if shore is None:
        return out
    # The shoreline is the most SEAWARD dry sample, so an offshore bar, islet or jetty tip becomes the shore and the
    # water behind it is dropped. Counted, so such a spot can be flagged instead of trusted.
    out["water_landward_of_shore"] = sum(1 for s, z in known if s < shore and z < 0.0)
    bed = []
    for s, z in known:
        if s <= shore or z >= 0.0:
            continue
        bed.append((s - shore, -z))
        if -z >= max_depth_m:
            out["reached_max_depth"] = True
            break
    out.update({"bed": bed, "wet": len(bed), "shore_at_m": shore, "deepest_m": max((d for _x, d in bed), default=None)})
    band = [(x, d) for x, d in bed if d >= 1.0]
    if len(band) >= 2:
        mx, md = sum(x for x, _ in band) / len(band), sum(d for _, d in band) / len(band)
        den = sum((x - mx) ** 2 for x, _ in band)
        out["slope"] = (sum((x - mx) * (d - md) for x, d in band) / den) if den > 0 else None
    return out
