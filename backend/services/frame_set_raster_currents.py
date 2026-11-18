"""Ocean surface currents for the raster frames (2026-11-15; the owner approved Currents as a new picker layer).

SOURCE. Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024, dataset cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i (Mercator
Ocean's 1/12-degree global ocean model): INSTANTANEOUS eastward / northward sea-water velocity `uo` / `vo` at the top level
(elevation index 49, -0.494 m), every 6 h (00/06/12/18Z) to about 10 days ahead, updated once a day near 06 UTC. Read as the
service's own ARCO Zarr ("timeChunked": chunks [1 time, 1 level, 512 lat, 2048 lon], float32, blosc-lz4) over HTTPS: one
time step of uo + vo = 24 chunk GETs, ~42 MB (measured 2026-11-15: 3.4 s at 16 connections). Land is the fill value
9.97e36 (masked here). Licence: Copernicus Marine Service licence (free, commercial use allowed, attribution required); the
project's registered Copernicus Marine account (COPERNICUSMARINE_SERVICE_* in the ingest) is the licensee. The bucket did not
ask for credentials when measured; if it ever does, the publish fails visibly (continue-on-error) and the set stays.

REGRID. The 0.25-degree lattice's nodes fall exactly on every third source row and column (lat -80 + j/12, lon -180 + k/12),
so each node takes the mean of the 3 x 3 source cells centred on it (u and v separately: a vector mean), over the ocean
cells only. A node with no ocean cell is no data; south of 80S (no source rows) is no data. No interpolation in time.

FRAME. Two fields, the WIND frame layout (frame_binary field 4 speed + field 1 direction): speed in KNOTS (0.01 kn) and the
direction the water flows TOWARD (0.01 deg), with uv_convention 1 (u = +s sin d, v = +s cos d), so staticFrameCodec's
buildWindVectors already rebuilds u, v for a particle engine. The raster draws the speed field.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ARCO = ("https://s3.waw3-1.cloudferro.com/mdl-arco-time-009/arco/GLOBAL_ANALYSISFORECAST_PHY_001_024/"
        "cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406/timeChunked.zarr")
SURFACE = 49                                   # elevation index of the top level (-0.494 m), checked against the store
SURFACE_M = -0.494
EPOCH = datetime(1950, 1, 1, tzinfo=timezone.utc)
SRC_ROWS, SRC_COLS = 2041, 4320                # lat -80..90, lon -180..179.9167, every 1/12 deg
LAND = 1e30                                    # the fill value is 9.969e36; anything above this is land
KN_PER_MS = 3600.0 / 1852.0
CHUNK_FETCHERS = 4                             # chunk GETs per hour in flight (build_set already runs 6 hours at once)


def regrid_quarter(a):
    """(721, 1440) lattice (row 0 = 90S, column 0 = 180W) from a (2041, 4320) source field (row 0 = 80S, column 0 = 180W):
    the mean of the 3 x 3 source cells centred on each node, NaN ignored (land); NaN where none is finite or south of 80S."""
    import numpy as np
    a = np.asarray(a, dtype=float)
    if a.shape != (SRC_ROWS, SRC_COLS):
        raise ValueError(f"expected the 1/12-deg source grid {(SRC_ROWS, SRC_COLS)}, got {a.shape}")
    pad = np.full((SRC_ROWS + 2, SRC_COLS), np.nan)
    pad[1:-1] = a
    rows = 3 * np.arange(40, 721) - 120 + 1          # padded row of each lattice row 40..720 (80S..90N)
    cols = 3 * np.arange(1440)
    total = np.zeros((rows.size, cols.size))
    count = np.zeros((rows.size, cols.size))
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            blk = pad[rows + dr][:, (cols + dc) % SRC_COLS]
            ok = np.isfinite(blk)
            total += np.where(ok, blk, 0.0)
            count += ok
    out = np.full((721, 1440), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        out[40:] = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    return out


def speed_direction(u, v):
    """(speed kn, direction TOWARD deg 0..360) from eastward / northward m/s; NaN stays NaN."""
    import numpy as np
    spd = np.hypot(u, v) * KN_PER_MS
    to = np.degrees(np.arctan2(u, v)) % 360.0
    return spd, np.where(np.round(to, 2) >= 360.0, 0.0, to)


class CmemsCurrentsSource:
    """One CMEMS surface-current time step per frame, read from the ARCO Zarr by chunk (module docstring)."""

    def __init__(self, spec, session=None):
        self.spec = spec
        if session is None:
            try:
                from services._fetch_common import http_session
            except ImportError:  # pragma: no cover
                from _fetch_common import http_session
            session = http_session()
        self.http = session
        self._meta = {}
        self._times = None

    def _zarray(self, name):
        if name not in self._meta:
            r = self.http.get(f"{ARCO}/{name}/.zarray", timeout=60)
            r.raise_for_status()
            self._meta[name] = r.json()
        return self._meta[name]

    def _chunk(self, name, key):
        """One chunk decoded to a flat float array (land fill kept), or None for a chunk the store never wrote."""
        import numpy as np
        from numcodecs import get_codec
        meta = self._zarray(name)
        r = self.http.get(f"{ARCO}/{name}/{key}", timeout=120)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        raw = get_codec(meta["compressor"]).decode(r.content)
        return np.frombuffer(raw, dtype=np.dtype(meta["dtype"])).astype(float)

    def _coord(self, name):
        import numpy as np
        meta = self._zarray(name)
        n, c = meta["shape"][0], meta["chunks"][0]
        parts = [self._chunk(name, str(i)) for i in range((n + c - 1) // c)]
        return np.concatenate(parts)[:n]

    def times(self):
        """Every step of the store as aware datetimes (the store's own 'hours since 1950-01-01')."""
        if self._times is None:
            hrs = self._coord("time")
            self._times = {EPOCH + timedelta(hours=float(h)): i for i, h in enumerate(hrs) if h == h}
        return self._times

    def check_surface(self):
        import numpy as np
        el = self._coord("elevation")
        if not np.isclose(el[SURFACE], SURFACE_M, atol=0.01):
            raise RuntimeError(f"elevation[{SURFACE}] = {el[SURFACE]}, not the top level {SURFACE_M} m")

    def complete_cycle(self, now):
        """The newest 00Z day whose whole 0-240 h span is in the store (the day's bulletin), or None."""
        try:
            times = self.times()
            self.check_surface()
        except Exception:
            return None
        hours = self.spec["hours"]
        day = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        for back in range(4):
            cyc = day - timedelta(days=back)
            if cyc + timedelta(hours=hours[0]) in times and cyc + timedelta(hours=hours[-1]) in times:
                return cyc
        return None

    def url(self, cycle, f):
        t = self.times().get(cycle + timedelta(hours=f))
        return f"{ARCO}/{{uo,vo}}/{t}.{SURFACE}.*.*"

    def _field(self, name, t):
        import numpy as np
        meta = self._zarray(name)
        cy, cx = meta["chunks"][2], meta["chunks"][3]
        ny, nx = (SRC_ROWS + cy - 1) // cy, (SRC_COLS + cx - 1) // cx
        keys = [(y, x) for y in range(ny) for x in range(nx)]
        with ThreadPoolExecutor(max_workers=CHUNK_FETCHERS) as pool:
            got = list(pool.map(lambda yx: self._chunk(name, f"{t}.{SURFACE}.{yx[0]}.{yx[1]}"), keys))
        out = np.full((ny * cy, nx * cx), np.nan)
        for (y, x), flat in zip(keys, got):
            if flat is None:
                raise RuntimeError(f"{name} chunk {t}.{SURFACE}.{y}.{x} missing")
            out[y * cy:(y + 1) * cy, x * cx:(x + 1) * cx] = flat.reshape(cy, cx)
        out = out[:SRC_ROWS, :SRC_COLS]
        out[~(np.abs(out) < LAND)] = np.nan
        return out

    def fetch(self, cycle, f):
        """{field id: (721, 1440) plane on the 0.25-degree lattice}: speed (kn) and direction toward (deg)."""
        from services import frame_binary as fb
        t = self.times().get(cycle + timedelta(hours=f))
        if t is None:
            raise RuntimeError(f"no store step at {cycle + timedelta(hours=f)}")
        u, v = regrid_quarter(self._field("uo", t)), regrid_quarter(self._field("vo", t))
        spd, to = speed_direction(u, v)
        return {fb.SPEED: spd, fb.DIRECTION: to}
