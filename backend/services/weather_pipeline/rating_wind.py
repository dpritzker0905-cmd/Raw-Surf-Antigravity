"""rating_wind.py — the surf RATING's wind is the HRRR lane inside CONUS (RATING_WIND_HRRR, default '0', DARK).

WHY. The rating's wind has been the same model's stored point wind (GFS = Open-Meteo `gfs_global`), while the wind MAP
draws NOAA HRRR inside HRRR's domain and horizon (`wind_lane.py`, D-017). Against 7 anemometers (L6, 2026-10-19..11-02,
n 2,469, spot-day cluster bootstrap) HRRR as the rating wind beat the served GFS wind by +1.17 rating points
[0.57, 1.82] with 5.6 pp fewer level misses (piers only +0.67 [0.13, 1.25]); ICON and ECMWF were worse.
⚠️ L6's "HRRR" was Open-Meteo's gfs_hrrr. On a FRESH window (2026-09-19..10-18, n 3,498) THIS lane's NOAA HRRR gained
only +0.22 [-0.30, 0.71], -0.84 [-1.46, -0.23] at the piers, and was worse in every light-wind regime after Holm, while
Open-Meteo's gfs_hrrr reproduced +1.27 [0.81, 1.75]. The flip gate is NOT met; keep it dark (log:
docs/weather-program/log/2026-11-03-claude-rating-wind-hrrr.md).

WHERE. ONE place: `point_resolution.resolve_point` calls `apply_to_wind_point` on every GFS wind point it returns, so
every surface that reads its wind there gets the same value — `spot_ratings.rate_one_spot` (glyphs, /spot-ratings, the
precompute, /point-rating) and the spot hub (`spot_conditions`), and the weather sim, which reads /api/weather/point.
The rating BAND (`grid_resolver_surf._build_wind_sampler`) has no point resolver; it passes its sampled wind through
`blend_ms`, the same function, so band and glyph grade on one wind.

WHAT. The SAME lane object /grid blends (`wind_lane.current_lane()`: one HRRR cycle on the 0.25-deg lattice, NOAA AWS,
area mean, rotated to earth), the SAME weights (`_hrrr_grid.space_weight`: 0 outside HRRR and in its 15 km relaxation
rows, a cos^2 feather over WIND_HRRR_FEATHER_KM, 200 km; `Lane.time_weight`), and the SAME per-node blend
(`wind_lane.blend_vector`: scalar speed, direction from the blended vector). So at a spot the rating wind IS the map's
wind at that place and hour, and nothing here can drift from it.

THE 48 H BOUNDARY. `Lane.time_weight` tapers HRRR linearly over WIND_HRRR_TAPER_HOURS (3) before the cycle's last hour:
weights 1 / 0.75 / 0.5 / 0.25 at horizon-3 h .. horizon, 0 after (Open-Meteo's own seamless hand-off, measured
2026-10-09). The rating wind therefore walks from HRRR to GFS over four hours instead of stepping, and is GFS past it.

FALLBACK (the rating keeps today's model wind, untouched): the flag off; WIND_HRRR_LANE=0 (the map's kill kills this
too: one product, one switch); a model other than GFS (the lane is GFS's, as on the map: EURO and ICON keep their own
wind); no lane in memory; an hour before the cycle, past the horizon or not held; outside HRRR or in its relaxation
rows; no HRRR cell near the spot; any error. Never raises.

COST (measured, log): no I/O on a request — the lane is the one the serve box already holds for /grid (the keeper
thread re-reads it every 300 s, server.py). A point reads 4 lattice cells (`sample_point`), ~20 us. The precompute
loads the lane ONCE per run (`preload`: one index read + the ~4.5 MB cycle object from L2), never per spot.
"""
import logging
import math
import os

logger = logging.getLogger(__name__)

FLAG = "RATING_WIND_HRRR"
MODELS = ("GFS",)


def enabled() -> bool:
    """RATING_WIND_HRRR=1 AND the map lane not killed (WIND_HRRR_LANE=0 turns both off). Read at call time."""
    if os.environ.get("RATING_WIND_HRRR", "0") != "1":
        return False
    from services.weather_pipeline import wind_lane
    return wind_lane.enabled()


def _lane():
    from services.weather_pipeline import wind_lane
    return wind_lane.current_lane()


def preload() -> bool:
    """Load the lane synchronously when the flag is on and none is in memory: the precompute calls this ONCE before it
    rates, so every spot-hour of a run sees one cycle (the serve box's background loader would arrive mid-run)."""
    if not enabled():
        return False
    from services.weather_pipeline import wind_lane
    if wind_lane._state.get("lane") is None:
        wind_lane.refresh()
    return wind_lane._state.get("lane") is not None


def sample_point(lane, lat, lng, k):
    """`Lane.sample` at ONE point, reading only its 2x2 lattice cells (the map's sampler dequantizes the whole hour):
    the same cells, the same dequantize, the same NaN-aware bilinear weights -> (u, v) knots, NaN off HRRR."""
    import numpy as np
    try:
        from services.noaa_hrrr_wind_fetcher import dequantize
    except ImportError:  # pragma: no cover
        from noaa_hrrr_wind_fetcher import dequantize
    from services.weather_pipeline import surf_rating as SR
    y = (float(lat) - lane.lat0) / lane.res
    x = (float(lng) - lane.lon0) / lane.res
    y0, x0 = int(math.floor(y + 1e-9)), int(math.floor(x + 1e-9))
    ty, tx = min(max(y - y0, 0.0), 1.0), min(max(x - x0, 0.0), 1.0)
    su = sv = sw = 0.0
    for dy, wy in ((0, 1.0 - ty), (1, ty)):
        for dx, wx in ((0, 1.0 - tx), (1, tx)):
            yy, xx = y0 + dy, x0 + dx
            if not (0 <= yy < lane.nlat and 0 <= xx < lane.nlon):
                continue
            cu = float(dequantize(np.asarray(lane.uq[k, yy, xx]).reshape(1))[0] * SR.MS_TO_KT)
            cv = float(dequantize(np.asarray(lane.vq[k, yy, xx]).reshape(1))[0] * SR.MS_TO_KT)
            w = wy * wx
            if w > 0 and math.isfinite(cu) and math.isfinite(cv):
                su += w * cu
                sv += w * cv
                sw += w
    if sw <= 1e-9:
        return float("nan"), float("nan")
    return su / sw, sv / sw


SEA_SEARCH_CELLS = 10          # 30 km on the 3 km grid (pre-registered 2026-11-04)
SEA_SAMPLES = ("sea_nearest", "sea_bilinear")


def sea_sample(u_e, v_e, land, lat, lng, mode="sea_nearest", radius=SEA_SEARCH_CELLS):
    """The HRRR wind over WATER at a spot, from NATIVE 3 km earth-relative fields `u_e`, `v_e` and the `land` mask
    (LAND:surface, 1 = land, 0 = water), all shaped (NY, NX) and indexed [j, i]. Returns (u, v) in the fields' units,
    or (nan, nan) when no finite water cell lies within `radius` cells. PURE (numpy).

    sea_nearest:  the water cell nearest the spot's fractional (i, j) (grid distance), within `radius`.
    sea_bilinear: the 2x2 bilinear stencil with land cells' weights dropped and the rest renormalised; a stencil with
                  no finite water cell falls back to sea_nearest.
    WHY (pre-registration rating-wind-hrrr-sea-preregistration.md): Open-Meteo, whose gfs_hrrr beat the lane by ~1
    rating point, picks the cell whose elevation matches the request (a sea cell at a pier); the lane averages land in.
    Evaluation status: scored by backend/scripts/rework_hrrr_score.py; NOT wired into serving (the lane stores no
    native cells) unless that score passes."""
    import numpy as np
    from services.weather_pipeline import wind_lane
    hg = wind_lane._grid()
    if mode not in SEA_SAMPLES:
        raise ValueError(f"unknown sea sample {mode!r}")
    ny, nx = land.shape
    fi, fj = hg.grid_ij(float(lat), ((float(lng) + 180.0) % 360.0) - 180.0)

    def water(j, i):
        return (0 <= j < ny and 0 <= i < nx and land[j, i] < 0.5
                and math.isfinite(float(u_e[j, i])) and math.isfinite(float(v_e[j, i])))

    if mode == "sea_bilinear":
        i0, j0 = int(math.floor(fi)), int(math.floor(fj))
        ti, tj = fi - i0, fj - j0
        su = sv = sw = 0.0
        for dj, wj in ((0, 1.0 - tj), (1, tj)):
            for di, wi in ((0, 1.0 - ti), (1, ti)):
                j, i = j0 + dj, i0 + di
                w = wi * wj
                if w > 0 and water(j, i):
                    su += w * float(u_e[j, i])
                    sv += w * float(v_e[j, i])
                    sw += w
        if sw > 1e-12:
            return su / sw, sv / sw
    ci, cj = int(round(fi)), int(round(fj))
    j_lo, j_hi = max(cj - radius, 0), min(cj + radius, ny - 1)
    i_lo, i_hi = max(ci - radius, 0), min(ci + radius, nx - 1)
    if j_lo > j_hi or i_lo > i_hi:
        return float("nan"), float("nan")
    jj, ii = np.mgrid[j_lo:j_hi + 1, i_lo:i_hi + 1]
    sub_u, sub_v = u_e[j_lo:j_hi + 1, i_lo:i_hi + 1], v_e[j_lo:j_hi + 1, i_lo:i_hi + 1]
    ok = (land[j_lo:j_hi + 1, i_lo:i_hi + 1] < 0.5) & np.isfinite(sub_u) & np.isfinite(sub_v)
    d2 = (ii - fi) ** 2 + (jj - fj) ** 2
    d2 = np.where(ok & (d2 <= radius * radius), d2, np.inf)
    k = int(np.argmin(d2))
    if not np.isfinite(d2.reshape(-1)[k]):
        return float("nan"), float("nan")
    return float(sub_u.reshape(-1)[k]), float(sub_v.reshape(-1)[k])


def sea_wind(u_kt, v_kt, lat, lng, valid, g_speed_kt, g_from_deg, horizon):
    """A native HRRR sample (u, v knots, earth-relative) blended with the model wind under the lane's OWN weights
    (space feather x time weight against `horizon`, `wind_lane.blend_vector`): the same dict as `lane_wind`, or None
    where HRRR carries no weight or the sample is missing. Used by the rework scorer so the candidate differs from
    the lane ONLY in the sample."""
    from services.weather_pipeline import wind_lane
    hg = wind_lane._grid()
    if g_speed_kt is None or g_from_deg is None or not (math.isfinite(u_kt) and math.isfinite(v_kt)):
        return None
    valid = hg.utc(valid)
    w = hg.space_weight(float(lat), ((float(lng) + 180.0) % 360.0) - 180.0, wind_lane.feather_km()) * \
        hg.time_weight(valid, hg.utc(horizon), wind_lane.taper_hours())
    if w <= 0.0:
        return None
    g_s, g_d = float(g_speed_kt), float(g_from_deg)
    g_u, g_v = -g_s * math.sin(math.radians(g_d)), -g_s * math.cos(math.radians(g_d))
    speed, u, v, direction = wind_lane.blend_vector(w, u_kt, v_kt, g_s, g_u, g_v, g_d)
    return {"speed_kt": round(speed, 4), "u_kt": round(u, 4), "v_kt": round(v, 4), "from_deg": round(direction, 2),
            "weight": round(w, 4)}


def lane_wind(lat, lng, valid, g_speed_kt, g_from_deg, lane=None):
    """The rating wind at (lat, lng, valid) given the model's own (speed kt, from-deg): a dict with speed_kt,
    from_deg, weight (HRRR's share, 0..1) and reason, or None when the lane does not apply (keep the model wind)."""
    from services.weather_pipeline import wind_lane
    hg = wind_lane._grid()
    lane = lane if lane is not None else _lane()
    if lane is None or g_speed_kt is None or g_from_deg is None:
        return None
    valid = hg.utc(valid)
    w_t = lane.time_weight(valid)
    if w_t <= 0.0:
        return None
    w = hg.space_weight(float(lat), ((float(lng) + 180.0) % 360.0) - 180.0, wind_lane.feather_km()) * w_t
    if w <= 0.0:
        return None
    hu, hv = sample_point(lane, lat, ((float(lng) + 180.0) % 360.0) - 180.0, lane.hour_index(valid))
    if not (math.isfinite(hu) and math.isfinite(hv)):
        return None
    g_s = float(g_speed_kt)
    g_d = float(g_from_deg)
    g_u, g_v = -g_s * math.sin(math.radians(g_d)), -g_s * math.cos(math.radians(g_d))
    speed, u, v, direction = wind_lane.blend_vector(w, hu, hv, g_s, g_u, g_v, g_d)
    return {"speed_kt": round(speed, 4), "u_kt": round(u, 4), "v_kt": round(v, 4), "from_deg": round(direction, 2),
            "weight": round(w, 4), "hrrr_cycle": wind_lane._iso(lane.cycle)}


def apply_to_wind_point(response, model, domain, layer, lat, lng, valid_time_str):
    """THE composition point: a GFS wind point response gets the lane wind in place (speed, direction, u, v in knots)
    and `_rating_wind` provenance (a private attribute: the served JSON is unchanged while the flag is off). Returns
    `response`. Never raises."""
    try:
        if not enabled():
            return response
        if (model or "").upper() not in MODELS or (domain or "").lower() != "wind" or (layer or "").lower() != "wind":
            return response
        pt = getattr(response, "point", None)
        if pt is None or not hasattr(response, "_rating_wind"):
            return response
        got = lane_wind(lat, lng, valid_time_str, pt.speed, pt.direction)
        if got is None:
            return response
        response.point = pt.model_copy(update={"speed": got["speed_kt"], "direction": got["from_deg"],
                                               "u": got["u_kt"], "v": got["v_kt"]})
        response._rating_wind = {"src": "hrrr" if got["weight"] >= 0.9999 else "hrrr+gfs",
                                 "weight": got["weight"], "hrrr_cycle": got["hrrr_cycle"]}
    except Exception as e:
        logger.warning(f"[rating-wind] lane wind failed, keeping the model wind: {type(e).__name__}: {e}")
    return response


def blend_ms(lat, lng, valid, speed_ms, from_deg, model):
    """The rating band's entry (`grid_resolver_surf`): its sampled (m/s, from-deg) through the same lane, or unchanged."""
    try:
        if not enabled() or (model or "").upper() not in MODELS or speed_ms is None:
            return speed_ms, from_deg
        from services.weather_pipeline import surf_rating as SR
        got = lane_wind(lat, lng, valid, float(speed_ms) * SR.MS_TO_KT, from_deg)
        if got is None:
            return speed_ms, from_deg
        return got["speed_kt"] * SR.KT_TO_MS, got["from_deg"]
    except Exception as e:
        logger.debug(f"[rating-wind] band lane wind failed, keeping the model wind: {type(e).__name__}: {e}")
        return speed_ms, from_deg
