"""NDBC realtime2 spectral files -> per-record arrays (public data, polite, cached outside the repo).

Files per station (https://www.ndbc.noaa.gov/data/realtime2/<id>.<ext>, about 45 days, 30-minute records):
  data_spec  spectral density m2/Hz   swdir  alpha1 (deg FROM)   swr1  r1 (0-1)   txt  standard met (WDIR, WSPD)
Only a1 = r1 cos(alpha1) and b1 = r1 sin(alpha1) are needed by the default partitioner; swdir2/swr2 are not read.
Cache directory: environment variable RAW_SURF_PARTITION_TRUTH_CACHE (default: <tempdir>/raw_surf_partition_truth).
"""
import os
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

BASE = "https://www.ndbc.noaa.gov/data/realtime2/{sid}.{ext}"
LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
EXTS = ("data_spec", "swdir", "swr1", "txt")
USER_AGENT = "raw-surf-partition-truth/1 (research; contact via repository)"


def cache_dir() -> Path:
    d = Path(os.environ.get("RAW_SURF_PARTITION_TRUTH_CACHE") or Path(tempfile.gettempdir()) / "raw_surf_partition_truth")
    d.mkdir(parents=True, exist_ok=True)
    return d


def get(url: str, name: str, max_age_h: Optional[float] = None, pause_s: float = 0.5) -> Optional[bytes]:
    """Cached GET. A cached file is reused unless max_age_h says it is stale. Returns None on 404."""
    path = cache_dir() / name
    if path.exists() and path.stat().st_size > 0 and (max_age_h is None or time.time() - path.stat().st_mtime < max_age_h * 3600):
        return path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    path.write_bytes(data)
    time.sleep(pause_s)
    return data


def parse_spectral_table(text: str):
    """Realtime2 layout: 'YY MM DD hh mm [Sep_Freq] v1 (f1) v2 (f2) ...'. Returns (times, freqs, values[n, nf]); 999 -> nan."""
    times: List[datetime] = []
    rows: List[np.ndarray] = []
    freqs = None
    for line in text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.replace("(", " ").replace(")", " ").split()
        try:
            y, mo, d, h, mi = (int(float(x)) for x in p[:5])
        except ValueError:
            continue
        rest = p[5:]
        if len(rest) % 2 == 1:
            rest = rest[1:]
        try:
            v = np.array([np.nan if float(x) >= 998.0 else float(x) for x in rest[0::2]])
            f = np.array([float(x) for x in rest[1::2]])
        except ValueError:
            continue
        if freqs is None:
            freqs = f
        if len(f) != len(freqs) or not np.allclose(f, freqs):
            continue
        times.append(datetime(y, mo, d, h, mi, tzinfo=timezone.utc))
        rows.append(v)
    if freqs is None:
        return [], np.array([]), np.zeros((0, 0))
    return times, freqs, np.array(rows)


def parse_met(text: str) -> Dict[datetime, tuple]:
    """{time: (wdir_deg_from, wspd_ms)} from the standard-met .txt; MM -> missing (omitted)."""
    out = {}
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        if len(p) < 7:
            continue
        try:
            t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), int(p[4]), tzinfo=timezone.utc)
            wd, ws = float(p[5]), float(p[6])
        except ValueError:
            continue
        out[t] = (wd, ws)
    return out


def load_station(sid: str, max_age_h: float = 24.0) -> Optional[Dict]:
    """Aligned records for one station: {'times', 'freq', 'energy', 'a1', 'b1', 'wind': {time: (dir, speed)}} or None."""
    raw = {}
    for ext in EXTS:
        b = get(BASE.format(sid=sid, ext=ext), f"{sid}.{ext}", max_age_h=max_age_h)
        if b is None:
            return None
        raw[ext] = b.decode("utf-8", "replace")
    t_e, f, E = parse_spectral_table(raw["data_spec"])
    t_a, f_a, A = parse_spectral_table(raw["swdir"])
    t_r, f_r, R = parse_spectral_table(raw["swr1"])
    if not t_e or not t_a or not t_r or len(f) != len(f_a) or len(f) != len(f_r):
        return None
    ia = {t: i for i, t in enumerate(t_a)}
    ir = {t: i for i, t in enumerate(t_r)}
    keep = [i for i, t in enumerate(t_e) if t in ia and t in ir]
    if not keep:
        return None
    E = E[keep]
    A = np.array([A[ia[t_e[i]]] for i in keep])
    R = np.array([R[ir[t_e[i]]] for i in keep])
    a1 = R * np.cos(np.radians(A))
    b1 = R * np.sin(np.radians(A))
    return {"id": sid, "times": [t_e[i] for i in keep], "freq": f, "energy": np.nan_to_num(E), "a1": a1, "b1": b1,
            "wind": parse_met(raw["txt"])}


def station_positions(ids) -> Dict[str, tuple]:
    b = get(LATEST_OBS, "latest_obs.txt", max_age_h=24.0)
    pos = {}
    for line in (b or b"").decode("utf-8", "replace").splitlines():
        p = line.split()
        if not p or p[0].startswith("#") or len(p) < 3:
            continue
        if p[0] in ids:
            try:
                pos[p[0]] = (float(p[1]), float(p[2]))
            except ValueError:
                pass
    return pos
