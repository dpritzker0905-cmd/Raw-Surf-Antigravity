"""Default-off PJ-02: add Komar-equivalent flux before the nonlinear breaker step.

For one train the scalar chain is C*(h**2*T)**.4 * A, where A is
the existing height-angle factor. Thus A**2.5 inside the sum preserves that
single-train calibration. This is a bulk proxy, not a directional spectrum
or a claim that A**2.5 is the physical cross-shore flux. Field validation and
owner approval remain required; no science lever is activated here.
"""
import math
import os


def estimate_partition_flux(partitions, depth_m, coastal=True, shelf_width_km=0.,
                            shore_normal_deg=None, magnet_factor=1., break_depth_m=None,
                            water_level_m=0.):
    from services.weather_pipeline import surf_transform as st
    rows = []
    for p in partitions or []:
        if not isinstance(p, dict):
            continue
        try:
            h, tp = float(p.get('h')), float(p.get('tp'))
        except (TypeError, ValueError):
            continue
        if math.isfinite(h) and math.isfinite(tp) and h > 0 and tp > 0:
            rows.append((h, tp, p.get('dir')))
    if not rows:
        return None, 'unknown'
    offshore = math.sqrt(math.fsum(h*h for h, _, _ in rows))
    if not coastal:
        return offshore, 'open_ocean'
    if depth_m is None or depth_m <= 0:
        return offshore, 'unknown_depth'
    komar = st._v3("SURF_V3_KOMAR")
    fluxes, arrivals, linear = [], [], []
    for h, tp, bearing in rows:
        surviving = h * st.shelf_dissipation(tp, depth_m, shelf_width_km)
        angle = st._height_exposure_factor(bearing, shore_normal_deg)
        if komar:
            fluxes.append(surviving**2 * tp * angle**2.5)
            arrivals.append((surviving * angle)**2)
        else:
            linear.append((surviving * st.shoaling_coefficient(tp, depth_m) * angle)**2)
    if komar:
        # Same C as komar_breaker_height. The jack bound is applied to the
        # combined surviving sea, so it too is independent of train count.
        height = st.komar_breaker_height(1., 1.) * math.fsum(fluxes)**.4
        try:
            jack_max = float(os.environ.get("SURF_V3_JACK_MAX", "2.0"))
        except (TypeError, ValueError):
            jack_max = 2.
        height = min(height, jack_max * math.sqrt(math.fsum(arrivals)))
    else:
        height = math.sqrt(math.fsum(linear))
    try:
        kr = float(os.environ.get("SURF_REFRACTION_KR", st.REFRACTION_KR))
    except (TypeError, ValueError):
        kr = st.REFRACTION_KR
    if kr > 0:
        height *= kr
    if magnet_factor and magnet_factor != 1. and st._v3("SURF_V3_MAGNETS"):
        height *= float(magnet_factor)
    slope = depth_m / (shelf_width_km * 1000.) if shelf_width_km and shelf_width_km > 0 else None
    # Retain the existing combined cap's longest usable period policy.
    # Invalid/empty trains must not set the cap. Tide and statistic are
    # applied once at the same shared publisher used by the scalar chain.
    cap = st.breaker_index(max(tp for _, tp, _ in rows), slope=slope) * st.effective_cap_depth(
        depth_m, break_depth_m, water_level_m)
    return st.publish_surf_height(height, cap, 'shelf' if height <= offshore else 'shoaling')
