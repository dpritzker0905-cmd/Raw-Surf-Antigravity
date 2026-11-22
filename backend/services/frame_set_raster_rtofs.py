"""NOAA Global RTOFS surface currents for the raster frames (2026-11-22): the Currents layer's GFS picker reads NOAA's own ocean
model instead of Copernicus (the set `currents`, which EURO and ICON keep). Publishes DARK (FRAME_RASTER_CURRENTS_RTOFS=1 turns it
on); the client reads it only behind its own lever (ownRasterFrames.js, RTOFS_CURRENTS).

SOURCE. NCEP Global RTOFS (HYCOM, 1/12 degree, 41 hybrid layers; one 00Z cycle a day, files written ~13 UTC), the 2-D surface
"prog" files `rtofs.YYYYMMDD/rtofs_glo_2ds_fHHH_prog.nc` on NOMADS: `u_velocity` / `v_velocity` (standard names
eastward_ / northward_sea_water_velocity, m/s) of LAYER 1, the top model layer, on the native 4500 x 3298 grid with 2-D
`Latitude` / `Longitude`. Hourly f000-f072, then 3-hourly to f192; f000 is the cycle's nowcast. Checked against the live
servers 2026-11-22: the AWS mirror (noaa-nws-rtofs-pds) carries only the `_diag` files, whose velocities are BAROTROPIC (the
depth mean, not the surface), so the source is NOMADS. One frame reads ~75 MB of the ~155 MB file by HTTP range (HDF5 chunks
of u and v plus the metadata, measured), the grid once a run. NOAA data: public domain.

NOMADS politeness: it blocks an address that sends too many requests a minute, so this source holds at most MAX_INFLIGHT
files open at once and spaces every request, HEADs included, by MIN_GAP_S = 0.6 s: at most 100 a minute, under NOMADS'
~120 (the advisor's gate, 2026-11-22; runner addresses are shared). 8 MB ranges: about 11 requests a frame.

REGRID. Every ocean source cell goes to its nearest node of the 0.25-degree lattice (row 0 = 90S, column 0 = 180W), and the node
takes the mean of u and of v over its cells (a vector mean, as the Copernicus set's 3 x 3 mean). The 1/12-degree source puts
about 9 cells on each node at the equator and more poleward, so every ocean node is filled; a node with no ocean cell is no data.
Land and fill (1.27e30) are excluded. No interpolation in time.

FRAME. The `currents` layout: speed in KNOTS + the direction the water flows TOWARD, uv_convention 1, band field for one byte.
"""
from __future__ import annotations

import io
import threading
import time
from datetime import datetime, timedelta, timezone

try:
    from services import frame_binary as fb
    from services.frame_set_raster_currents import speed_direction
except ImportError:  # pragma: no cover - run by path (fetcher subprocess)
    import frame_binary as fb
    from frame_set_raster_currents import speed_direction

BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod"
MT_EPOCH = datetime(1900, 12, 31, tzinfo=timezone.utc)          # `MT`: days since 1900-12-31 00:00
FILL = 1e29                                                      # the fill value is 1.2676506e30; anything above this is land
MAX_MS = 10.0                                                    # no surface current is 10 m/s; above that is a bad cell
ROWS, COLS = 721, 1440
BLOCK = 8 << 20                                                  # one range request reads 8 MB
MAX_INFLIGHT = 2                                                 # files read at once (build_set runs 6 hours in parallel)
MIN_GAP_S = 0.6                                                  # at most 100 requests a minute, HEADs included, all threads
#                                                                  (NOMADS blocks above ~120 a minute and runner addresses are shared)
LAST_HOUR = 192

SPEC = {
    "target": {"model": "RTOFS", "domain": "marine", "layer": "currents", "region_id": "global_0p25"},
    "field": fb.SPEED, "fields": (fb.SPEED, fb.DIRECTION), "band_field": fb.CURRENT_KN_BAND, "uv_convention": 1,
    "idx": ("u_velocity", "v_velocity"), "grid": "0p25",
    "frame_plane": True, "convert": lambda a: a, "valid": (0.0, 20.0), "clip": None,
    "env": "FRAME_RASTER_CURRENTS_RTOFS", "default_on": False,
    "value_kind": "sea_surface_current", "value_unit": "kn",
    "source_dataset": "NCEP Global RTOFS (HYCOM 1/12 deg) rtofs_glo_2ds_fHHH_prog.nc u_velocity/v_velocity, layer 1 (top layer), "
                      "00Z cycle; nearest-node vector mean onto 0.25 deg; speed kn + direction toward",
    "hours": tuple(range(0, LAST_HOUR + 1, 6)), "source": "rtofs_currents", "upstream_provider": "noaa",
    "credit": "NOAA NCEP Global RTOFS; modified (top-layer currents, mean onto 0.25 deg, knots)",
    "license": "NOAA data: public domain, no restrictions on use; attribution requested; no NOAA endorsement implied",
    "source_url": "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/",
}


def register(specs, grids):
    """Add the set to frame_set_raster's table (kept here: that module is at its line limit). It uses the 0.25-deg lattice."""
    specs.setdefault("currents_rtofs", SPEC)


def node_index(lat, lon):
    """Flat index (row * 1440 + column) of the nearest 0.25-degree node for each source cell; -1 where lat/lon is not finite."""
    import numpy as np
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    ok = np.isfinite(lat) & np.isfinite(lon) & (np.abs(lat) <= 90.0)
    r = np.rint((np.where(ok, lat, 0.0) + 90.0) * 4.0).astype(np.int64)
    c = np.rint(((np.where(ok, lon, 0.0) + 180.0) % 360.0) * 4.0).astype(np.int64) % COLS
    return np.where(ok, np.clip(r, 0, ROWS - 1) * COLS + c, -1)


def bin_mean(idx, u, v):
    """(u, v) planes (721, 1440): the mean of each node's ocean cells; NaN where it has none. Land = fill, NaN or |u|,|v| > 10."""
    import numpy as np
    u = np.asarray(u, dtype=float).ravel()
    v = np.asarray(v, dtype=float).ravel()
    i = np.asarray(idx).ravel()
    ok = (i >= 0) & np.isfinite(u) & np.isfinite(v) & (np.abs(u) < MAX_MS) & (np.abs(v) < MAX_MS)
    n = np.bincount(i[ok], minlength=ROWS * COLS).astype(float)
    su = np.bincount(i[ok], weights=u[ok], minlength=ROWS * COLS)
    sv = np.bincount(i[ok], weights=v[ok], minlength=ROWS * COLS)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = np.where(n > 0, su / np.maximum(n, 1), np.nan)
        mv = np.where(n > 0, sv / np.maximum(n, 1), np.nan)
    return mu.reshape(ROWS, COLS), mv.reshape(ROWS, COLS)


class _Pacer:
    """At most one request every `gap` seconds across every thread of the run."""

    def __init__(self, gap):
        self.gap, self.lock, self.next = gap, threading.Lock(), 0.0

    def wait(self):
        if self.gap <= 0:
            return
        with self.lock:
            now = time.monotonic()
            delay = self.next - now
            self.next = max(now, self.next) + self.gap
        if delay > 0:
            time.sleep(delay)


class RangeFile(io.RawIOBase):
    """A read-only file over HTTP range requests with a block cache, for h5py. Counts requests and bytes."""

    def __init__(self, http, url, pacer=None, block=BLOCK):
        super().__init__()
        self.http, self.url, self.pacer, self.block = http, url, pacer, block
        self.pos, self.cache, self.bytes, self.requests = 0, {}, 0, 0
        r = self._get(None)
        if r.status_code == 206:
            self.size = int(r.headers["Content-Range"].rsplit("/", 1)[1])
        else:                                          # no range support: the whole file came back, one block
            self.size = self.block = max(1, len(r.content))
        self.cache[0] = r.content

    def _get(self, b):
        lo = 0 if b is None else b * self.block
        hi = lo + self.block - 1 if b is None else min(self.size, lo + self.block) - 1
        if self.pacer:
            self.pacer.wait()
        r = self.http.get(self.url, headers={"Range": f"bytes={lo}-{hi}"}, timeout=120)
        r.raise_for_status()
        if r.status_code != 206 and b is not None:
            raise RuntimeError(f"{self.url}: range request answered {r.status_code}, not 206")
        self.bytes += len(r.content)
        self.requests += 1
        return r

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def readinto(self, buf):
        want = max(0, min(len(buf), self.size - self.pos))
        out, p = bytearray(), self.pos
        while len(out) < want:
            b = p // self.block
            if b not in self.cache:
                self.cache[b] = self._get(b).content
            blk = self.cache[b]
            take = blk[p - b * self.block:p - b * self.block + want - len(out)]
            if not take:
                break
            out += take
            p += len(take)
        buf[:len(out)] = out
        self.pos = p
        return len(out)


class RtofsCurrentsSource:
    """One RTOFS surface-current hour per frame, read by range from NOMADS (module docstring)."""

    BASE, MAX_INFLIGHT, MIN_GAP_S = BASE, MAX_INFLIGHT, MIN_GAP_S

    def __init__(self, spec, session=None):
        self.spec = spec
        if session is None:
            try:
                from services._fetch_common import http_session
            except ImportError:  # pragma: no cover
                from _fetch_common import http_session
            session = http_session()
        self.http = session
        self.pacer = _Pacer(self.MIN_GAP_S)
        self.slots = threading.Semaphore(self.MAX_INFLIGHT)
        self.lock = threading.Lock()
        self.idx = None
        self.bytes = self.requests = 0

    def url(self, cycle, f):
        return f"{self.BASE}/rtofs.{cycle:%Y%m%d}/rtofs_glo_2ds_f{f:03d}_prog.nc"

    def _exists(self, url):
        try:
            self.pacer.wait()
            r = self.http.head(url, timeout=30)
            return r.status_code == 200
        except Exception:
            return False

    def complete_cycle(self, now):
        """The newest 00Z cycle whose first and last hours are both on NOMADS (it keeps two days), or None."""
        hours = self.spec["hours"]
        day = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        for back in range(2):
            cyc = day - timedelta(days=back)
            if self._exists(self.url(cyc, hours[-1])) and self._exists(self.url(cyc, hours[0])):
                return cyc
        return None

    def _read(self, url, names, grid=False):
        import h5py
        import numpy as np
        rf = RangeFile(self.http, url, self.pacer)
        try:
            with h5py.File(io.BufferedReader(rf, buffer_size=1 << 16), "r") as h:
                mt = float(np.asarray(h["MT"][...]).ravel()[0])
                out = {n: np.asarray(h[n][...], dtype=np.float32).reshape(h[n].shape[-2:]) for n in names}
                if grid:
                    out["Latitude"] = np.asarray(h["Latitude"][...], dtype=np.float64)
                    out["Longitude"] = np.asarray(h["Longitude"][...], dtype=np.float64)
        finally:
            with self.lock:
                self.bytes += rf.bytes
                self.requests += rf.requests
        return MT_EPOCH + timedelta(days=mt), out

    def fetch(self, cycle, f):
        """{field id: (721, 1440) plane}: speed (kn) and direction toward (deg). Refuses a file whose own time is not cycle + f."""
        import numpy as np
        url = self.url(cycle, f)
        with self.slots:
            with self.lock:
                need_grid = self.idx is None
            valid, got = self._read(url, ("u_velocity", "v_velocity"), grid=need_grid)
        want = cycle + timedelta(hours=f)
        if abs((valid - want).total_seconds()) > 60:
            raise RuntimeError(f"{url}: file time {valid:%Y-%m-%dT%H:%MZ}, not {want:%Y-%m-%dT%H:%MZ}")
        if need_grid:
            idx = node_index(got["Latitude"], got["Longitude"])
            with self.lock:
                if self.idx is None:
                    self.idx = idx
        u, v = got["u_velocity"].astype(float), got["v_velocity"].astype(float)
        if u.shape != np.shape(self.idx):
            raise RuntimeError(f"{url}: u/v {u.shape} is not the grid {np.shape(self.idx)}")
        mu, mv = bin_mean(self.idx, u, v)
        spd, to = speed_direction(mu, mv)
        return {fb.SPEED: spd, fb.DIRECTION: to}
