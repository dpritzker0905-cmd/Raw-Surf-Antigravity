"""eval_reference.py - the evaluation harness's REFERENCE-DATA REGISTRY: which public truth exists for which station,
how it is fetched, and how each raw file becomes observation records with their QC kept. Serves nothing.

SOURCES (all public, all read through eval_provenance.Cache, which hashes and records every raw file):
  * NDBC realtime2 (www.ndbc.noaa.gov/data/realtime2/<ID>.<ext>, the last ~45 days):
      .txt (stdmet: WVHT, DPD, APD, MWD, WSPD, WDIR), .data_spec (spectral density), .swdir / .swr1 (per-band mean
      direction alpha1 and first-order spread r1). Time standard: UTC, the stamp NDBC publishes (end of the
      acquisition period). QC: NDBC's automated realtime QC; a value that fails is published as MM (kept as
      `missing`, never filled). Station metadata version: the deployment (start date, hull code) covering the window
      in https://www.ndbc.noaa.gov/metadata/stationmetadata.xml (gate_v2_truth.parse_station_metadata).
  * CDIP realtime via THREDDS OPeNDAP ascii (thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/<ID>_rt.nc.ascii):
      waveTime (UTC sample START, epoch s), waveHs, waveTp, waveDp, waveFlagPrimary (1 good, 2 not evaluated,
      3 questionable, 4 bad, 9 missing: KEPT on every record; scoring uses 1 only, the nearshore lane's discipline).
      Station metadata version: the `.das` attributes cdip_deployment_id + the dataset `id` (deployment span).
  * CO-OPS water level (optional): api.tidesandcurrents.noaa.gov datagetter, product water_level, datum MSL,
      metric, GMT; its quality flags kept.

THE STATION LIST is data, not code (`scripts/eval_harness_stations.json`): id, source, role ("nearshore" CDIP buoys
inside the transform chain, or "offshore" NDBC buoys that verify the model INPUT), coordinates, depth, the anchor
spot whose served input is graded, the other linked spots (from data/nearshore_validation_pairs.json).
"""
import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from services.weather_pipeline import gate_v2_truth as truth

NDBC_RT = "https://www.ndbc.noaa.gov/data/realtime2/{id}.{ext}"
NDBC_META = "https://www.ndbc.noaa.gov/metadata/stationmetadata.xml"
CDIP_RT_ASCII = ("https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{id}_rt.nc.ascii"
                 "?waveTime,waveHs,waveTp,waveDp,waveFlagPrimary")
CDIP_RT_DAS = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{id}_rt.nc.das"
COOPS = ("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=raw_surf_eval"
         "&begin_date={b}&end_date={e}&datum=MSL&station={id}&time_zone=gmt&units=metric&format=json")
QC_GOOD = "good"
CDIP_FLAGS = {1: "good", 2: "not_evaluated", 3: "questionable", 4: "bad", 9: "missing"}
NDBC_TIME = "UTC (NDBC stamp: end of the acquisition period)"
CDIP_TIME = "UTC epoch seconds (CDIP waveTime: sample START of a ~30 min record)"
_ID = re.compile(r"^[0-9A-Za-z]{3,8}$")


class RegistryError(ValueError):
    pass


# ---- the station list ---------------------------------------------------------------------------------------------
def load_stations(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        obj = json.load(f)
    for s in obj.get("stations", []):
        if not _ID.match(str(s.get("id", ""))):
            raise RegistryError(f"bad station id {s.get('id')!r}")
        if s.get("source") not in ("cdip", "ndbc"):
            raise RegistryError(f"{s['id']}: source must be cdip or ndbc")
        if s.get("role") not in ("nearshore", "offshore"):
            raise RegistryError(f"{s['id']}: role must be nearshore or offshore")
        if s["role"] == "nearshore" and not s.get("anchor_spot"):
            raise RegistryError(f"{s['id']}: a nearshore station needs an anchor_spot (the served input it grades)")
    return obj


def stations_from_pairs(pairs: dict, ids: List[str]) -> List[dict]:
    """Nearshore station entries from data/nearshore_validation_pairs.json; the anchor is the NEAREST linked spot."""
    out = []
    by = {p["station"]: p for p in pairs.get("pairs", [])}
    for sid in ids:
        p = by.get(sid)
        if p is None:
            raise RegistryError(f"{sid} is not in the pair table")
        spots = sorted(p.get("spots") or [], key=lambda s: s.get("distance_km", 1e9))
        if not spots:
            raise RegistryError(f"{sid} has no linked spot")
        out.append({"id": sid, "source": "cdip", "role": "nearshore", "lat": p["station_lat"],
                    "lng": p["station_lng"], "depth_m": p["station_depth_m"],
                    "anchor_spot": {k: spots[0][k] for k in ("name", "lat", "lng", "distance_km")},
                    "spots": [{k: s[k] for k in ("name", "lat", "lng", "distance_km")} for s in spots]})
    return out


# ---- NDBC parsers ---------------------------------------------------------------------------------------------------
def _f(tok: str) -> Optional[float]:
    if tok in ("MM", "", None):
        return None
    try:
        v = float(tok)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def parse_ndbc_stdmet(text: str) -> List[dict]:
    """[{time, hs_m, tp_s (DPD), apd_s, dp_deg (MWD), wspd_ms, wdir_deg, qc}] newest-first as published, by the
    header's own column names (NDBC has reordered columns before). qc = good when WVHT is present, else missing."""
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    head = next((ln for ln in lines if ln.startswith("#YY")), None)
    if head is None:
        raise RegistryError("stdmet file without a #YY header")
    cols = head.lstrip("#").split()
    ix = {c: i for i, c in enumerate(cols)}
    for need in ("YY", "MM", "DD", "hh", "mm", "WVHT"):
        if need not in ix:
            raise RegistryError(f"stdmet header lacks {need}")
    out = []
    for ln in lines:
        if ln.startswith("#"):
            continue
        tok = ln.split()
        if len(tok) < len(cols):
            continue
        try:
            t = datetime(int(tok[ix["YY"]]), int(tok[ix["MM"]]), int(tok[ix["DD"]]), int(tok[ix["hh"]]),
                         int(tok[ix["mm"]]), tzinfo=timezone.utc)
        except ValueError:
            continue

        def g(c):
            return _f(tok[ix[c]]) if c in ix else None
        hs = g("WVHT")
        out.append({"time": t, "hs_m": hs, "tp_s": g("DPD"), "apd_s": g("APD"), "dp_deg": g("MWD"),
                    "wspd_ms": g("WSPD"), "wdir_deg": g("WDIR"), "qc": QC_GOOD if hs is not None else "missing",
                    "qc_raw": None if hs is not None else "MM"})
    return out


_PAIR = re.compile(r"([-+]?\d*\.?\d+)\s*\(\s*([-+]?\d*\.?\d+)\s*\)")


def parse_ndbc_banded(text: str) -> List[Tuple[datetime, List[Tuple[float, Optional[float]]]]]:
    """.swdir / .swr1 / .swdir2 / .swr2: [(time, [(f_hz, value or None)])]; 999.0 (NDBC's missing) -> None."""
    out = []
    for ln in (text or "").splitlines():
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        tok = ln.split()
        try:
            t = datetime(int(tok[0]), int(tok[1]), int(tok[2]), int(tok[3]), int(tok[4]), tzinfo=timezone.utc)
        except (ValueError, IndexError):
            continue
        pairs = [(float(f), (None if float(v) >= 999.0 else float(v))) for v, f in _PAIR.findall(" ".join(tok[5:]))]
        if pairs:
            out.append((t, sorted(pairs)))
    return out


def parse_ndbc_spec(text: str):
    """.data_spec, through the gate's own parser (gate_v2_truth.parse_data_spec): one implementation."""
    return truth.parse_data_spec(text)


def ndbc_meta_version(meta: Dict[str, dict], station: str, when: datetime) -> Optional[str]:
    st = meta.get(str(station).upper())
    if not st:
        return None
    for start, stop, code in st["history"]:
        if start <= when and (stop is None or when < stop):
            return f"ndbc-deployment:{start:%Y-%m-%d}:{code or 'uncoded'}"
    return None


# ---- CDIP parsers -----------------------------------------------------------------------------------------------
def _ascii_series(txt: str, name: str) -> List[float]:
    m = re.search(rf"^{name}(?:\.{name})?\[\d+\]\s*\n([^\n]+)", txt, re.M)
    if not m:
        return []
    vals = []
    for v in m.group(1).split(","):
        v = v.strip()
        if v:
            try:
                vals.append(float(v))
            except ValueError:
                vals.append(float("nan"))
    return vals


def parse_cdip_ascii(text: str) -> List[dict]:
    """[{time, hs_m, tp_s, dp_deg, qc, qc_raw}] from the OPeNDAP ascii answer. Fill values (-999.99) -> None.
    The flag is KEPT on every record; nothing is dropped here."""
    if "Error {" in (text or "")[:200]:
        raise RegistryError("CDIP answered an OPeNDAP error")
    t, hs, tp, dp, fl = (_ascii_series(text, n) for n in ("waveTime", "waveHs", "waveTp", "waveDp",
                                                          "waveFlagPrimary"))
    n = min(len(t), len(hs), len(fl))
    if n == 0:
        raise RegistryError("CDIP ascii holds no waveTime/waveHs/waveFlagPrimary")

    def ok(x):
        return None if (x is None or x != x or x <= -999) else float(x)
    out = []
    for i in range(n):
        flag = int(fl[i]) if fl[i] == fl[i] else 9
        out.append({"time": datetime.fromtimestamp(t[i], tz=timezone.utc), "hs_m": ok(hs[i]),
                    "tp_s": ok(tp[i]) if i < len(tp) else None, "dp_deg": ok(dp[i]) if i < len(dp) else None,
                    "qc": CDIP_FLAGS.get(flag, "unknown"), "qc_raw": flag})
    return out


def parse_cdip_das(text: str) -> dict:
    """{deployment_id, dataset_id, wmo_id, depth_m, lat, lng, history} from the `.das` global attributes."""
    def attr(name):
        m = re.search(rf'String {name} "([^"]*)"', text or "")
        return m.group(1) if m else None

    def num(name):
        m = re.search(rf"Float32 {name} ([-0-9.Ee+]+);", text or "")
        return float(m.group(1)) if m else None
    depth = None
    summ = attr("summary") or ""
    m = re.search(r"water depth is approximately ([0-9.]+) meters", summ)
    if m:
        depth = float(m.group(1))
    lat = [num("geospatial_lat_min"), num("geospatial_lat_max")]
    lng = [num("geospatial_lon_min"), num("geospatial_lon_max")]
    return {"deployment_id": attr("cdip_deployment_id"), "dataset_id": attr("id"), "wmo_id": attr("wmo_id"),
            "depth_m": depth, "lat": (sum(lat) / 2) if None not in lat else None,
            "lng": (sum(lng) / 2) if None not in lng else None, "history": attr("history")}


# ---- CO-OPS -------------------------------------------------------------------------------------------------------
def parse_coops(text: str) -> List[dict]:
    obj = json.loads(text or "{}")
    if "error" in obj:
        raise RegistryError(f"CO-OPS error: {obj['error'].get('message')}")
    out = []
    for r in obj.get("data", []):
        try:
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        out.append({"time": t, "wl_m": _f(r.get("v")), "qc": r.get("q"), "qc_raw": r.get("f")})
    return out


# ---- the fetch, per station ----------------------------------------------------------------------------------------
def fetch_station(cache, station: dict, window: Tuple[datetime, datetime], ndbc_meta: Optional[dict] = None,
                  with_spectra: bool = True) -> dict:
    """{"obs": [records], "spectra": {...}, "meta": {...}, "records": [provenance]} for one station. Raises on the
    primary series (the caller isolates one station's failure); optional products are best-effort and counted."""
    sid, recs, extra = station["id"], [], {"failed": []}
    if station["source"] == "cdip":
        das_raw, r1 = cache.fetch(f"cdip/{sid}/rt.das", CDIP_RT_DAS.format(id=sid), source="cdip_realtime_das",
                                  parser="eval_reference.parse_cdip_das", time_standard="n/a (metadata)")
        das = parse_cdip_das(das_raw.decode("utf-8", "replace"))
        version = f"cdip:{das['deployment_id']}:{das['dataset_id']}"
        body, r2 = cache.fetch(f"cdip/{sid}/rt.ascii", CDIP_RT_ASCII.format(id=sid), source="cdip_realtime",
                               parser="eval_reference.parse_cdip_ascii", time_standard=CDIP_TIME,
                               qc_policy="waveFlagPrimary kept per record; scored on flag 1 (good) only",
                               station_meta_version=version)
        obs = parse_cdip_ascii(body.decode("utf-8", "replace"))
        recs += [r1, r2]
        meta = {"version": version, **das}
    else:
        body, r2 = cache.fetch(f"ndbc/{sid}/rt.txt", NDBC_RT.format(id=sid, ext="txt"), source="ndbc_realtime2_stdmet",
                               parser="eval_reference.parse_ndbc_stdmet", time_standard=NDBC_TIME,
                               qc_policy="NDBC automated realtime QC; failed values published as MM (kept missing)",
                               station_meta_version=ndbc_meta_version(ndbc_meta or {}, sid, window[0]))
        obs = parse_ndbc_stdmet(body.decode("utf-8", "replace"))
        recs.append(r2)
        meta = {"version": r2.get("station_meta_version")}
        if with_spectra:
            for ext, parser in (("data_spec", "eval_reference.parse_ndbc_spec"),
                                ("swdir", "eval_reference.parse_ndbc_banded"),
                                ("swr1", "eval_reference.parse_ndbc_banded")):
                try:
                    b, r = cache.fetch(f"ndbc/{sid}/rt.{ext}", NDBC_RT.format(id=sid, ext=ext),
                                       source=f"ndbc_realtime2_{ext}", parser=parser, time_standard=NDBC_TIME,
                                       qc_policy="999.0 / MM = missing, kept", station_meta_version=meta["version"])
                    recs.append(r)
                    txt = b.decode("utf-8", "replace")
                    extra[ext] = len(parse_ndbc_spec(txt) if ext == "data_spec" else parse_ndbc_banded(txt))
                except Exception as e:                                  # noqa: BLE001 - optional product, counted
                    extra["failed"].append(f"{ext}: {type(e).__name__}")
    if station.get("coops_id"):
        b, e = (window[0] - timedelta(days=1)).strftime("%Y%m%d"), (window[1] + timedelta(days=1)).strftime("%Y%m%d")
        try:
            body, r = cache.fetch(f"coops/{station['coops_id']}/wl_{b}_{e}.json",
                                  COOPS.format(id=station["coops_id"], b=b, e=e), source="coops_water_level",
                                  parser="eval_reference.parse_coops", time_standard="GMT", qc_policy="CO-OPS q/f kept")
            recs.append(r)
            extra["coops_n"] = len(parse_coops(body.decode("utf-8", "replace")))
        except Exception as ex:                                             # noqa: BLE001
            extra["failed"].append(f"coops: {type(ex).__name__}")
    obs.sort(key=lambda o: o["time"])
    return {"obs": obs, "meta": meta, "extra": extra, "records": recs}


def good(obs: List[dict]) -> List[dict]:
    """QC-good records with a height, time-sorted (the only ones scoring reads)."""
    return [o for o in obs if o.get("qc") == QC_GOOD and o.get("hs_m") is not None]


def nearest(obs_sorted: List[dict], when: datetime, tol_s: float, before_only: bool = False) -> Optional[dict]:
    """The QC-good record nearest `when` within tol_s (before_only: at or before `when`, the persistence rule)."""
    best, best_d = None, None
    for o in obs_sorted:
        d = (o["time"] - when).total_seconds()
        if before_only and d > 0:
            break
        if abs(d) <= tol_s and (best_d is None or abs(d) < best_d):
            best, best_d = o, abs(d)
        if d > tol_s:
            break
    return best
