"""currents_skill_collect.py - the forward collector of the currents-skill-v1 registration (section 2, 3). Serves nothing,
never calls the Raw Surf backend, writes only to a local directory (the workflow uploads it as an artifact and archives it
with sha256). Run on GitHub Actions only.

  frames    copy every arm's PUBLISHED frame set (CMEMS_025, GIOPS_025, RTOFS_025) verbatim from the public frames bucket:
            v1/latest.json -> each set's current index (and its previous one, still retained, for pass 2) -> every frame up
            to MAX_HOUR, each frame's sha256 checked against its index entry. Published frames are deleted two runs later
            (frame_set retention), so this runs after every init.
  native    the native 1/12-degree Copernicus subset (CMEMS_083) for the US radar boxes only, from the same ARCO store the
            served set reads, steps 0..MAX_HOUR of today's init, saved as npz (u, v m/s).
  hfr       a snapshot of every HF-radar region (ERDDAP griddap .nc, one request per day: water_u, water_v, hdop,
            number_of_sites) over the last SNAPSHOT_DAYS, saved as ONE sparse npz per region (every hour, only the cells
            that ever hold a velocity, raw values, no rule applied), plus the dataset's license / acknowledgement / time
            range read verbatim (section 9). Weekly: the window rolls.
  drifters  the Copernicus NRT drifter files (INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048, cmems_obs-ins_glo_phy-cur_nrt_drifter_irr)
            through the copernicusmarine toolbox; credentials by NAME only (COPERNICUSMARINE_SERVICE_USERNAME / _PASSWORD,
            read by the toolbox from the environment; never printed).

Every file written is listed in <out>/MANIFEST.json with its sha256 (the leak/freeze control compares these).
MAX_HOUR is 180, not the registration's 168: the D7 window (centre 168 h, 25 h wide) needs steps to 180 h (AMENDMENT
QUESTION A8).
"""
import argparse
import gzip
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional

ARM_SETS = {"CMEMS_025": "CMEMS/marine/currents/global_0p25", "GIOPS_025": "GIOPS/marine/currents/global_0p25",
            "RTOFS_025": "RTOFS/marine/currents/global_0p25"}
FRAME_BUCKET = "weather-frames"
LATEST = "v1/latest.json"
MAX_HOUR = 180
SNAPSHOT_DAYS = 9                  # weekly snapshots overlap by two days
GAP_S = 1.0                        # between requests to any one public server
COASTWATCH = "https://coastwatch.pfeg.noaa.gov/erddap"
PACIOOS = "https://pae-paha.pacioos.hawaii.edu/erddap"
# region: (ERDDAP server, dataset id, longitudes 0..360?, gated?, native box (lat0, lat1, lon0, lon1) in -180..180)
# The registration names ucsdHfrW6 / ucsdHfrE6; CoastWatch lists only their _Lon0360 twins now (searched 2026-11-22) and
# the PRVI mirror's source is hfradar_prvi_6km, not ..._usprvi_6km: AMENDMENT QUESTION A9. Hawaii's PacIOOS id is the
# registration's own and is confirmed at freeze.
REGIONS = {
    "uswc": (COASTWATCH, "ucsdHfrW6_Lon0360", True, True, (30.0, 50.0, -130.0, -115.0)),
    "usegc": (COASTWATCH, "ucsdHfrE6_Lon0360", True, True, (21.0, 47.0, -98.0, -60.0)),
    "ushi": (PACIOOS, "hfradar_ushi_6km", False, True, (18.0, 23.0, -161.0, -154.0)),
    "usprvi": (COASTWATCH, "ucsdHfrP6", False, False, (14.5, 22.0, -70.5, -61.0)),
}
NATIVE_REGIONS = ("uswc", "usegc", "ushi")      # section 9: native subsets for the three US radar regions only
DRIFTER_PRODUCT = "INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048"
DRIFTER_DATASET = "cmems_obs-ins_glo_phy-cur_nrt_drifter_irr"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Manifest:
    def __init__(self, out):
        self.out, self.items = out, []

    def write(self, rel: str, data: bytes):
        path = os.path.join(self.out, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        self.items.append({"path": rel, "sha256": sha256(data), "bytes": len(data)})
        return path

    def save(self, extra=None):
        body = {"written_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "files": self.items, **(extra or {})}
        with open(os.path.join(self.out, "MANIFEST.json"), "w", encoding="utf-8") as fh:
            json.dump(body, fh, indent=1, sort_keys=True)
        return body


def http_get(session=None, gap_s=GAP_S, retries=3):
    """get(url) -> bytes, polite (one request at a time, gap_s apart), 3 tries; raises on a final failure."""
    import requests
    s = session or requests.Session()
    last = [0.0]

    def get(url, timeout=300):
        err = None
        for k in range(retries):
            wait = last[0] + gap_s - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.monotonic()
            try:
                r = s.get(url, timeout=timeout)
                if r.status_code == 200:
                    return r.content
                err = f"HTTP {r.status_code}"
                if r.status_code == 404:
                    break
            except Exception as e:  # noqa: BLE001 - network edge
                err = type(e).__name__
            time.sleep(5 * (k + 1))
        raise RuntimeError(f"GET {url.split('?')[0]}: {err}")
    return get


# ---- frames -----------------------------------------------------------------------------------------------------------
def frame_raw_sha(data: bytes) -> str:
    return sha256(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)


def copy_frames(base: str, get: Callable[[str], bytes], man: Manifest, arms=ARM_SETS, max_hour=MAX_HOUR, log=print):
    """Copy each arm's current and previous published runs. Returns {arm: [{run, index, frames, bad, status}]}; a frame
    whose sha256 differs from its index entry is NOT saved and is counted bad (that init then lacks the step: by rule it
    drops from that arm's lines)."""
    base = base.rstrip("/") + "/"
    latest = json.loads(get(base + LATEST))
    man.write("frames/latest.json", json.dumps(latest, indent=1, sort_keys=True).encode())
    report = {}
    for arm, key in arms.items():
        rec = (latest.get("sets") or {}).get(key)
        report[arm] = []
        if not rec or not rec.get("index"):
            report[arm].append({"status": "ABSENT", "reason": "not in latest.json (set not published)"})
            log(f"[collect] {arm}: {key} not published")
            continue
        for idx_path in [rec["index"], rec.get("previous_index")]:
            if not idx_path:
                continue
            try:
                ib = get(base + idx_path)
            except RuntimeError as e:
                report[arm].append({"index": idx_path, "status": "MISSING", "reason": str(e)})
                continue
            index = json.loads(ib)
            run = index.get("run", "unknown").replace("-", "").replace(":", "")
            man.write(f"frames/{arm}/{run}/{os.path.basename(idx_path)}", ib)
            got, bad = 0, []
            for fr in index.get("frames", []):
                h = (fr.get("meta") or {}).get("forecast_hour", (fr.get("source") or {}).get("forecast_hour"))
                if not fr.get("path") or h is None or h > max_hour:
                    continue
                data = get(base + fr["path"])
                if frame_raw_sha(data) != fr.get("sha256"):
                    bad.append(h)
                    continue
                man.write(f"frames/{arm}/{run}/f{int(h):03d}.bin", data)
                got += 1
            report[arm].append({"run": index.get("run"), "index": idx_path, "frames": got, "bad": bad, "status": "OK"})
            log(f"[collect] {arm}: run {index.get('run')} {got} frames, {len(bad)} refused")
    return report


def load_arm_frames(evidence: str, arm: str, run_stamp: str) -> Dict[int, bytes]:
    """{forecast hour: frame bytes} of one saved run, gathered from every archive under `evidence` (the same run is saved
    on two days, as the current and then the previous index: identical bytes, the first copy is used)."""
    import glob
    out = {}
    for d in sorted(glob.glob(os.path.join(evidence, "**", "frames", arm, run_stamp), recursive=True)):
        for f in sorted(os.listdir(d)):
            if f.startswith("f") and f.endswith(".bin") and int(f[1:4]) not in out:
                out[int(f[1:4])] = open(os.path.join(d, f), "rb").read()
    return out


def find_native(evidence: str, run_stamp: str, region: str) -> Optional[str]:
    import glob
    hits = sorted(glob.glob(os.path.join(evidence, "**", "native", run_stamp, f"{region}.npz"), recursive=True))
    return hits[0] if hits else None


# ---- native 1/12 -------------------------------------------------------------------------------------------------------
def native_subset(source, cycle: datetime, box, hours) -> dict:
    """{steps_h, lat, lon, u, v} for one box from a CmemsCurrentsSource-like reader (chunk reads only over the box)."""
    import numpy as np
    lat0, lat1, lon0, lon1 = box
    rows = np.arange(int(np.ceil((lat0 + 80.0) * 12)), int(np.floor((lat1 + 80.0) * 12)) + 1)
    cols = np.arange(int(np.ceil((lon0 + 180.0) * 12)), int(np.floor((lon1 + 180.0) * 12)) + 1)
    times = source.times()
    us, vs, steps = [], [], []
    for f in hours:
        t = times.get(cycle + timedelta(hours=f))
        if t is None:
            raise RuntimeError(f"no ARCO step at +{f} h")
        us.append(_box(source, "uo", t, rows, cols))
        vs.append(_box(source, "vo", t, rows, cols))
        steps.append(f)
    return {"steps_h": np.array(steps, float), "lat": -80.0 + rows / 12.0, "lon": -180.0 + cols / 12.0,
            "u": np.stack(us).astype("float32"), "v": np.stack(vs).astype("float32")}


def _box(source, name, t, rows, cols):
    import numpy as np
    meta = source._zarray(name)
    cy, cx = meta["chunks"][2], meta["chunks"][3]
    out = np.full((rows.size, cols.size), np.nan)
    for y in range(rows[0] // cy, rows[-1] // cy + 1):
        for x in range(cols[0] // cx, cols[-1] // cx + 1):
            flat = source._chunk(name, f"{t}.{source.SURFACE}.{y}.{x}")
            if flat is None:
                raise RuntimeError(f"{name} chunk {t}.{y}.{x} missing")
            blk = flat.reshape(cy, cx)
            rs = (rows >= y * cy) & (rows < (y + 1) * cy)
            cs = (cols >= x * cx) & (cols < (x + 1) * cx)
            out[np.ix_(rs, cs)] = blk[np.ix_(rows[rs] - y * cy, cols[cs] - x * cx)]
    out[~(np.abs(out) < 1e30)] = np.nan
    return out


def copy_native(source, cycle, man: Manifest, regions=NATIVE_REGIONS, hours=range(0, MAX_HOUR + 1, 6)):
    import io
    import numpy as np
    out = {}
    for reg in regions:
        sub = native_subset(source, cycle, REGIONS[reg][4], list(hours))
        buf = io.BytesIO()
        np.savez_compressed(buf, **sub)
        man.write(f"native/{cycle:%Y%m%dT%H%M%SZ}/{reg}.npz", buf.getvalue())
        out[reg] = int(sub["u"].shape[0])
    return out


# ---- HF radar ----------------------------------------------------------------------------------------------------------
def hfr_url(region, start: datetime, end: datetime):
    server, did, lon360, _g, box = REGIONS[region]
    lat0, lat1, lon0, lon1 = box
    if lon360:
        lon0, lon1 = lon0 % 360.0, lon1 % 360.0
    t0, t1 = start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")
    sl = f"[({t0}):1:({t1})][({lat0}):1:({lat1})][({lon0}):1:({lon1})]"
    return f"{server}/griddap/{did}.nc?" + ",".join(f"{v}{sl}" for v in ("water_u", "water_v", "hdop", "number_of_sites"))


def hfr_attrs(region, get):
    """The dataset's license, acknowledgement and live time range, read verbatim (section 9)."""
    server, did, *_ = REGIONS[region]
    info = json.loads(get(f"{server}/info/{did}/index.json"))
    rows = info["table"]["rows"]
    want = {"license", "acknowledgement", "time_coverage_start", "time_coverage_end", "title", "sourceUrl"}
    return {r[2]: r[4] for r in rows if r[0] == "attribute" and r[1] == "NC_GLOBAL" and r[2] in want}


def nc_to_arrays(data: bytes):
    """(hours, lats asc, lons, water_u, water_v, hdop, number_of_sites) of one ERDDAP griddap .nc response."""
    import netCDF4
    import numpy as np
    with netCDF4.Dataset("mem.nc", memory=data) as ds:
        units = ds.variables["time"].units
        if not units.startswith("seconds since 1970-01-01"):
            raise ValueError(f"time units {units!r}, expected seconds since 1970-01-01 (ERDDAP)")
        hours = np.rint(np.asarray(ds.variables["time"][:], float) / 3600.0).astype(np.int64)
        lats = np.asarray(ds.variables["latitude"][:], float)
        lons = np.asarray(ds.variables["longitude"][:], float)
        get = lambda n: np.ma.filled(np.ma.asarray(ds.variables[n][:], dtype=float), np.nan)
        arrs = [get(n) for n in ("water_u", "water_v", "hdop", "number_of_sites")]
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        arrs = [x[:, ::-1] for x in arrs]
    return (hours, lats, lons, *arrs)


def sparse_snapshot(parts):
    """One region snapshot from day parts: every hour, only the cells that ever hold a velocity (the rest of the grid is
    land or out of radar range). The validity rule (sites >= 2, hdop <= 1.25) is NOT applied here: the raw values are kept."""
    import numpy as np
    hours, lats, lons = [], None, None
    cols = {k: [] for k in ("u", "v", "hdop", "sites")}
    for h, la, lo, u, v, hd, si in parts:
        if lats is None:
            lats, lons = la, lo
        elif la.shape != lats.shape or lo.shape != lons.shape:
            raise ValueError("the region grid changed within a snapshot")
        new = ~np.isin(h, hours) if hours else np.ones(h.size, bool)
        hours.extend(h[new].tolist())
        for k, x in zip(cols, (u, v, hd, si)):
            cols[k].append(x[new].reshape(int(new.sum()), -1))
    stack = {k: np.concatenate(v) for k, v in cols.items()}
    keep = np.nonzero(np.isfinite(stack["u"]).any(0))[0]
    order = np.argsort(hours)
    return {"hours": np.asarray(hours, np.int64)[order], "lat": lats, "lon": lons, "cell": keep.astype(np.int32),
            "u": stack["u"][order][:, keep].astype("float32"), "v": stack["v"][order][:, keep].astype("float32"),
            "hdop": stack["hdop"][order][:, keep].astype("float32"),
            "sites": np.nan_to_num(stack["sites"][order][:, keep], nan=0).astype("int8")}


def snapshot_hfr(get, man: Manifest, now: datetime, regions=tuple(REGIONS), days=SNAPSHOT_DAYS, log=print):
    """One request per region-day (a 9-day East Coast grid is ~1 GB as one .nc), saved as one sparse npz per region."""
    import io
    import numpy as np
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    end = now.replace(minute=0, second=0, microsecond=0)
    out = {}
    for reg in regions:
        try:
            attrs = hfr_attrs(reg, get)
            man.write(f"hfr/{stamp}/hfr_{reg}_{stamp}.attrs.json", json.dumps(attrs, indent=1, sort_keys=True).encode())
            parts, nbytes = [], 0
            for d in range(days, 0, -1):
                t0 = end - timedelta(days=d)
                data = get(hfr_url(reg, t0, t0 + timedelta(hours=23)), timeout=900)
                nbytes += len(data)
                parts.append(nc_to_arrays(data))
            snap = sparse_snapshot(parts)
            buf = io.BytesIO()
            np.savez_compressed(buf, **snap)
            man.write(f"hfr/{stamp}/hfr_{reg}_{stamp}.npz", buf.getvalue())
            out[reg] = {"status": "OK", "pulled_bytes": nbytes, "kept_bytes": buf.tell(), "cells": int(snap["cell"].size),
                        "hours": int(snap["hours"].size), "license": attrs.get("license")}
        except (RuntimeError, ValueError, OSError) as e:
            out[reg] = {"status": "MISSING", "reason": str(e)}     # stated; the region may become insufficient
            log(f"[collect] hfr {reg}: {e}")
    return out


# ---- drifters ----------------------------------------------------------------------------------------------------------
def drifter_command(out_dir: str, subset="latest", filt: Optional[str] = None) -> List[str]:
    cmd = ["copernicusmarine", "get", "--dataset-id", DRIFTER_DATASET, "--output-directory", out_dir, "--no-directories",
           "--skip-existing", "--disable-progress-bar"]
    if filt:
        cmd += ["--filter", filt]
    else:
        cmd += ["--filter", f"*{subset}*"]
    return cmd


def collect_drifters(out_dir: str, man: Manifest, run=subprocess.run, subset="latest", filt=None):
    """Download through the toolbox (credentials from the environment by NAME), then list every file with its sha256."""
    tmp = os.path.join(out_dir, "_drifters_tmp")
    os.makedirs(tmp, exist_ok=True)
    if not os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME"):
        raise RuntimeError("COPERNICUSMARINE_SERVICE_USERNAME is not set (CI secret by name)")
    res = run(drifter_command(tmp, subset, filt), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"copernicusmarine get exited {res.returncode}")     # its output may hold request details: not printed
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    n = 0
    for root, _d, files in os.walk(tmp):
        for f in sorted(files):
            if f.endswith(".nc"):
                man.write(f"drifters/{stamp}/{f}", open(os.path.join(root, f), "rb").read())
                n += 1
    return {"files": n, "subset": subset}


# ---- CLI ---------------------------------------------------------------------------------------------------------------
def frames_base() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL is not set (CI secret by name)")
    return f"{url}/storage/v1/object/public/{FRAME_BUCKET}/"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["frames", "native", "hfr", "drifters"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--cycle", default="", help="native: the init (YYYY-MM-DD, 00Z); default today")
    ap.add_argument("--subset", default="latest", choices=["latest", "monthly"], help="drifters: pass 1 latest, pass 2 monthly")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    man = Manifest(a.out)
    now = datetime.now(timezone.utc)
    if a.what == "frames":
        rep = copy_frames(frames_base(), http_get(), man)
    elif a.what == "native":
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from services.frame_set_raster import make_source, spec_for
        src = make_source(spec_for("currents"))
        cyc = (datetime.strptime(a.cycle, "%Y-%m-%d").replace(tzinfo=timezone.utc) if a.cycle
               else now.replace(hour=0, minute=0, second=0, microsecond=0))
        rep = copy_native(src, cyc, man)
    elif a.what == "hfr":
        rep = snapshot_hfr(http_get(), man, now)
    else:
        rep = collect_drifters(a.out, man, subset=a.subset)
    body = man.save({"what": a.what, "report": rep})
    print(json.dumps({"what": a.what, "files": len(body["files"]), "bytes": sum(f["bytes"] for f in body["files"]),
                      "report": rep}, default=str))
    bad = any(isinstance(v, list) and any(r.get("bad") for r in v) for v in (rep.values() if isinstance(rep, dict) else []))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
