"""Copernicus surface currents at their NATIVE 1/12 degree on the surf coasts (2026-11-22; DARK, the director's assignment from
the research lead's Q3 note, docs/weather-program/research/q3-surface-current-source-skill-2026-11-22.md, red flag 1).

WHY. The world currents set (frame_set_raster_currents) takes a 3 x 3 vector mean of Copernicus GLO-PHY onto 0.25 degree. That
throws away the 1/12-degree resolution, which is where the model's coastal detail lives and where surfers look. These sets keep
every source cell on the surf boxes. Nothing here claims skill: a finer grid is a finer grid of the SAME model, and whether it
verifies better near the coast is the Q3 pre-registered check's question (its "GLO-PHY at native 1/12 deg" arm).

FIELD. The same field as the world set: plain `uo` / `vo` at -0.494 m, instantaneous, every 6 h to 240 h (SMOC's merged
`utotal` is worse on shelf seas, Q3 table 6). Not regridded: each node IS a source cell (lat -80 + j/12, lon -180 + k/12).

BOXES. One set per marine pilot box (pilot_regions: REGIONAL_CONFIGS + WORLDWIDE_COASTAL_REGIONS), snapped inward to the source
lattice: key CMEMS/marine/currents/<box>_0p083, 41 frames a run. Box frames are small, so they are plain frames (no bundle).

FRAME. The world set's one-byte layout (frame_binary field 13, the 0.1 kn speed band) plus the flow direction byte (field 14)
at EVERY cell, not one per 2 x 2 block: spec `dir_stride` 1, stated in the index (grid.flow_dir_stride) for the client
(currentNative.js), which advects the Currents particles on it when the whole view sits inside one box.

SIZE PER RUN (measured 2026-11-22 from the real 2026-11-22 00Z bulletin, +24 h, 14 boxes, 224,710 cells): 172 kB a frame
hour for all boxes, 7.0 MB a run (41 frames x 14 sets = 574 objects). The read: only the store chunks the boxes touch (the
step prints the bytes pulled). Variants measured on the same hour, all boxes, per run: band + one-byte direction per cell
7.0 MB (this); band + direction per 2 x 2 block 5.3 MB; band + two-byte direction 13.9 MB; speed + direction two-byte 14.8 MB.

ONE READ, EVERY BOX. _SharedRead fetches an hour once (the first box set that asks) and keeps the boxes' slices only (float32);
each box set then runs frame_set_raster.publish unchanged (its coverage floor, parity, index, latest.json and retention).
DARK: off unless the repo variable FRAME_RASTER_CURRENTS_NATIVE = '1'. Client: off unless window.__RAW_CURRENTS_NATIVE__.
"""
from __future__ import annotations

import math
import threading
from datetime import timedelta

try:
    from frame_set_raster_currents import CmemsCurrentsSource, SRC_COLS, SRC_ROWS, speed_direction
except ImportError:  # services is a package when imported, a directory when run as a script
    from services.frame_set_raster_currents import CmemsCurrentsSource, SRC_COLS, SRC_ROWS, speed_direction

STEP = 1.0 / 12.0
LAT0, LON0 = -80.0, -180.0
SUFFIX = "_0p083"
BUNDLE = "currents_native"
ENV = "FRAME_RASTER_CURRENTS_NATIVE"
SOURCE_KIND = "cmems_currents_native"
HOURS = tuple(range(0, 241, 6))
CREDIT = "Generated using E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00016"
LICENSE = ("Copernicus Marine Service licence: free, any purpose incl. commercial, attribution required "
           "(https://marine.copernicus.eu/user-corner/service-commitments-and-licence)")
SOURCE_URL = "https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_PHY_001_024"


def _boxes():
    try:
        from services.weather_pipeline import pilot_regions as pr
    except ImportError:  # pragma: no cover - run by path
        from weather_pipeline import pilot_regions as pr
    return {**pr.REGIONAL_CONFIGS, **pr.WORLDWIDE_COASTAL_REGIONS}


def box_window(b):
    """(row0, row1, col0, col1) inclusive source indices of a box snapped INWARD to the 1/12-degree lattice, and its grid."""
    j0 = math.ceil((b["south"] - LAT0) / STEP - 1e-9)
    j1 = math.floor((b["north"] - LAT0) / STEP + 1e-9)
    k0 = math.ceil((b["west"] - LON0) / STEP - 1e-9)
    k1 = math.floor((b["east"] - LON0) / STEP + 1e-9)
    if not (0 <= j0 < j1 < SRC_ROWS and 0 <= k0 < k1 < SRC_COLS):
        raise ValueError(f"box {b} is not inside the 1/12-degree source grid")
    grid = {"cols": k1 - k0 + 1, "rows": j1 - j0 + 1, "stride": 1,
            "bounds": (round(LON0 + k0 * STEP, 6), round(LAT0 + j0 * STEP, 6), round(LON0 + k1 * STEP, 6), round(LAT0 + j1 * STEP, 6))}
    return (j0, j1, k0, k1), grid


def set_name(box):
    return f"{BUNDLE}_{box}"


def box_of(name):
    return name[len(BUNDLE) + 1:]


def names():
    return [set_name(b) for b in _boxes()]


def register(specs, grids, sources):
    """One spec + lattice per box into frame_set_raster's tables; the source kind into its source map. The frame layout, credit
    and licence follow the world set's (SPECS['currents']); by path (no world spec loaded) the layout comes from frame_binary."""
    try:
        import frame_binary as fb
    except ImportError:
        from services import frame_binary as fb
    base = specs.get("currents") or {
        "field": fb.SPEED, "fields": (fb.SPEED, fb.DIRECTION), "band_field": fb.CURRENT_KN_BAND, "uv_convention": 1,
        "dir_byte_field": fb.FLOW_DIR_BYTE, "idx": ("uo", "vo"), "frame_plane": True, "convert": lambda a: a,
        "valid": (0.0, 20.0), "clip": None, "value_kind": "sea_surface_current", "value_unit": "kn",
        "upstream_provider": "copernicus_marine"}
    for box, b in _boxes().items():
        _win, grid = box_window(b)
        gkey = f"0p083_{box}"
        grids.setdefault(gkey, grid)
        specs.setdefault(set_name(box), dict(
            base, target={"model": "CMEMS", "domain": "marine", "layer": "currents", "region_id": box + SUFFIX},
            grid=gkey, dir_stride=1, env=ENV, default_on=False, bundle=BUNDLE, source=SOURCE_KIND, box=box, hours=HOURS,
            credit=CREDIT, license=LICENSE, source_url=SOURCE_URL,
            source_dataset="Copernicus Marine GLOBAL_ANALYSISFORECAST_PHY_001_024 cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i "
                           f"uo/vo at -0.494 m (instantaneous), every source cell on the {box} box (native 1/12 deg, no regrid); "
                           "speed kn + direction toward (one byte per cell)"))
    sources.setdefault(SOURCE_KIND, NativeCurrentsSource)


class _SharedRead(CmemsCurrentsSource):
    """The CMEMS store read ONCE per hour for every box: only the chunks the boxes touch, the boxes' slices kept (float32)."""

    def __init__(self, spec, session=None):
        super().__init__(spec, session)
        self.windows = {box: box_window(b)[0] for box, b in _boxes().items()}
        self.bytes_pulled = 0
        self._hours = {}
        self._locks = {}
        self._guard = threading.Lock()
        self._cycle = None

    def complete_cycle(self, now):
        if self._cycle is None:
            self._cycle = super().complete_cycle(now)
        return self._cycle

    def _keys(self, name):
        meta = self._zarray(name)
        cy, cx = meta["chunks"][2], meta["chunks"][3]
        need = set()
        for j0, j1, k0, k1 in self.windows.values():
            need |= {(y, x) for y in range(j0 // cy, j1 // cy + 1) for x in range(k0 // cx, k1 // cx + 1)}
        return sorted(need), cy, cx

    def _chunk(self, name, key):
        import numpy as np
        from numcodecs import get_codec
        meta = self._zarray(name)
        r = self.http.get(f"{self.ARCO}/{name}/{key}", timeout=120)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        with self._guard:
            self.bytes_pulled += len(r.content)
        return np.frombuffer(get_codec(meta["compressor"]).decode(r.content), dtype=np.dtype(meta["dtype"])).astype(float)

    def _field(self, name, t):
        """The full (2041, 4320) source plane with only the boxes' chunks read (NaN elsewhere; land NaN)."""
        import numpy as np
        from concurrent.futures import ThreadPoolExecutor
        keys, cy, cx = self._keys(name)
        with ThreadPoolExecutor(max_workers=4) as pool:
            got = list(pool.map(lambda yx: self._chunk(name, f"{t}.{self.SURFACE}.{yx[0]}.{yx[1]}"), keys))
        out = np.full((SRC_ROWS, SRC_COLS), np.nan)
        for (y, x), flat in zip(keys, got):
            if flat is None:
                raise RuntimeError(f"{name} chunk {t}.{self.SURFACE}.{y}.{x} missing")
            blk = flat.reshape(cy, cx)[:max(0, min(cy, SRC_ROWS - y * cy)), :max(0, min(cx, SRC_COLS - x * cx))]
            out[y * cy:y * cy + blk.shape[0], x * cx:x * cx + blk.shape[1]] = blk
        out[~(np.abs(out) < 1e30)] = np.nan
        return out

    def hour(self, cycle, f):
        """{box: (speed kn, direction toward deg)} float32 planes for one hour, read once however many box sets ask."""
        import numpy as np
        k = (cycle, f)
        with self._guard:
            lock = self._locks.setdefault(k, threading.Lock())
        with lock:
            if k not in self._hours:
                t = self.times().get(cycle + timedelta(hours=f))
                if t is None:
                    raise RuntimeError(f"no store step at {cycle + timedelta(hours=f)}")
                u, v = self._field("uo", t), self._field("vo", t)
                out = {}
                for box, (j0, j1, k0, k1) in self.windows.items():
                    s, d = speed_direction(u[j0:j1 + 1, k0:k1 + 1], v[j0:j1 + 1, k0:k1 + 1])
                    out[box] = (s.astype(np.float32), d.astype(np.float32))
                self._hours[k] = out
            return self._hours[k]


class NativeCurrentsSource:
    """One box's view of the shared read: what frame_set_raster.publish / build_set call (complete_cycle, url, fetch)."""

    def __init__(self, spec, session=None, shared=None):
        self.spec = spec
        self.box = spec["box"]
        self.shared = shared or _SharedRead(spec, session)

    def complete_cycle(self, now):
        return self.shared.complete_cycle(now)

    def url(self, cycle, f):
        t = self.shared.times().get(cycle + timedelta(hours=f))
        return f"{self.shared.ARCO}/{{uo,vo}}/{t}.{self.shared.SURFACE}.*.* [{self.box}]"

    def fetch(self, cycle, f):
        import numpy as np
        try:
            from services import frame_binary as fb
        except ImportError:  # pragma: no cover
            import frame_binary as fb
        s, d = self.shared.hour(cycle, f)[self.box]
        return {fb.SPEED: np.asarray(s, dtype=float), fb.DIRECTION: np.asarray(d, dtype=float)}


def publish_all(sink, uploader, names_on, log=print, shared=None, now=None):
    """Publish every switched-on box set from ONE read per hour. {set name: frame_set_raster.publish report}."""
    try:
        from services import frame_set_raster as fsr
    except ImportError:  # pragma: no cover
        import frame_set_raster as fsr
    shared = shared or _SharedRead(fsr.spec_for(names_on[0]))
    reports = {}
    for n in names_on:
        reports[n] = fsr.publish(NativeCurrentsSource(fsr.spec_for(n), shared=shared), sink, uploader, log=log, now=now,
                                 spec=fsr.spec_for(n))
        log(f"[currents-native] {n}: {reports[n].get('status')} {reports[n].get('built')} frames {reports[n].get('bytes')} B")
    shared._hours.clear()
    return reports, shared.bytes_pulled
