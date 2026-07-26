"""
buoy_calibration.py — validate the offshore marine MODEL against NOAA NDBC buoy observations (P5 calibration).

GROUND TRUTH, measure-first (brain rules: don't tune blind). NDBC buoys measure the OFFSHORE significant wave
height (WVHT) + dominant period (DPD) — exactly the INPUTS the surf transform turns into breaking height. So
comparing the model's offshore Hs/Tp at a buoy to the buoy's reading validates the upstream wave model
(GFS/Copernicus/ICON); a rating can only be as good as that input. (Validating the BREAKING height itself
needs surf cams/reports — a later loop; this is the foundation.)

Design mirrors spot_ratings.py: pure parse/metric helpers (unit-tested, no I/O) + a thin runner meant for the
GitHub Action ingest runner (NOT the 1-CPU serve box). The runner fetches the free NDBC realtime feed
(https://www.ndbc.noaa.gov/data/realtime2/<STATION>.txt — no key), resolves the model at each spot that has a
noaa_buoy_id, computes residuals, and returns a report (optionally persisted to L2 for an admin view). Purely
additive + flag-gated (BUOY_CALIBRATION) — it never changes a served rating.
"""
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

NDBC_REALTIME_URL = "https://www.ndbc.noaa.gov/data/realtime2/{station}.txt"
BUOY_CALIBRATION_L2_KEY = "calibration/buoy_latest.json"
BUOY_CALIBRATION_SCHEMA_VERSION = 1
FT_PER_M = 3.28084

# NDBC realtime2 column order (after the two leading '#header' lines). Values of 'MM' = missing.
#   #YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
_COL = {"WVHT": 8, "DPD": 9, "APD": 10, "MWD": 11, "WTMP": 14}


def _num(tok) -> Optional[float]:
    """Parse an NDBC token to float, treating 'MM'/'' / non-numeric as missing (None)."""
    if tok is None:
        return None
    t = tok.strip()
    if not t or t.upper() == "MM":
        return None
    try:
        return float(t)
    except ValueError:
        return None


def parse_ndbc_realtime(text: str) -> Optional[dict]:
    """PURE: parse the most-recent observation from an NDBC realtime2 .txt payload.

    The file is newest-first after two '#'-prefixed header rows. Returns the first data row with a usable
    wave height as {time(UTC), wvht_m, dpd_s, apd_s, mwd_deg, wtmp_c}, or None if there's no wave obs (some
    stations report only met data). Tolerant of ragged whitespace + 'MM' missing markers."""
    if not text:
        return None
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) <= _COL["MWD"]:
            continue
        wvht = _num(parts[_COL["WVHT"]])
        if wvht is None:
            continue                       # no wave height on this row → not a usable wave obs
        ts = None
        try:
            yr, mo, dy, hr, mn = (int(parts[i]) for i in range(5))
            ts = datetime(yr, mo, dy, hr, mn, tzinfo=timezone.utc).isoformat()
        except (ValueError, IndexError):
            ts = None
        return {
            "time": ts,
            "wvht_m": wvht,
            "dpd_s": _num(parts[_COL["DPD"]]),
            "apd_s": _num(parts[_COL["APD"]]),
            "mwd_deg": _num(parts[_COL["MWD"]]),
            "wtmp_c": _num(parts[_COL["WTMP"]]),
        }
    return None


def compare_obs_to_model(obs: dict, model_hs_m, model_tp_s) -> Optional[dict]:
    """PURE: residuals (model − buoy) for one spot. Returns None when the buoy has no wave height to compare.
    height_err_m / period_err_s are signed (model minus observed); abs_* are the magnitudes for MAE."""
    if not obs or obs.get("wvht_m") is None:
        return None
    out = {"buoy_wvht_m": obs["wvht_m"], "model_hs_m": model_hs_m,
           "buoy_dpd_s": obs.get("dpd_s"), "model_tp_s": model_tp_s,
           "height_err_m": None, "abs_height_err_m": None, "period_err_s": None, "abs_period_err_s": None}
    if model_hs_m is not None:
        out["height_err_m"] = round(model_hs_m - obs["wvht_m"], 3)
        out["abs_height_err_m"] = round(abs(model_hs_m - obs["wvht_m"]), 3)
    if model_tp_s is not None and obs.get("dpd_s") is not None:
        out["period_err_s"] = round(model_tp_s - obs["dpd_s"], 2)
        out["abs_period_err_s"] = round(abs(model_tp_s - obs["dpd_s"]), 2)
    return out


def aggregate_residuals(residuals) -> dict:
    """PURE: roll per-spot residuals into MAE + bias (mean signed error) + sample counts for height & period.
    Skips Nones. Bias > 0 means the model runs HIGH vs the buoys (systematic over-prediction)."""
    h_abs, h_signed, p_abs, p_signed = [], [], [], []
    for r in residuals or []:
        if not r:
            continue
        if r.get("abs_height_err_m") is not None:
            h_abs.append(r["abs_height_err_m"]); h_signed.append(r["height_err_m"])
        if r.get("abs_period_err_s") is not None:
            p_abs.append(r["abs_period_err_s"]); p_signed.append(r["period_err_s"])
    def _mean(xs):
        return round(sum(xs) / len(xs), 3) if xs else None
    return {
        "n_spots": len([r for r in (residuals or []) if r]),
        "height_mae_m": _mean(h_abs), "height_bias_m": _mean(h_signed), "height_n": len(h_abs),
        "height_mae_ft": round(_mean(h_abs) * FT_PER_M, 2) if h_abs else None,
        "period_mae_s": _mean(p_abs), "period_bias_s": _mean(p_signed), "period_n": len(p_abs),
    }


NDBC_LATEST_OBS_URL = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
_STATION_COORDS_CACHE: dict = {}


def parse_station_coords(text: str) -> dict:
    """PURE: {STATION_ID: (lat, lon)} from the NDBC bulk latest-observations feed.

    Column positions are read from the '#STN LAT LON ...' header rather than hardcoded, so an NDBC
    format change yields an EMPTY map (callers fall back to the spot location and tag the row) instead
    of silently reading some other column as a latitude."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    header = next((ln for ln in lines if ln.startswith("#STN")), None)
    if not header:
        return {}
    cols = header.lstrip("#").split()
    try:
        i_stn, i_lat, i_lon = cols.index("STN"), cols.index("LAT"), cols.index("LON")
    except ValueError:
        return {}
    out = {}
    for ln in lines:
        if ln.startswith("#"):
            continue
        t = ln.split()
        if len(t) <= max(i_stn, i_lat, i_lon):
            continue
        lat, lon = _num(t[i_lat]), _num(t[i_lon])
        if lat is None or lon is None:
            continue
        out[t[i_stn].strip().upper()] = (lat, lon)
    return out


async def fetch_ndbc_station_coords(client=None) -> dict:
    """Station positions for the whole NDBC network in ONE request, cached for the process.

    Never raises: on any failure it returns {} and calibrate_spots falls back to spot coordinates,
    tagging each affected row so the degradation is visible in the report rather than silent."""
    if _STATION_COORDS_CACHE:
        return _STATION_COORDS_CACHE
    try:
        if client is not None:
            resp = await client.get(NDBC_LATEST_OBS_URL)
            text = resp.text
        else:
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as c:
                text = (await c.get(NDBC_LATEST_OBS_URL)).text
        coords = parse_station_coords(text)
        if coords:
            _STATION_COORDS_CACHE.update(coords)
        else:
            logger.warning("[buoy-calibration] NDBC station coords empty — falling back to spot positions.")
        return coords
    except Exception as e:
        logger.warning(f"[buoy-calibration] station coords unavailable ({e}); using spot positions.")
        return {}


async def fetch_ndbc_latest(station_id: str, client=None) -> Optional[dict]:
    """Fetch + parse the latest NDBC observation for a station. Uses an injected httpx-like async client when
    given (tests), else a short-lived httpx.AsyncClient. Returns the obs dict or None (missing/error)."""
    if not station_id:
        return None
    url = NDBC_REALTIME_URL.format(station=str(station_id).strip().upper())
    try:
        if client is not None:
            resp = await client.get(url)
            text = resp.text if resp.status_code == 200 else None
        else:
            import httpx
            async with httpx.AsyncClient(timeout=15) as c:
                resp = await c.get(url)
                text = resp.text if resp.status_code == 200 else None
        return parse_ndbc_realtime(text) if text else None
    except Exception as e:
        logger.debug(f"[buoy-calibration] NDBC fetch failed for {station_id}: {e}")
        return None


def _one_residual_per_buoy(spot_residuals):
    """The aggregate must weight each BUOY once, not each spot.

    Many spots map to the same station (measured 2026-07-26: 1516 spots -> ~49 distinct buoys within
    100 km), and since the model is now resolved AT THE BUOY every spot sharing a station produces an
    IDENTICAL residual. Averaging per-spot would silently weight the summary by how many surf spots
    happen to cluster near a station — a dense stretch of Florida coast would outvote all of Hawaii.
    Rows without a buoy_id fall through individually so older/parital callers behave as before."""
    seen, out = set(), []
    for r in spot_residuals or []:
        bid = r.get("buoy_id")
        if bid is None:
            out.append(r.get("residual"))
            continue
        if bid in seen:
            continue
        seen.add(bid)
        out.append(r.get("residual"))
    return out


def build_calibration_report(spot_residuals) -> dict:
    """Wrap per-spot residual rows + the aggregate in the versioned L2 report object.

    `spots` keeps every per-spot row for auditability; `summary` aggregates ONE residual per distinct
    buoy (see _one_residual_per_buoy) so the bias/MAE is a property of the MODEL, not of spot density."""
    return {
        "version": BUOY_CALIBRATION_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": aggregate_residuals(_one_residual_per_buoy(spot_residuals)),
        "spots": spot_residuals,
    }


async def calibrate_spots(resolver, spots, model: str, valid_time: str, client=None) -> dict:
    """The CALIBRATION LOOP: for every spot with a noaa_buoy_id, fetch its buoy obs + the model's offshore
    Hs/Tp at the spot, and record the residual. `spots` are dicts (id/name/latitude/longitude/noaa_buoy_id).
    Returns the report object (build_calibration_report).

    The model is resolved AT THE BUOY's own coordinates (2026-07-26), not at the spot. Resolving at the
    spot conflated two different things: our MODEL's error, and the real physical difference between
    deep water where the buoy floats and the nearshore where the spot breaks. Only the first is a bias
    we should ever correct — "correcting" the second would be deleting real shoaling. Station
    coordinates come from the same bulk NDBC feed as the observations; if a station's position is
    unknown we fall back to the spot location and TAG the row (`resolved_at`), so a mixed report can
    never be read as if it were uniform.

    Model resolves are cached per buoy: many spots share a station, and the answer at a given buoy is
    the same for all of them. Never raises per spot (a bad buoy/resolve just yields a null residual)."""
    from services.weather_pipeline.schemas import NormalizedPointResponse
    coords = await fetch_ndbc_station_coords(client=client)
    rows = []
    _resolved = {}                      # buoy_id -> (model_hs, model_tp, resolved_at)
    for spot in spots:
        buoy_id = spot.get("noaa_buoy_id")
        if not buoy_id:
            continue
        bid = str(buoy_id).strip().upper()
        obs = await fetch_ndbc_latest(bid, client=client)
        if bid not in _resolved:
            station = coords.get(bid)
            lat, lng, at = ((station[0], station[1], "buoy") if station
                            else (spot.get("latitude"), spot.get("longitude"), "spot"))
            model_hs = model_tp = None
            try:
                marine = await resolver.resolve_point(
                    model=model, domain="marine", layer="waves",
                    lat=lat, lng=lng, valid_time_str=valid_time)
                if isinstance(marine, NormalizedPointResponse) and marine.point is not None:
                    model_hs = marine.point.speed      # offshore significant wave height (m)
                    model_tp = marine.point.period
            except Exception as e:
                logger.debug(f"[buoy-calibration] resolve failed for buoy {bid}: {e}")
            _resolved[bid] = (model_hs, model_tp, at)
        model_hs, model_tp, resolved_at = _resolved[bid]
        residual = compare_obs_to_model(obs, model_hs, model_tp) if obs else None
        rows.append({
            "spot_id": str(spot.get("id")), "name": spot.get("name"), "buoy_id": bid,
            "buoy_time": obs.get("time") if obs else None, "resolved_at": resolved_at,
            "residual": residual,
        })
    return build_calibration_report(rows)


def fetch_buoy_spots_via_rest(limit: int = 5000) -> list:
    """Read active spots that HAVE a noaa_buoy_id via Supabase REST (the CI runner has only the Storage key,
    which also authorizes PostgREST). Mirrors spot_ratings.fetch_active_spots_via_rest."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return []
    import requests
    url = (f"{base}/rest/v1/surf_spots?select=id,name,latitude,longitude,noaa_buoy_id"
           f"&is_active=eq.true&noaa_buoy_id=not.is.null"
           f"&latitude=not.is.null&longitude=not.is.null&limit={limit}")
    resp = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def upload_calibration_l2(store, obj) -> None:
    """Persist the calibration report to Supabase Storage L2 (same REST upload path as the grid products)."""
    import json
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    store._upload_to_supabase(BUOY_CALIBRATION_L2_KEY, data)


def load_calibration_l2() -> Optional[dict]:
    """Read the calibration report back from L2 via a self-contained Storage REST GET (mirrors the upload).
    Returns the parsed report or None (missing / not configured / error)."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    try:
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{BUOY_CALIBRATION_L2_KEY}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
        return resp.json() if resp.status_code == 200 else None
    except Exception as e:
        logger.debug(f"[buoy-calibration] L2 load failed: {e}")
        return None


_cal_cache = {"obj": None, "ts": 0.0}


def load_calibration_l2_cached(ttl: float = 300.0) -> Optional[dict]:
    """TTL-cached L2 read so the serve box hits Storage at most once per `ttl` (calibration refreshes hourly
    on the cron). Caches a None briefly too, so a missing report doesn't re-GET on every request."""
    import time
    now = time.time()
    if _cal_cache["obj"] is not None and (now - _cal_cache["ts"]) < ttl:
        return _cal_cache["obj"]
    _cal_cache["obj"] = load_calibration_l2()
    _cal_cache["ts"] = now
    return _cal_cache["obj"]


def run_buoy_calibration() -> tuple:
    """CI entry (flag-gated by the caller): read buoy-tagged spots (REST), resolve the model + buoy for each,
    upload the report to L2. Returns (n_spots, height_mae_m). Model via BUOY_CALIBRATION_MODEL (default GFS)."""
    import asyncio
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.spot_ratings import _make_point_resolver, _top_of_hour_utc
    spots = fetch_buoy_spots_via_rest()
    if not spots:
        logger.warning("[buoy-calibration] no buoy-tagged spots from REST — nothing to do.")
        return 0, None
    model = os.environ.get("BUOY_CALIBRATION_MODEL", "GFS").strip().upper()
    valid_time = _top_of_hour_utc().strftime("%Y-%m-%dT%H:00:00Z")
    resolver = _make_point_resolver()
    report = asyncio.run(calibrate_spots(resolver, spots, model, valid_time))
    upload_calibration_l2(ProductStore(), report)
    mae = report.get("summary", {}).get("height_mae_m")
    logger.info("[buoy-calibration] uploaded L2: %d spots, height MAE %.3f m.", len(spots), mae or -1)
    return len(spots), mae
