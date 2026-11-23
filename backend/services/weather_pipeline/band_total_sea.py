"""The map rating band rates the TOTAL sea on every marine layer (bug hunt 2026-11-22 item D; owner: "Rate the whole sea").

The band used to grade whatever layer was on screen, so over Swell 1 / Swell 2 / Wind Waves it rated ONE partition as if it
were the whole sea (one point: total 85.3, swell_1 98.6, wind_waves 61.0) while the glyph beside it rates `waves`.

ONE FORECAST COMPOSITION: nothing is re-derived here. Each cell is handed the total-sea height, period and direction of the
product the POINT RESOLVER would answer that cell from (`manifest_point_selection`, the selection the band's wind and the
glyph's point already share), and the UNCHANGED band chain (`surf_rating.rating_transform_grid`) rates it. Afterwards the
partition's own period, direction, honest height (`phys_speed`) and u/v are restored, so the wave animation under the band is
the partition's, exactly as before. A cell with no total sea is not rated (the honest wash shows there), never rated on the
partition. Guarded flag BAND_RATES_TOTAL_SEA (runtime_flags), ON; kill '0' = the old per-layer rating.
"""
from services import runtime_flags as _rf

PARTITIONS = ("swell_1", "swell_2", "wind_waves")


def applies(layer) -> bool:
    return str(layer or "").lower() in PARTITIONS and _rf.flag("BAND_RATES_TOTAL_SEA") != "0"


def build_sampler(store, manifest, model, target_dt):
    """``(lat, lng) -> (height_m, period_s, from_deg) | None`` over the total-sea products, or None when the model has no
    `waves` product within the point resolver's time window. Products load lazily, once each (call it off the event loop)."""
    try:
        from services.weather_pipeline.manifest_point_selection import choose_for_point, point_candidates
        cands = point_candidates(manifest, model, "marine", "waves", target_dt)
    except Exception:
        return None
    if not (cands[0] or cands[1]):
        return None
    loaded = {}

    def sampler(lat, lng):
        p = choose_for_point(cands, lat, lng)
        if p is None:
            return None
        if p.filename not in loaded:
            loaded[p.filename] = _nearest(store, p.filename)
        s = loaded[p.filename]
        return s(lat, lng) if s is not None else None
    return sampler


def _nearest(store, filename):
    try:
        import numpy as np
        wp = store.load_product(filename)
        vex = [v for v in ((wp.grid.vectors if wp and wp.grid else None) or [])
               if getattr(v, "lat", None) is not None and getattr(v, "lng", None) is not None
               and getattr(v, "is_valid", True) and (getattr(v, "speed", None) or 0) > 0]
        if not vex:
            return None
        lats = np.array([v.lat for v in vex], dtype=np.float64)
        lngs = np.array([v.lng for v in vex], dtype=np.float64)
    except Exception:
        return None

    def sample(lat, lng):
        if lat is None or lng is None:
            return None
        dlng = np.abs(lngs - lng)
        dlng = np.where(dlng > 180, 360 - dlng, dlng)
        v = vex[int(np.argmin((lats - lat) ** 2 + dlng * dlng))]
        return (float(v.speed), getattr(v, "period", None), getattr(v, "direction", None))
    return sample


def swap_in(vectors, sampler):
    """Give every valid cell its total-sea inputs (height 0 where there is none, so the chain skips it). An invalid cell is
    left as it was. Returns what `restore` needs. ⚠️ `vectors` must be the overlay's OWN copies (it copies them first)."""
    saved = []
    for v in vectors:
        orig = (v.speed, v.period, v.direction, v.phys_speed)
        s = sampler(v.lat, v.lng) if (sampler is not None and v.is_valid) else None
        missing = v.is_valid and s is None
        if v.is_valid:
            v.phys_speed = None
            if s is None:
                v.speed = 0.0
            else:
                v.speed, v.period, v.direction = s[0], s[1], (s[2] if s[2] is not None else v.direction)
        saved.append((orig, v.is_valid, missing))
    return saved


def restore(vectors, saved):
    """Put the partition back: rated cells keep the band's score in `speed` and animate from the partition's height; a cell
    with no total sea is masked like open ocean (the honest wash shows there); every other cell is the partition again."""
    for v, ((speed, period, direction, phys), swapped, missing) in zip(vectors, saved):
        if not swapped:
            continue
        rated = v.phys_speed is not None and v.is_valid
        v.period, v.direction = period, direction
        if rated:
            v.phys_speed = speed
            continue
        if missing:
            v.is_valid = False
        v.speed = speed
        v.phys_speed = speed if (v.phys_speed is not None or missing) else phys
