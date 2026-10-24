"""Raster frame sources beyond NOAA GFS (2026-10-23, per-model pressure; the owner, 20:13 EDT: "Yes start it", answering
"start the per-model pressure route?" after "We want each models pressure showing").

Each source answers the three calls frame_set_raster.build_set / publish make, exactly as GfsGribSource does:
  complete_cycle(now) -> the newest cycle whose first and last hour are published, or None;
  url(cycle, f)       -> the file the hour comes from (it rides in the index entry);
  fetch(cycle, f)     -> a (721, 1440) array in the frame's unit, GRIB order: row 0 = 90N, column 0 = 0E.
Anything wrong (a missing message, a wrong-length range, an unexpected grid) RAISES: that hour is listed unbuilt and the
.idx/.index never decides a value silently.

EURO: ECMWF IFS open data (https://www.ecmwf.int/en/forecasts/datasets/open-data, CC BY 4.0, attribution required), the
SAME stream services/ecmwf_opendata_fetcher.py reads for the box (oper fc, 0p25), by the file's JSON `.index` byte range: one
msl message per step (~0.53 MB). Its grid starts at 180W (longitudeOfFirstGridPoint 180), so the columns are rotated to
GFS order (0E first) before frame_set_raster.to_frame_plane takes every second point.

ICON: DWD open data (https://opendata.dwd.de/weather/nwp/icon/grib, "Deutscher Wetterdienst" attribution), the same files the
box's dwd_icon_pressure_fetcher reads, regridded from the icosahedral cells to the lattice by a box mean (below).
"""
from __future__ import annotations

import json
from datetime import timedelta

try:
    from services import frame_set_raster as fsr
except ImportError:  # pragma: no cover
    import frame_set_raster as fsr

ECMWF_BASE = "https://data.ecmwf.int/forecasts"


def _http(session):
    if session is not None:
        return session
    try:
        from services._fetch_common import http_session
    except ImportError:  # pragma: no cover
        from _fetch_common import http_session
    return http_session()


def index_entry(text, param, levtype="sfc"):
    """(offset, length) of the deterministic forecast message for `param` in an ECMWF open-data `.index` (JSON lines), or None."""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("param") == param and e.get("levtype") == levtype and e.get("type") == "fc":
            return int(e["_offset"]), int(e["_length"])
    return None


def to_gfs_order(a, lon0):
    """A (721, 1440) 0.25-deg field whose column 0 sits at `lon0` -> column 0 at 0E (GFS order)."""
    import numpy as np
    a = np.asarray(a, dtype=float)
    if a.shape != (721, 1440):
        raise ValueError(f"expected a 0.25-deg world grid (721, 1440), got {a.shape}")
    shift = int(round(((lon0 % 360.0) / 0.25))) % 1440      # 180W -> 720 columns
    return np.concatenate([a[:, (1440 - shift) % 1440:], a[:, :(1440 - shift) % 1440]], axis=1) if shift else a


class EcmwfOpenDataSource:
    """One ECMWF IFS open-data surface field per step (param = spec['idx'][0], levtype = spec['idx'][1])."""

    def __init__(self, spec, session=None):
        self.spec = spec
        self.http = _http(session)

    def _stem(self, cycle, f):
        d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
        return f"{ECMWF_BASE}/{d}/{hh}z/ifs/0p25/oper/{d}{hh}0000-{f}h-oper-fc"

    def url(self, cycle, f):
        return self._stem(cycle, f) + ".grib2"

    def complete_cycle(self, now):
        """The newest 00Z/12Z cycle whose first and last steps' .index both exist (06/18Z runs stop at 144 h), or None."""
        hours = self.spec["hours"]
        floor12 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 12) * 12)
        for back in range(5):
            cyc = floor12 - timedelta(hours=12 * back)
            try:
                if all(self.http.head(self._stem(cyc, f) + ".index", timeout=60).status_code == 200 for f in (hours[0], hours[-1])):
                    return cyc
            except Exception:
                continue
        return None

    def fetch(self, cycle, f):
        import numpy as np
        import pygrib
        from services.noaa_gfs_pressure_fetcher import _fetch_message_bytes
        param, levtype = self.spec["idx"]
        ent = index_entry(self.http.get(self._stem(cycle, f) + ".index", timeout=60).text, param, levtype)
        if ent is None:
            raise RuntimeError(f"index has no {param}/{levtype} fc message")
        off, length = ent
        data = _fetch_message_bytes(self.http, self.url(cycle, f), off, off + length - 1)
        with fsr.DECODE_LOCK:
            msg = pygrib.fromstring(data)
            lat0, lon0 = msg["latitudeOfFirstGridPointInDegrees"], msg["longitudeOfFirstGridPointInDegrees"]
            step = msg["stepRange"] if "stepRange" in msg.keys() else None
            values = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan)
        if round(lat0, 3) != 90.0:
            raise RuntimeError(f"unexpected grid origin {lat0}, {lon0}")
        if step is not None and str(step) != str(f):
            raise RuntimeError(f"message step {step} != asked {f}")
        return self.spec["convert"](to_gfs_order(values, lon0))


# ── ICON: DWD open data, icosahedral -> the 0.5-degree lattice ──────────────────────────────────────────────────────────
# ICON global (R3B7, 2,949,120 cells, ~13 km) carries no lat/lon in its data GRIB: the time-invariant CLAT/CLON of the same
# run give each cell's centre. REGRID (the lead: "regrid once at publish with precomputed weights"): every native cell is
# assigned ONCE to the 0.5-degree box centred on the lattice node it rounds to (box_assignment), and each node takes the cell
# NEAREST its centre among its box's (~15-20 at the equator; nearest_pick: one lexsort by node and 3D dot product). A point
# sample, as GFS's and EURO's every-second-point frames are and as the box's own dwd_icon_pressure_fetcher is (static-frames'
# review of #534: a box MEAN flattened terrain-reduced highs by up to 2.76 hPa against the nearest cell, 1.16 on average over
# the 10 highest nodes, f048 2026-10-24 00Z; deep lows agreed within 0.11). Boxes near the poles hold no cell: those nodes take
# the periodic linear interpolation along their row; each pole row is one point (the cell nearest the pole). box_mean stays for
# comparison only.
DWD_BASE = "https://opendata.dwd.de/weather/nwp/icon/grib"
ICON_SINGLE = "icon_global_icosahedral_single-level"
ICON_INVAR = "icon_global_icosahedral_time-invariant"
LATTICE = (361, 720)


def box_assignment(clat, clon):
    """Node index (r * 720 + c) for every native cell, and the number of cells per node. Degrees or radians accepted."""
    import numpy as np
    clat = np.asarray(clat, dtype=float)
    clon = np.asarray(clon, dtype=float)
    if np.nanmax(np.abs(clat)) <= np.pi + 0.01:
        clat, clon = np.degrees(clat), np.degrees(clon)
    rows, cols = LATTICE
    r = np.clip(np.rint((clat + 90.0) / 0.5).astype(np.int64), 0, rows - 1)
    c = np.rint((((clon + 180.0) % 360.0)) / 0.5).astype(np.int64) % cols
    node = r * cols + c
    return node, np.bincount(node, minlength=rows * cols)


def box_mean(values, node, counts):
    """(361, 720) frame-order plane (row 0 = 90S, column 0 = 180W) from native cell values; NaN cells are left out."""
    import numpy as np
    rows, cols = LATTICE
    v = np.asarray(values, dtype=float)
    ok = np.isfinite(v)
    sums = np.bincount(node[ok], weights=v[ok], minlength=rows * cols)
    n = np.bincount(node[ok], minlength=rows * cols)
    out = np.full(rows * cols, np.nan)
    has = n > 0
    out[has] = sums[has] / n[has]
    plane = out.reshape(rows, cols)
    for pole in (0, rows - 1):                          # one physical point: every column = the mean of the row's cells
        rs, rn = sums.reshape(rows, cols)[pole].sum(), n.reshape(rows, cols)[pole].sum()
        if rn:
            plane[pole, :] = rs / rn
    x = np.arange(cols)
    for r in range(1, rows - 1):                        # empty boxes: periodic interpolation along the row
        row = plane[r]
        good = np.isfinite(row)
        if good.all() or not good.any():
            continue
        xs = x[good]
        plane[r] = np.interp(x, np.concatenate([xs - cols, xs, xs + cols]), np.tile(row[good], 3))
    return plane


def nearest_pick(clat, clon, node):
    """For every lattice node, the index of the native cell NEAREST its centre among the cells assigned to its box (-1 = an
    empty box): the largest 3D unit-vector dot product, chosen per node with one lexsort. A point sample, as the GFS and EURO
    frames and the box's own dwd_icon_pressure_fetcher are (static-frames' review of #534)."""
    import numpy as np
    clat = np.asarray(clat, dtype=float)
    clon = np.asarray(clon, dtype=float)
    if np.nanmax(np.abs(clat)) <= np.pi + 0.01:
        clat, clon = np.degrees(clat), np.degrees(clon)
    rows, cols = LATTICE
    r, c = node // cols, node % cols
    la, lo = np.radians(clat), np.radians(clon)
    nla, nlo = np.radians(-90.0 + 0.5 * r), np.radians(-180.0 + 0.5 * c)
    dot = np.cos(la) * np.cos(nla) * np.cos(lo - nlo) + np.sin(la) * np.sin(nla)
    order = np.lexsort((-dot, node))
    first = order[np.r_[True, node[order][1:] != node[order][:-1]]]
    pick = np.full(rows * cols, -1, dtype=np.int64)
    pick[node[first]] = first
    # a pole row is ONE point: every column takes the cell nearest the pole itself
    for pole, sign in ((0, -1.0), (rows - 1, 1.0)):
        cells = np.nonzero(r == pole)[0]
        if not cells.size:                                  # no cell within a quarter degree: the one nearest the pole anyway
            cells = np.arange(clat.size)
        pick[pole * cols:(pole + 1) * cols] = cells[np.argmax(sign * clat[cells])]
    return pick


def nearest_plane(values, pick):
    """(361, 720) frame-order plane from native values by the nearest-cell pick; empty boxes (near the poles) take the periodic
    linear interpolation along their row, as box_mean does."""
    import numpy as np
    rows, cols = LATTICE
    v = np.asarray(values, dtype=float)
    out = np.where(pick >= 0, v[np.clip(pick, 0, None)], np.nan).reshape(rows, cols)
    x = np.arange(cols)
    for r in range(1, rows - 1):
        row = out[r]
        good = np.isfinite(row)
        if good.all() or not good.any():
            continue
        xs = x[good]
        out[r] = np.interp(x, np.concatenate([xs - cols, xs, xs + cols]), np.tile(row[good], 3))
    return out


class IconOpenDataSource:
    """DWD ICON global, one single-level field per hour (spec['idx'] = (directory, (file tokens...))), regridded to the lattice."""

    def __init__(self, spec, session=None):
        self.spec = spec
        self.http = _http(session)
        self._grid = {}

    def _url(self, cycle, f, token):
        d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
        return f"{DWD_BASE}/{hh}/{self.spec['idx'][0]}/{ICON_SINGLE}_{d}{hh}_{f:03d}_{token}.grib2.bz2"

    def url(self, cycle, f):
        return self._url(cycle, f, self.spec["idx"][1][0])

    def _invar(self, cycle, name):
        d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
        return f"{DWD_BASE}/{hh}/{name.lower()}/{ICON_INVAR}_{d}{hh}_{name}.grib2.bz2"

    def complete_cycle(self, now):
        """The newest 00Z/12Z run whose first and last hours and CLAT are published (06/18Z runs stop at 120 h), or None."""
        hours = self.spec["hours"]
        floor12 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 12) * 12)
        for back in range(3):                              # DWD keeps about a day of runs
            cyc = floor12 - timedelta(hours=12 * back)
            try:
                urls = [self.url(cyc, hours[0]), self.url(cyc, hours[-1]), self._invar(cyc, "CLAT")]
                if all(self.http.head(u, timeout=60).status_code == 200 for u in urls):
                    return cyc
            except Exception:
                continue
        return None

    def _decode_bz2(self, url):
        import bz2
        import numpy as np
        import pygrib
        r = self.http.get(url, timeout=120)
        if r.status_code != 200 or not r.content:
            raise RuntimeError(f"GET {url} -> HTTP {r.status_code}")
        raw = bz2.decompress(r.content)
        with fsr.DECODE_LOCK:
            msg = pygrib.fromstring(raw)
            values = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan).ravel()
        return values

    def grid(self, cycle):
        """The nearest-cell pick per lattice node for this run's grid, built once per publish (the weights)."""
        if cycle not in self._grid:
            clat = self._decode_bz2(self._invar(cycle, "CLAT"))
            clon = self._decode_bz2(self._invar(cycle, "CLON"))
            if clat.shape != clon.shape:
                raise RuntimeError(f"CLAT {clat.shape} and CLON {clon.shape} differ")
            node, _counts = box_assignment(clat, clon)
            self._grid[cycle] = (nearest_pick(clat, clon, node), clat.size)
        return self._grid[cycle]

    def fetch(self, cycle, f):
        """(361, 720) frame-order plane in the frame's unit (spec['frame_plane'] tells build_set it is already on the lattice)."""
        pick, ncells = self.grid(cycle)
        last = None
        for token in self.spec["idx"][1]:
            try:
                values = self._decode_bz2(self._url(cycle, f, token))
                break
            except RuntimeError as e:
                last = e
        else:
            raise last or RuntimeError("no ICON file")
        if values.size != ncells:
            raise RuntimeError(f"field has {values.size} cells, the grid {ncells}")
        return nearest_plane(self.spec["convert"](values), pick)


SOURCES = {"ecmwf": EcmwfOpenDataSource, "icon": IconOpenDataSource}
