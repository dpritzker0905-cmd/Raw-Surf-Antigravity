"""eval_replay.py - FORECAST-OF-RECORD REPLAY: the served surf chain, run under the EXACT served lane env, on
archived public model input, with every input and output of every spot-hour recorded. Serves nothing.

THE CHAIN IS THE PRODUCTION ONE, called, never copied (CLAUDE.md, ONE FORECAST COMPOSITION):
    PointSampler.sample_point (the served sampler)  ->  point_surf_augment.augment_with_surf
    (surf_point.resolve_surf_geometry + estimate_surf_at)  ->  spot_ratings.rate_one_spot
    (surf_rating.compute_surf_rating) - the reference implementation itself, through a replay resolver.
The station-depth quantity is nearshore_validation.model_hs_at_station, the instrument the nearshore lane grades
with (the served chain's own components at the buoy, pinned to estimate_surf by its parity test).

THE SERVED ENV is parsed at run time from the precompute workflow (`served_env`), so it cannot drift from the file:
every literal env value of the step that runs precompute_ci.py; `${{ vars.X || 'd' }}` resolves to its default d and
is LISTED (repository variables are not readable offline); secrets are listed BY NAME and removed from the process
env for the replay, so the replay cannot reach storage or a database even when a developer's shell holds them.

WHAT THE REPLAY CANNOT REACH OFFLINE is a NAMED GAP with a counter, never a silent stub (`GAPS`):
  size_reference   RATING_LOCAL_SIZE=1 grades against a per-spot size climatology held in storage. The replay
                   passes None (the global 1.2 m curve) and counts every spot-hour that would have read it.
  obs_gate         RATING_OBS_GATE=1 caps model-only good/epic at 69.9 unless >= 2 of GFS/EURO/ICON agree or a fresh
                   report confirms; it runs after rating, in the precompute merge. GFS-only replay cannot apply it;
                   the recorded score is PRE-gate.
  best_tide        the spot's best_tide prior (DB) is unknown, so tide_fit is neutral even with a tide state.
  primary_swell    the display-only swell_1 lane (no score effect) is not replayed.
  tide             served tide = Open-Meteo marine sea_level_height_msl at the rounded key (tide._round_key); the
                   replay fetches the same series by date and runs the production tide_state_at on it. Counted when
                   a spot-hour found no series.
UNREPLAYABLE ARMS (refused, not silently run as the baseline): flags whose input v0 does not archive.
"""
import asyncio
import contextlib
import hashlib
import math
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

SERVED_WORKFLOW = os.path.join(".github", "workflows", "precompute.yml")
SERVED_SCRIPT = "precompute_ci.py"
UNREPLAYABLE = {
    "SURF_PARTITIONS": "needs the swell partitions, which v0 does not archive",
    "SURF_NEARSHORE_MOP": "needs CDIP MOP forecast archives",
    "CONSENSUS_SERVE": "needs EURO and ICON (EURO needs Copernicus credentials only CI holds)",
    "COPERNICUS_PEAK_PERIOD": "a EURO input flag; v0 replays GFS only",
    "ICON_PEAK_PERIOD": "an ICON input flag; v0 replays GFS only",
    "RATING_OBS_GATE": "applied after rating in the precompute merge; the replay records pre-gate scores",
}
GAPS = ("size_reference", "obs_gate", "best_tide", "primary_swell", "tide_missing", "tide_replayed")
_VAR = re.compile(r"^\$\{\{\s*vars\.(\w+)\s*\|\|\s*'([^']*)'\s*\}\}$")


# ---- the served env ----------------------------------------------------------------------------------------------
def served_env(repo_root: str, workflow: str = SERVED_WORKFLOW, script: str = SERVED_SCRIPT) -> dict:
    """{workflow, sha256, step, env, repo_variables_defaulted, secrets_named, other_expressions}."""
    import yaml
    path = os.path.join(repo_root, workflow)
    with open(path, "rb") as f:
        raw = f.read()
    doc = yaml.safe_load(raw.decode("utf-8"))
    found = []
    for jname, job in (doc.get("jobs") or {}).items():
        for step in job.get("steps") or []:
            if script in str(step.get("run") or ""):
                found.append((jname, job, step))
    if len(found) != 1:
        raise ValueError(f"{workflow}: expected exactly one step running {script}, found {len(found)}")
    jname, job, step = found[0]
    merged = {}
    for layer in (doc.get("env") or {}, job.get("env") or {}, step.get("env") or {}):
        merged.update(layer)
    env, defaulted, secrets, other = {}, [], [], []
    for k, v in merged.items():
        s = "" if v is None else str(v)
        if "secrets." in s:
            secrets.append(k)
            continue
        m = _VAR.match(s.strip())
        if m:
            env[k] = m.group(2)
            defaulted.append({"name": k, "repo_variable": m.group(1), "default_used": m.group(2)})
            continue
        if "${{" in s:
            other.append(k)
            continue
        env[k] = s
    return {"workflow": workflow.replace(os.sep, "/"), "sha256": hashlib.sha256(raw).hexdigest(),
            "job": jname, "step": step.get("name"), "env": env, "repo_variables_defaulted": defaulted,
            "secrets_named": sorted(secrets), "other_expressions": sorted(other)}


def parse_arm(spec: str) -> Dict[str, str]:
    """'A=1,B=2' -> {A: '1', B: '2'}; refuses unreplayable flags and malformed names."""
    out = {}
    for part in [p for p in (spec or "").split(",") if p.strip()]:
        if "=" not in part:
            raise ValueError(f"arm '{spec}': '{part}' is not FLAG=value")
        k, v = part.split("=", 1)
        k = k.strip()
        if not re.match(r"^[A-Z][A-Z0-9_]*$", k):
            raise ValueError(f"arm '{spec}': bad flag name {k!r}")
        if k in UNREPLAYABLE:
            raise ValueError(f"arm '{spec}': {k} is not replayable in v0 ({UNREPLAYABLE[k]})")
        out[k] = v.strip()
    return out


@contextlib.contextmanager
def env_context(env: Dict[str, str], scrub: List[str]):
    """Set `env`, remove `scrub` (secrets, by name), restore exactly afterwards."""
    keys = set(env) | set(scrub)
    saved = {k: os.environ.get(k) for k in keys}
    try:
        for k in scrub:
            os.environ.pop(k, None)
        for k, v in env.items():
            os.environ[k] = v
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# ---- tide (the served source, by date) ---------------------------------------------------------------------------
class TideSeries:
    """Open-Meteo marine sea_level_height_msl per rounded key, fetched once per key for the whole window."""
    URL = ("https://marine-api.open-meteo.com/v1/marine?latitude={la}&longitude={lo}&hourly=sea_level_height_msl"
           "&start_date={b}&end_date={e}&timezone=GMT")

    def __init__(self, cache, start: datetime, end: datetime, enabled: bool = True):
        self.cache, self.enabled = cache, enabled
        self.b, self.e = (start - timedelta(days=1)).strftime("%Y-%m-%d"), (end + timedelta(days=1)).strftime("%Y-%m-%d")
        self._series: Dict[tuple, Optional[dict]] = {}

    def series(self, lat, lng) -> Optional[dict]:
        from services.weather_pipeline.tide import _round_key
        key = _round_key(lat, lng)
        if key in self._series:
            return self._series[key]
        got = None
        if self.enabled and self.cache is not None:
            import json
            try:
                body, _ = self.cache.fetch(f"tide/{key[0]}_{key[1]}_{self.b}_{self.e}.json",
                                           self.URL.format(la=key[0], lo=key[1], b=self.b, e=self.e),
                                           source="open_meteo_marine_tide", parser="tide.tide_state_at",
                                           time_standard="GMT", qc_policy="as published (model tide)")
                h = json.loads(body.decode("utf-8")).get("hourly") or {}
                if h.get("time") and h.get("sea_level_height_msl"):
                    got = {"time": [t + "Z" if not t.endswith("Z") else t for t in h["time"]],
                           "level": h["sea_level_height_msl"]}
            except Exception:                                   # noqa: BLE001 - counted as tide_missing
                got = None
        self._series[key] = got
        return got


@contextlib.contextmanager
def replay_patches(tides: Optional[TideSeries], gaps: Dict[str, int]):
    """Route the two offline-unreachable lookups through RECORDERS (named gaps), and make any other tide fetch fail
    loudly. Restores the originals."""
    from services.weather_pipeline import point_rating, tide

    async def tide_norm_at(lat, lng, valid_time, client=None):
        s = tides.series(lat, lng) if tides else None
        if not s:
            gaps["tide_missing"] += 1
            return None
        gaps["tide_replayed"] += 1
        return tide.tide_state_at(s["time"], s["level"], valid_time)

    async def local_reference_at(lat, lng):
        if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
            gaps["size_reference"] += 1
        return None

    async def no_fetch(*a, **k):
        raise RuntimeError("eval harness: live tide fetch attempted during replay")

    saved = (tide.tide_norm_at, point_rating.local_reference_at, tide.fetch_tide_hourly)
    tide.tide_norm_at, point_rating.local_reference_at, tide.fetch_tide_hourly = tide_norm_at, local_reference_at, no_fetch
    try:
        yield
    finally:
        tide.tide_norm_at, point_rating.local_reference_at, tide.fetch_tide_hourly = saved


class ReplayResolver:
    """The resolver rate_one_spot is handed: production sampler + production surf augmentation on replay products."""

    def __init__(self, products: dict, gaps: Dict[str, int]):
        from services.weather_pipeline.sampler import PointSampler
        self.products, self.gaps, self.sampler, self.last = products, gaps, PointSampler(), {}

    async def _no_partitions(self, *a, **k):
        return None

    async def _resolve_raw(self, model, layer, lat, lng, valid_time_str):
        """SURF_SPECTRAL_K's read point: the production sampler on the job's read-point crop (`products["kread"]`,
        present only when an arm sets the flag), no surf augmentation. None off the read points."""
        for prods in (self.products.get("kread") or {}).values():
            prod = prods.get(layer)
            if prod is not None and prods.get("_at") == (lat, lng):
                return self.sampler.sample_point(prod, lat, lng)
        return None

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        from services.weather_pipeline.point_surf_augment import augment_with_surf
        prod = self.products.get(domain)
        if prod is None:
            return None
        resp = self.sampler.sample_point(prod, lat, lng)
        if domain == "marine":
            resp = await augment_with_surf(resp, model, domain, layer, lat, lng, valid_time_str, self._no_partitions)
        self.last[domain] = resp
        return resp

    async def find_cached_grid_product(self, *a, **k):
        self.gaps["primary_swell"] += 1
        return None


def _r(x, nd=4):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), nd)


async def replay_one(products: dict, coord: dict, valid: datetime, gaps: Dict[str, int],
                     station_geom=None, station_depth_m: Optional[float] = None, station_id: Optional[str] = None) -> dict:
    """One spot-hour through the reference implementation: {inputs, outputs, hs_station_m}."""
    from services.weather_pipeline.nearshore_validation import model_hs_at_station
    from services.weather_pipeline.spot_ratings import rate_one_spot
    resolver = ReplayResolver(products, gaps)
    vt = valid.strftime("%Y-%m-%dT%H:%M:%SZ")
    spot = {"id": coord["name"], "name": coord["name"], "latitude": coord["lat"], "longitude": coord["lng"],
            "best_tide": None, "accuracy_flag": None, "is_verified_peak": None}
    rating = await rate_one_spot(resolver, spot, "GFS", vt, reference_size_m=None)
    gaps["best_tide"] += 1
    if os.environ.get("RATING_OBS_GATE", "0") == "1":
        gaps["obs_gate"] += 1
    m, w = resolver.last.get("marine"), resolver.last.get("wind")
    pt = getattr(m, "point", None)
    hs_station = None
    if station_geom is not None and pt is not None and pt.speed and pt.period:
        hs_station = model_hs_at_station(pt.speed, pt.period, pt.direction, station_geom.shore_normal_deg,
                                         station_depth_m, station_geom.depth_m, station_geom.shelf_width_km)
        # SURF_SPECTRAL_K (flag-gated): the arm's own instrument at the buoy, K at the buoy's MOP point shoaled to the
        # buoy depth (spectral_k_serving.station_hs). A buoy without a K entry keeps the bulk instrument above.
        if os.environ.get("SURF_SPECTRAL_K", "0") == "1" and station_id:
            from services.weather_pipeline.spectral_k_serving import station_hs
            hs_k = await station_hs("GFS", station_id, station_depth_m, vt, resolver._resolve_raw)
            if hs_k is not None:
                hs_station = hs_k
    tide_state = rating.get("tide") or {}
    return {
        "inputs": {"offshore_hs_m": _r(getattr(pt, "speed", None)), "tp_s": _r(getattr(pt, "period", None), 2),
                   "swell_from_deg": _r(getattr(pt, "direction", None), 1),
                   "marine_interp": getattr(pt, "interpolation_method", None),
                   "wind_kt": _r(getattr(getattr(w, "point", None), "speed", None), 3),
                   "wind_from_deg": _r(getattr(getattr(w, "point", None), "direction", None), 1),
                   "shore_normal_deg": _r(getattr(m, "shore_normal_deg", None), 2),
                   "shore_normal_src": getattr(m, "shore_normal_source", None),
                   "shelf_depth_m": _r(getattr(m, "shelf_depth_m", None), 1),
                   "break_depth_m": _r(getattr(m, "break_depth_m", None), 2),
                   "tide_height_m": tide_state.get("height_m"), "tide_norm": tide_state.get("norm"),
                   "reference_size_m": rating.get("reference_size_m")},
        "outputs": {"surf_height_m": rating.get("surf_height_m"), "surf_regime": getattr(m, "surf_regime", None),
                    "score": rating.get("score"), "level": rating.get("level"), "limiter": rating.get("limiter"),
                    "geometry_readiness": rating.get("geometry_readiness"), "why": rating.get("why")},
        "hs_station_m": _r(hs_station),
    }


def replay_arm(arm: str, env: Dict[str, str], scrub: List[str], jobs: List[dict], tides: Optional[TideSeries],
               stations: Dict[str, dict]) -> dict:
    """Run every job {station, coord, anchor, products, cycle, fh, lead, valid, info} under `env`.
    Returns {arm, env_delta, rows, gaps}."""
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    gaps = {g: 0 for g in GAPS}
    rows = []
    with env_context(env, scrub), replay_patches(tides, gaps):
        geoms = {}
        for sid, st in stations.items():
            if st["role"] == "nearshore":
                geoms[sid] = resolve_surf_geometry(float(st["lat"]), float(st["lng"]))

        async def run():
            for j in jobs:
                st = stations[j["station"]]
                res = await replay_one(j["products"], j["coord"], j["valid"], gaps,
                                       geoms.get(j["station"]) if j["anchor"] else None,
                                       float(st.get("depth_m") or 20.0), j["station"])
                rows.append({"arm": arm, "station": j["station"], "role": st["role"], "spot": j["coord"]["name"],
                             "anchor": j["anchor"], "lat": j["coord"]["lat"], "lng": j["coord"]["lng"],
                             "run_id": j["info"]["run_id"], "cycle": j["info"]["cycle"], "fh": j["fh"],
                             "lead_h": j["lead"], "valid": j["valid"].strftime("%Y-%m-%dT%H:%MZ"),
                             "wind_source": j["info"]["wind_source"], "decoders": j["info"]["decoders"],
                             "grib_backend": j["info"].get("grib_backend"),
                             "grib_backend_version": j["info"].get("grib_backend_version"),
                             "input_sha256": j["info"]["grib_sha256"], **res})
        asyncio.run(run())
    return {"arm": arm, "rows": rows, "gaps": gaps}


def parse_time(s: str) -> datetime:
    t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
