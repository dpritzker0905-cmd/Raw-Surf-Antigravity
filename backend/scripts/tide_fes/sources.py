"""Inputs for the M1 tide gate (OFFLINE ONLY: run by .github/workflows/tide-fes-gate.yml, never by the served backend).

- NOAA CO-OPS: public read-only GETs (predictions, High/Low, observed water, datums, harmonic constants, metadata).
- Open-Meteo marine: TEST-ONLY reference arms C and D (owner 2026-11-15 22:01 EST: "We can use open-meteo for testing
  against our system"). Never served from here.
- FES2022b: AVISO SFTP with AVISO_USERNAME / AVISO_PASSWORD from the environment, never printed; the server must
  present a pinned host key BEFORE any credential is sent.
- EOT20 (DGFI-TUM, CC BY 4.0): the open SEANOE archive, ocean tide files only.
"""
import base64
import hashlib
import json
import lzma
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

COOPS = "https://api.tidesandcurrents.noaa.gov"
OM_MARINE = "https://marine-api.open-meteo.com/v1/marine"
AVISO_HOST = os.environ.get("AVISO_SFTP_HOST", "ftp-access.aviso.altimetry.fr")
AVISO_PORT = int(os.environ.get("AVISO_SFTP_PORT", "2221"))
AVISO_DIR = os.environ.get("AVISO_FES_DIR", "/auxiliary/tide_model/fes2022b/ocean_tide_extrapolated")
# AVISO's PUBLIC SSH host keys (ssh-keyscan -p 2221, 2026-11-15 21:48 EST, from a machine off the runner network).
# The job refuses to send credentials unless the server presents one of these. Rotate by editing this set.
AVISO_HOST_KEYS = {
    ("ssh-ed25519", "AAAAC3NzaC1lZDI1NTE5AAAAIOCYlZy1SE8b7Gkd8Lmyp3dc3eiRrhTSgvBbJCKhRvOG"),
    ("ecdsa-sha2-nistp256", "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBNPdJIgZTD27oP/GipftYIMofQ0AjNtY9HzuR1FFJDYmVBC"
                            "JfSrBX3dR6eyg+edSl9SBBMlfj+HoMSzA1ERqFw0="),
}
REMOTE_NAME = re.compile(r"^[a-z0-9]+_fes2022\.nc\.xz$")
EOT20_URL = "https://www.seanoe.org/data/00683/79489/data/85762.zip"
EOT20_MEMBER = re.compile(r"(?:^|/)([0-9A-Z]+)_ocean_eot20\.nc$")
BOX_DEG = 0.5


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-tide-m1-gate"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:                                   # noqa: BLE001 - one station failing must not end the run
        log(f"GET failed {url[:140]}: {e}")
        return {}


def parse_t(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- NOAA CO-OPS
def coops(sid, product, begin, end, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=raw_surf_tide_m1&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum=MSL&units=metric&time_zone=gmt&format=json")
    if interval:
        q += f"&interval={interval}"
    return get_json(q.replace(" ", "%20"))


def coops_series(sid, product, begin, end, interval=None, key="predictions"):
    rows = coops(sid, product, begin, end, interval).get(key, [])
    return {parse_t(r["t"]): float(r["v"]) for r in rows if r.get("v") not in (None, "")}


def coops_hilo(sid, begin, end):
    rows = coops(sid, "predictions", begin, end, "hilo").get("predictions", [])
    return [(parse_t(r["t"]), r.get("type")) for r in rows if r.get("type") in ("H", "L")]


def station_meta(sid):
    m = (get_json(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    return m.get("lat"), m.get("lng"), m.get("name", sid)


def coops_msl_minus_mllw(sid):
    """The station datum sheet's MSL - MLLW (m), or None."""
    d = {x.get("name"): x.get("value") for x in
         get_json(f"{COOPS}/mdapi/prod/webapi/stations/{sid}/datums.json?units=metric").get("datums", [])}
    try:
        return float(d["MSL"]) - float(d["MLLW"])
    except (KeyError, TypeError, ValueError):
        return None


def coops_harcon(sid):
    """[(number, name, amplitude_m, phase_GMT_deg)] - the station's published harmonic constants."""
    rows = get_json(f"{COOPS}/mdapi/prod/webapi/stations/{sid}/harcon.json?units=metric").get("HarmonicConstituents", [])
    return [(r["number"], r["name"], float(r["amplitude"]), float(r["phase_GMT"])) for r in rows
            if r.get("amplitude") not in (None, "") and r.get("phase_GMT") not in (None, "")]


# ---------------------------------------------------------------- Open-Meteo (TEST-ONLY arms C and D)
def om_sea_level(lat, lng, start_date, end_date):
    """Hourly sea_level_height_msl at the served 0.1-degree cell (as #926 measured it). {aware datetime: m}."""
    url = (f"{OM_MARINE}?latitude={round(lat, 1)}&longitude={round(lng, 1)}&hourly=sea_level_height_msl"
           f"&start_date={start_date:%Y-%m-%d}&end_date={end_date:%Y-%m-%d}&timezone=GMT")
    h = get_json(url).get("hourly") or {}
    return {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
            for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}


# ---------------------------------------------------------------- AVISO SFTP: FES2022b
def host_key_ok(kind, b64):
    """PURE: the server's key is one of the pinned AVISO keys."""
    return (kind, b64) in AVISO_HOST_KEYS


def remote_name_ok(name):
    """PURE: a plain FES2022 constituent file name (no path parts), so a listing cannot steer a write elsewhere."""
    return bool(REMOTE_NAME.fullmatch(name)) and Path(name).name == name


def _aviso_sftp():
    """An authenticated SFTP client. The server's host key is checked against the pins BEFORE any credential is sent.
    A large SSH window: the first run moved ~160 KB/s on the default window (17 min per 160 MB file)."""
    import paramiko                                           # offline dependency (workflow installs it)
    user, pw = os.environ.get("AVISO_USERNAME"), os.environ.get("AVISO_PASSWORD")
    if not user or not pw:
        raise SystemExit("AVISO_USERNAME / AVISO_PASSWORD are not set (Actions secrets)")
    t = paramiko.Transport((AVISO_HOST, AVISO_PORT), default_window_size=1 << 27, default_max_packet_size=1 << 15)
    t.start_client(timeout=60)
    key = t.get_remote_server_key()
    if not host_key_ok(key.get_name(), key.get_base64()):
        t.close()                                             # BEFORE any credential is sent
        raise SystemExit(f"AVISO host key not pinned: {key.get_name()} "
                         f"SHA256:{base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')}")
    t.auth_password(user, pw)
    return t, paramiko.SFTPClient.from_transport(t)


def download_fes(names, cache, workers=4):
    """Fetch each constituent's .nc.xz into `cache` unless already there, `workers` connections in parallel.
    Each file lands as .part and is renamed only when complete, so a timed-out run still leaves its finished files
    for the cache step (the workflow saves the cache even when this step fails). Returns {name: path}."""
    from concurrent.futures import ThreadPoolExecutor
    cache.mkdir(parents=True, exist_ok=True)
    have = {n: next(iter(cache.glob(f"{n.lower()}_*.nc.xz")), None) for n in names}
    missing = [n for n, p in have.items() if p is None]
    if not missing:
        return have
    t, sftp = _aviso_sftp()
    listing = sftp.listdir(AVISO_DIR)
    sftp.close()
    t.close()
    jobs = {}
    for n in missing:
        match = [f for f in listing if remote_name_ok(f) and f.startswith(n.lower() + "_")]
        if match:
            jobs[n] = match[0]
        else:
            log(f"{n}: not in {AVISO_DIR}; public listing sample: {sorted(listing)[:40]}")

    def fetch(item):
        n, fname = item
        tt, sf = _aviso_sftp()
        try:
            part = cache / (fname + ".part")
            sf.get(f"{AVISO_DIR}/{fname}", str(part))
            dest = cache / fname
            part.rename(dest)
            log(f"{n}: {dest.stat().st_size / 1e6:.0f} MB")
            return n, dest
        finally:
            sf.close()
            tt.close()

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for n, dest in ex.map(fetch, jobs.items()):
            have[n] = dest
    return {n: p for n, p in have.items() if p is not None}


def subset_fes(xz_path, name, points, out_root, scratch):
    """Decompress one global FES grid, cut a BOX_DEG box around each point, delete the global file."""
    import netCDF4
    import numpy as np
    nc_path = scratch / (name + ".nc")
    with lzma.open(xz_path) as src, open(nc_path, "wb") as dst:
        shutil.copyfileobj(src, dst, 1 << 24)
    with netCDF4.Dataset(nc_path) as ds:
        vn = ds.variables
        lat = vn["lat" if "lat" in vn else "latitude"][:]
        lon = vn["lon" if "lon" in vn else "longitude"][:]
        for sid, (plat, plng) in points.items():
            x = plng % 360.0
            if x - BOX_DEG < lon.min() or x + BOX_DEG > lon.max():
                log(f"{sid}: box crosses the grid seam, skipped")
                continue
            iy = np.where(np.abs(lat - plat) <= BOX_DEG)[0]
            ix = np.where(np.abs(lon - x) <= BOX_DEG)[0]
            out = out_root / sid
            out.mkdir(parents=True, exist_ok=True)
            with netCDF4.Dataset(out / (name + ".nc"), "w") as o:
                o.createDimension("lat", len(iy))
                o.createDimension("lon", len(ix))
                o.createVariable("lat", "f8", ("lat",))[:] = lat[iy]
                o.createVariable("lon", "f8", ("lon",))[:] = lon[ix]
                for var in ("amplitude", "phase"):
                    v = vn[var]
                    w = o.createVariable(var, "f4", ("lat", "lon"), fill_value=np.float32(1.8446744e19))
                    w[:] = v[iy.min():iy.max() + 1, ix.min():ix.max() + 1]
                    if hasattr(v, "units"):
                        w.units = v.units
    nc_path.unlink()


# ---------------------------------------------------------------- SEANOE: EOT20 ocean tides
def eot20_member_ok(member):
    """PURE: an EOT20 ocean-tide constituent file inside the archive (no '..', no absolute path)."""
    p = PurePosixPath(member)                                  # zip names are POSIX on every OS
    return (bool(EOT20_MEMBER.search(member)) and not p.is_absolute() and "\\" not in member and ".." not in p.parts
            and "load" not in member.lower())


def download_eot20(root):
    """Ensure root/EOT20/ocean_tides/<C>_ocean_eot20.nc (the layout pyTMD's database expects). Returns the root."""
    dest = root / "EOT20" / "ocean_tides"
    if len(list(dest.glob("*_ocean_eot20.nc"))) >= 17:
        return root
    dest.mkdir(parents=True, exist_ok=True)
    zpath = root / "eot20.zip"
    req = urllib.request.Request(EOT20_URL, headers={"User-Agent": "raw-surf-tide-m1-gate"})
    with urllib.request.urlopen(req, timeout=600) as r, open(zpath, "wb") as fh:
        shutil.copyfileobj(r, fh, 1 << 24)
    log(f"EOT20 archive {zpath.stat().st_size / 1e9:.2f} GB")
    with zipfile.ZipFile(zpath) as z:
        for m in z.namelist():
            if eot20_member_ok(m):
                with z.open(m) as src, open(dest / Path(m).name, "wb") as dst:   # flat: by file name only
                    shutil.copyfileobj(src, dst, 1 << 24)
    zpath.unlink()
    log(f"EOT20 ocean tides: {sorted(p.name for p in dest.glob('*.nc'))}")
    return root
