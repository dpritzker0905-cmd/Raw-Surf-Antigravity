"""The gap fill's systematic offset S: a running mean of MODEL - GFS at each UTC hour of day (2026-11-22, DARK).

WHY. Past a model's own frames the client draws a prediction (frontend ownRasterGapFill.js, #1136):
    value = GFS(t) + S(h) + w(t) * (MODEL(t0) - GFS(t0) - S(h))
where h is the UTC hour of day, t0 the model's last own frame at that hour, and only the residual R = (MODEL - GFS)(t0) - S
decays. S is the part of the model's difference from GFS that does not go away with lead time (terrain height, boundary
layer, cloud scheme): the senior research lead's Q2 note on #1136 (#1141), cf. Cui et al. 2012 on week-2 bias, which
estimates such a mean with a decaying-average FILTER OVER PAST RUNS (NAEFS / NBM). That filter is what this module runs.

WHAT. One small frame set per (model, layer) pair, beside the frames (the director, 2026-11-22: ingest-side, not older full
runs kept in the bucket):
    ICON/weather/temperature_offset/global_0p5    ICON 0.125 T_2M (box-mean to 0.5 deg) minus GFS 0.5 TMP 2 m, degC
    EURO/weather/cloud_cover_offset/global_0p5    ECMWF tcc x 100 minus GFS 0.25 TCDC, both box-mean to 0.5 deg, % points
Eight frames per set, one per UTC hour of day 00, 03, ... 21 (the frame's valid_time carries the hour; the client reads only
its hour). Both store field 7 (temp_c's signed 0.05 codec: -100 .. +3176, so a cloud offset of -100 .. +100 % fits too).

THE FILTER (PRE-REGISTERED, docs/weather-program/log/2026-11-22-claude-gapfill-offset-s-r.md, before any data is read):
  * one update per new model run (the set's run = the model run it read; publish() skips a run already published);
  * pairs used: the model's own frames at leads 24-48 h (past spin-up) whose valid hour is the phase, each paired with the
    GFS frame at the SAME valid time from the GFS set's current run; the update value d is their mean, node by node;
  * S_new = S_prev + a * (d - S_prev), a = max(1 / n, ALPHA_FLOOR), n = the number of updates so far including this one
    (a plain mean while n < 20, then an exponential filter with weight 0.05: an e-folding memory of ~20 runs, 5-10 days);
  * a node with no previous S takes d; a node with no d keeps S_prev.
  The update count is kept PER PHASE and rides in each frame entry's source url ('...;updates=N'), so the next run reads
  it back; a phase whose previous S frame cannot be read restarts at 1, marked ';restart=unreadable_previous'.

FLAG: FRAME_OFFSET_PRODUCT (registered in routes/admin/surf_forecast.py _RATING_FLAGS), default '0'. The client uses S only
behind its own dark lever (window.__RAW_RASTER_GAPFILL_OFFSET__), so nothing users see moves until a pre-registered score
against observations passes.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from services import frame_binary as fb
from services import frame_set as fs
from services import runtime_flags as _rf

FLAG = "FRAME_OFFSET_PRODUCT"
ALPHA_FLOOR = 0.05
LEAD_WINDOW_H = (24, 48)
PHASES = tuple(range(0, 24, 3))
OUT_GRID = {"cols": 720, "rows": 361, "bounds": (-180.0, -90.0, 179.5, 90.0)}

PAIRS = {
    "temperature_icon_offset": {
        "model_key": "ICON/weather/temperature/global_0p125", "gfs_key": "GFS/weather/temperature/global_0p5",
        "valid": (-60.0, 60.0),
        "spec": {
            "target": {"model": "ICON", "domain": "weather", "layer": "temperature_offset", "region_id": "global_0p5"},
            "field": fb.TEMP_C, "valid": (-60.0, 60.0), "clip": None, "frame_plane": True, "grid": "0p5",
            "env": FLAG, "default_on": False, "value_kind": "model_minus_gfs_temperature_2m", "value_unit": "degC",
            "source_dataset": "running mean of DWD ICON T_2M (0.125 deg, box-mean to 0.5) minus NOAA GFS TMP 2 m, per UTC hour",
            "hours": PHASES, "source": "offset", "upstream_provider": "dwd+noaa",
            "credit": "Derived from Deutscher Wetterdienst (DWD) ICON and NOAA GFS data (difference, running mean)",
            "license": "DWD open data (GeoNutzV) with source attribution; NOAA open data (NODD)",
            "source_url": "https://opendata.dwd.de/weather/nwp/icon/grib/",
        },
    },
    "cloud_euro_offset": {
        "model_key": "EURO/weather/cloud_cover/global_0p25", "gfs_key": "GFS/weather/cloud_cover/global_0p25",
        "valid": (-100.0, 100.0),
        "spec": {
            "target": {"model": "EURO", "domain": "weather", "layer": "cloud_cover_offset", "region_id": "global_0p5"},
            "field": fb.TEMP_C, "valid": (-100.0, 100.0), "clip": None, "frame_plane": True, "grid": "0p5",
            "env": FLAG, "default_on": False, "value_kind": "model_minus_gfs_cloud_cover", "value_unit": "percent_points",
            "source_dataset": "running mean of ECMWF tcc x 100 minus NOAA GFS TCDC (both box-mean to 0.5 deg), per UTC hour",
            "hours": PHASES, "source": "offset", "upstream_provider": "ecmwf+noaa",
            "credit": "Derived from Copyright ECMWF open data (CC BY 4.0) and NOAA GFS data (difference, running mean)",
            "license": "ECMWF open data CC BY 4.0; NOAA open data (NODD)",
            "source_url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
        },
    },
}


def enabled() -> bool:
    return _rf.flag(FLAG, "0") == "1"


def alpha(n: int) -> float:
    """The filter weight for the n-th update (n >= 1): a plain mean while 1/n > ALPHA_FLOOR, then the floor."""
    return max(1.0 / max(1, n), ALPHA_FLOOR)


def update(prev, d, n):
    """S after the n-th update. NaN = no value: a node without S_prev takes d; a node without d keeps S_prev."""
    import numpy as np
    if prev is None:
        return np.array(d, dtype=float)
    a = alpha(n)
    out = np.where(np.isfinite(prev), prev + a * (d - prev), d)
    return np.where(np.isfinite(d), out, prev)


def to_out_grid(plane):
    """A global plane (rows south first, columns from 180W, no wrap column) box-averaged onto the 0.5-degree lattice: each
    output node takes the mean of the valid source nodes within half an output cell (columns wrap at the antimeridian)."""
    import numpy as np
    p = np.asarray(plane, dtype=float)
    rows, cols = p.shape
    if (rows, cols) == (OUT_GRID["rows"], OUT_GRID["cols"]):
        return p
    k = cols // OUT_GRID["cols"]
    if k * OUT_GRID["cols"] != cols or (rows - 1) != k * (OUT_GRID["rows"] - 1):
        raise ValueError(f"cannot box-average a {rows} x {cols} plane onto 0.5 deg")
    half = k // 2
    s = np.zeros((rows, cols))
    c = np.zeros((rows, cols))
    ok = np.isfinite(p)
    v = np.where(ok, p, 0.0)
    for dr in range(-half, half + 1):
        r_v = np.roll(v, -dr, axis=0)
        r_o = np.roll(ok, -dr, axis=0)
        if dr > 0:
            r_o[-dr:, :] = False
        elif dr < 0:
            r_o[:-dr, :] = False
        for dc in range(-half, half + 1):
            s += np.where(np.roll(r_o, -dc, axis=1), np.roll(r_v, -dc, axis=1), 0.0)
            c += np.roll(r_o, -dc, axis=1)
    mean = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    return mean[::k, ::k]


_UPDATES = re.compile(r"updates=(\d+)")


def _parse(ts):
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(timezone.utc)


class OffsetSource:
    """frame_set_raster.publish's source contract (complete_cycle / url / fetch) for one offset set, reading the published
    model and GFS frames back through `sink.read`. `bytes_pulled` counts what was read (the step's size notice)."""

    def __init__(self, name, sink, log=print):
        self.name, self.pair, self.sink, self.log = name, PAIRS[name], sink, log
        self.bytes_pulled = 0
        self.model_index = self.gfs_index = None
        self.prev = {}            # phase -> previous S plane
        self.n_prev = {}          # phase -> that phase's previous update count (from its own frame's url)
        self.restarted = set()    # phases whose previous S frame could not be read: restarted at n = 1, said so

    def _json(self, path):
        raw = self.sink.read(path)
        if raw is None:
            return None
        self.bytes_pulled += len(raw)
        return json.loads(raw)

    def _plane(self, path):
        raw = self.sink.read(path)
        if raw is None:
            raise FileNotFoundError(path)
        self.bytes_pulled += len(raw)
        _head, fields = fb.decode_plane(raw)
        return next(iter(fields.values()))

    def complete_cycle(self, now):
        latest = self._json(fs.LATEST) or {}
        sets = latest.get("sets", {})
        m, g = sets.get(self.pair["model_key"]), sets.get(self.pair["gfs_key"])
        if not (m and m.get("index") and g and g.get("index")):
            self.log(f"[offset] {self.name}: model or GFS set not published; nothing to update")
            return None
        self.model_index, self.gfs_index = self._json(m["index"]), self._json(g["index"])
        if not self.model_index or not self.gfs_index:
            return None
        own = sets.get(fs.set_key(self.pair["spec"]["target"]))
        prev_index = self._json(own["index"]) if own and own.get("index") else None
        # PER PHASE (the advisor's HOLD on #1158): each phase's count comes from ITS OWN previous frame. A phase whose previous S
        # cannot be read restarts at n = 1 from this run alone, and says so in its index entry (';restart=unreadable_previous')
        # and as a warning annotation on the step; it never keeps another phase's high n with a one-run S.
        for f in (prev_index or {}).get("frames", []):
            got = _UPDATES.search(str((f.get("source") or {}).get("url", "")))
            if not (got and f.get("path")):
                continue
            phase = _parse(f["valid_time"]).hour
            try:
                self.prev[phase] = self._plane(f["path"])
                self.n_prev[phase] = int(got.group(1))
            except Exception as e:                          # noqa: BLE001 - a missing previous frame restarts that phase
                self.restarted.add(phase)
                self.log(f"::warning title=Gap-fill offset {self.name} phase {phase:02d}Z restarted::previous S unreadable "
                         f"({type(e).__name__}); this phase restarts at update 1")
        # The set's run is the model run read (one update per model run); phases 0..21 h after it cover every UTC hour of day.
        return _parse(self.model_index.get("run") or self.model_index["run_time"])

    def n_for(self, phase):
        """This run's update number for a phase: its own previous count + 1, or 1 (new, or restarted)."""
        return 1 if phase in self.restarted else self.n_prev.get(phase, 0) + 1

    @property
    def n(self):
        """{phase: update number} for this run (the publish report)."""
        return {h: self.n_for(h) for h in PHASES}

    def url(self, cycle, f):
        h = (cycle + timedelta(hours=f)).hour
        tail = ";restart=unreadable_previous" if h in self.restarted else ""
        return f"derived:{self.pair['model_key']}-minus-{self.pair['gfs_key']};phase={h:02d}Z;updates={self.n_for(h)}{tail}"

    def pairs_for(self, cycle, phase):
        """(model frame path, GFS frame path) for every model frame at leads 24-48 h whose valid hour is `phase`."""
        gfs = {_parse(f["valid_time"]): f["path"] for f in self.gfs_index.get("frames", []) if f.get("path")}
        out = []
        for f in self.model_index.get("frames", []):
            if not f.get("path"):
                continue
            v = _parse(f["valid_time"])
            lead = (v - cycle).total_seconds() / 3600.0
            if LEAD_WINDOW_H[0] <= lead <= LEAD_WINDOW_H[1] and v.hour == phase and v in gfs:
                out.append((f["path"], gfs[v]))
        return out

    def fetch(self, cycle, f):
        import numpy as np
        phase = (cycle + timedelta(hours=f)).hour
        pairs = self.pairs_for(cycle, phase)
        if not pairs:
            raise LookupError(f"no model/GFS pair at {phase:02d}Z within leads {LEAD_WINDOW_H}")
        lo, hi = self.pair["valid"]
        diffs = []
        for mp, gp in pairs:
            d = to_out_grid(self._plane(mp)) - to_out_grid(self._plane(gp))
            diffs.append(np.where((d >= lo) & (d <= hi), d, np.nan))
        with np.errstate(invalid="ignore"):
            d = np.nanmean(np.stack(diffs), axis=0) if len(diffs) > 1 else diffs[0]
        return update(None if phase in self.restarted else self.prev.get(phase), d, self.n_for(phase))


def publish_all(sink, uploader, names=None, log=print):
    """Publish every offset set (or `names`) through frame_set_raster.publish; ({name: report}, bytes read)."""
    from services import frame_set_raster as fsr
    reports, pulled = {}, 0
    for name in names or sorted(PAIRS):
        src = OffsetSource(name, sink, log=log)
        reports[name] = fsr.publish(src, sink, uploader, log=log, spec=PAIRS[name]["spec"])
        reports[name]["bytes_pulled"] = src.bytes_pulled
        reports[name]["updates"] = src.n
        reports[name]["restarted_phases"] = sorted(src.restarted)
        pulled += src.bytes_pulled
    return reports, pulled
