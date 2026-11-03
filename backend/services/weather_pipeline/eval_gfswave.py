"""eval_gfswave.py - forecast-of-record INPUT for the evaluation harness: archived public GFS-Wave on the NOAA AWS
Open Data archive (s3://noaa-gfs-bdp-pds, anonymous HTTPS), cut into small crops around each station and spot, and
turned into the production schema (`NormalizedProduct`) so the PRODUCTION sampler and surf chain read it unchanged.

WHAT IS FETCHED, per (cycle, forecast hour): the file's `.idx`, then ONE byte range covering UGRD, VGRD (the GFS
10 m forcing wind the wave model ran on), HTSGW, PERPW and DIRPW (~3.2 MB of a ~30 MB file). Both go through
eval_provenance.Cache, so each crop carries the sha256 of the exact bytes it was decoded from.

WHAT IS NOT THE SERVED INPUT (each a named substitution in the scorecard, never silent):
  * WIND: served ratings read the GFS atmosphere file (pgrb2.0p25 UGRD/VGRD at 10 m, noaa_gfs_wind_fetcher). Its
    data template 5.3 needs an ecCodes backend (pygrib or eccodes); the harness reads it whenever one imports. Only
    with the built-in decoder does it use the wave file's own UGRD/VGRD, the GFS 10 m forcing on the same 0.25 deg
    grid (`wind_source` records which; that run has no production parity).
  * GRID: served /point samples the stored normalized product (regional tiles, coarse globals); the replay samples a
    native 0.25 deg crop with the same PointSampler (bilinear, ocean-masked corners, scalar height when
    SAMPLER_SCALAR_HEIGHT applies).
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

import numpy as np

from services.weather_pipeline import eval_grib2 as g2

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
WAVE_URL = BASE + "/gfs.{d}/{hh}/wave/gridded/gfswave.t{hh}z.global.0p25.f{fh:03d}.grib2"
ATM_URL = BASE + "/gfs.{d}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"
WAVE_KEYS = ("HTSGW", "PERPW", "DIRPW")
WIND_KEYS = {"gfswave": ("UGRD", "VGRD"), "pgrb2": ("UGRD:10m", "VGRD:10m")}
CROP_HALF_DEG = 1.5


def run_id(cycle: datetime) -> str:
    return f"GFS-Wave {cycle:%Y%m%d} {cycle:%H}Z (gfs.{cycle:%Y%m%d}/{cycle:%H})"


def urls(cycle: datetime, fh: int) -> Dict[str, str]:
    d, hh = f"{cycle:%Y%m%d}", f"{cycle:%H}"
    return {"wave": WAVE_URL.format(d=d, hh=hh, fh=fh), "atm": ATM_URL.format(d=d, hh=hh, fh=fh)}


def _span(cache, url: str, key: str, fetch_keys, decode_keys, source: str, backend: str):
    idx_raw, r_idx = cache.fetch(key + ".idx", url + ".idx", source=source + "_idx", parser="eval_grib2.parse_idx",
                                 time_standard="UTC (cycle + forecast hour)")
    idx = g2.parse_idx(idx_raw.decode("utf-8", "replace"))
    sel = g2.select_range(idx, fetch_keys)
    if sel is None:
        raise g2.Unsupported(f"{url}: idx lacks {fetch_keys}")
    lo, hi, keys = sel
    raw, r_grb = cache.fetch(f"{key}.{lo}-{hi}.grib2", url, (lo, hi), source=source,
                             parser=f"eval_grib2.decode_span({backend})", time_standard="UTC (cycle + forecast hour)",
                             notes=f"messages {','.join(keys)}; decoded {','.join(decode_keys)} by "
                                   f"{g2.backend_version(backend)}")
    return g2.decode_span(raw, keys, decode_keys, backend), [r_idx, r_grb]


def resolve(wind_source: str = "auto", decoder: str = "auto") -> Tuple[str, str]:
    """(wind source, GRIB backend). auto wind = the served pgrb2 10 m wind whenever the backend reads template 5.3
    (pygrib or eccodes), else the wave file's own forcing wind. pgrb2 with the built-in decoder is refused."""
    backend = g2.select_backend(decoder)
    if wind_source == "auto":
        wind_source = "pgrb2" if g2.reads_template_53(backend) else "gfswave"
    if wind_source == "pgrb2" and not g2.reads_template_53(backend):
        raise g2.Unsupported(f"the pgrb2 wind (data template 5.3) needs pygrib or eccodes, not {backend}")
    if wind_source not in WIND_KEYS:
        raise ValueError(f"unknown wind source {wind_source!r}")
    return wind_source, backend


def fetch_fields(cache, cycle: datetime, fh: int, wind_source: str = "auto", decoder: str = "auto"):
    """({HTSGW, PERPW, DIRPW, U, V: (array, meta)}, provenance records, info) for one (cycle, fh). The wave span
    always covers UGRD..DIRPW (the same bytes whichever wind is used, so one cache serves both); with the pgrb2 wind
    the 10 m UGRD/VGRD come from the atmosphere file, exactly as served ratings read them."""
    u = urls(cycle, fh)
    base = f"gfs/{cycle:%Y%m%d%H}/f{fh:03d}"
    wind_source, backend = resolve(wind_source, decoder)
    wave_fetch = list(WIND_KEYS["gfswave"]) + list(WAVE_KEYS)
    wave_decode = list(WAVE_KEYS) + (list(WIND_KEYS["gfswave"]) if wind_source == "gfswave" else [])
    fields, recs = _span(cache, u["wave"], base + "/wave", wave_fetch, wave_decode, "gfs_wave_grib2", backend)
    if wind_source == "pgrb2":
        wk = list(WIND_KEYS["pgrb2"])
        wf, r2 = _span(cache, u["atm"], base + "/atm", wk, wk, "gfs_atm_grib2", backend)
        fields.update(wf)
        recs += r2
    uk, vk = WIND_KEYS[wind_source]
    out = {k: fields[k] for k in WAVE_KEYS}
    out["U"], out["V"] = fields[uk], fields[vk]
    info = {"cycle": cycle.strftime("%Y-%m-%dT%H:%MZ"), "fh": fh, "run_id": run_id(cycle), "wind_source": wind_source,
            "decoders": sorted({m["decoder"] for _, m in out.values()}), "grib_backend": backend,
            "grib_backend_version": g2.backend_version(backend),
            "templates": {k: m.get("template") for k, (_, m) in out.items()},
            "grib_sha256": [r["sha256"] for r in recs if r["source"].endswith("grib2")]}
    return out, recs, info


def crop(fields: Dict[str, Tuple[np.ndarray, dict]], lat: float, lng: float, half_deg: float = CROP_HALF_DEG) -> dict:
    """A small JSON-able crop {lats, lngs, HTSGW, PERPW, DIRPW, U, V (None = masked)} around (lat, lng); longitudes
    in -180..180, rows south to north. Every field shares the wave grid."""
    arr, meta = fields["HTSGW"]
    n = int(math.ceil(half_deg / meta["dlat"]))
    i0, j0 = g2.index_of(meta, lat, lng)
    rows = [i for i in range(i0 - n + 1, i0 + n + 1) if 0 <= i < meta["nj"]]
    cols = list(range(j0 - n + 1, j0 + n + 1))
    lats = [round(meta["lat_south"] + i * meta["dlat"], 4) for i in rows]
    lngs = []
    for j in cols:
        x = (meta["lon_west"] + (j % meta["ni"]) * meta["dlon"]) % 360.0
        lngs.append(round(x - 360.0 if x > 180.0 else x, 4))
    out = {"lats": lats, "lngs": lngs}
    for k in ("HTSGW", "PERPW", "DIRPW", "U", "V"):
        a, m = fields[k]
        grid = ("ni", "nj", "lat_south", "lon_west", "dlat", "dlon")
        if any(abs(float(m[g]) - float(meta[g])) > 1e-6 for g in grid):
            raise g2.Unsupported(f"{k} is on another grid ({ {g: m[g] for g in grid} })")
        out[k] = [[g2.value_at(a, m, i, j) for j in cols] for i in rows]
    return out


def _bounds(c):
    from services.weather_pipeline.schemas import CoverageBounds
    return CoverageBounds(west=min(c["lngs"]), south=min(c["lats"]), east=max(c["lngs"]), north=max(c["lats"]))


def products(c: dict, cycle: datetime, valid: datetime) -> Dict[str, object]:
    """{"marine": NormalizedProduct(waves), "wind": NormalizedProduct(wind)} from one crop, built the way the
    normalizer builds vectors (u = -speed sin(from), v = -speed cos(from); masked cells is_valid False, zeros)."""
    from services.weather_pipeline import surf_rating as SR   # THE engine's knots<->m/s constant, never a local copy
    from services.weather_pipeline.schemas import GridVector, NormalizedGrid, NormalizedProduct
    mv, wv = [], []
    for a, la in enumerate(c["lats"]):
        for b, lo in enumerate(c["lngs"]):
            hs, tp, dr = c["HTSGW"][a][b], c["PERPW"][a][b], c["DIRPW"][a][b]
            if hs is None or dr is None:
                mv.append(GridVector(lat=la, lng=lo, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                                     is_valid=False))
            else:
                r = math.radians(dr)
                mv.append(GridVector(lat=la, lng=lo, speed=round(hs, 4), direction=round(dr, 2),
                                     u=round(-hs * math.sin(r), 4), v=round(-hs * math.cos(r), 4),
                                     period=round(tp, 2) if tp is not None else 0.0, is_valid=True))
            uu, vv = c["U"][a][b], c["V"][a][b]
            if uu is None or vv is None:
                wv.append(GridVector(lat=la, lng=lo, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                                     is_valid=False))
            else:
                spd = math.hypot(uu, vv) * SR.MS_TO_KT
                frm = math.degrees(math.atan2(-uu, -vv)) % 360.0
                r = math.radians(frm)
                wv.append(GridVector(lat=la, lng=lo, speed=round(spd, 4), direction=round(frm, 2),
                                     u=round(-spd * math.sin(r), 4), v=round(-spd * math.cos(r), 4), period=0.0,
                                     is_valid=True))
    bnd = _bounds(c)
    common = dict(model="GFS", provider="noaa_gfs_aws_archive", run_time=cycle, model_run_time=cycle,
                  model_run_time_status="known", valid_time=valid, is_forecast_authoritative=True,
                  is_estimated=False, coverage=bnd, freshness_sec=0,
                  source_dataset="eval_harness replay: gfswave.global.0p25 (AWS open archive)")
    rows, cols = len(c["lats"]), len(c["lngs"])
    marine = NormalizedProduct(domain="marine", layer="waves", value_kind="wave_height", value_unit="m",
                               display_unit_hint="ft", source_variables=["HTSGW", "PERPW", "DIRPW"],
                               grid=NormalizedGrid(bounds=bnd, cols=cols, rows=rows, vectors=mv), **common)
    wind = NormalizedProduct(domain="wind", layer="wind", value_kind="wind_speed", value_unit="kn",
                             display_unit_hint="kn", source_variables=["UGRD", "VGRD"],
                             grid=NormalizedGrid(bounds=bnd, cols=cols, rows=rows, vectors=wv), **common)
    return {"marine": marine, "wind": wind}


def plan(targets: List[datetime], leads: List[int], cycle_step_h: int = 6) -> List[Tuple[datetime, int, int, datetime]]:
    """[(cycle, fh, lead bucket, target)]: for each target and lead bucket L, the cycle at exactly target - L when it
    falls on the cycle grid (00/06/12/18 for step 6), else the latest cycle at or before target - L (fh > L)."""
    out = []
    for t in targets:
        for lead in leads:
            c = t - timedelta(hours=lead)
            c = c.replace(hour=(c.hour // cycle_step_h) * cycle_step_h, minute=0, second=0, microsecond=0)
            fh = int(round((t - c).total_seconds() / 3600.0))
            out.append((c, fh, lead, t))
    return out


def targets_between(start: datetime, end: datetime, step_h: int) -> List[datetime]:
    out, t = [], start.replace(tzinfo=start.tzinfo or timezone.utc)
    while t <= end:
        out.append(t)
        t += timedelta(hours=step_h)
    return out
