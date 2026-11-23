"""The `served` purpose's sampler (gate served-wave-verify-v1 sections 2, 2a, 4, 5, 6, 8). Orchestration only; every I/O is
injected (`frames`: the anonymous public read; `decode`: decoder.decode_frames; `writer`: writer.ArchiveWriter).

WHAT IT SAMPLES. Tier A (`global_mid`, 2 deg, every listed buoy) and Tier B (the 0.25 deg regional bundle the frozen list
assigns per (model, set)) of each set in TIER_A / TIER_B below, read from the published `v1/latest.json` and its indexes (the
current and the previous index of each set: retention keeps exactly those two).

WHEN A RUN IS WRITTEN (one immutable file per (purpose, model, run), so a run is written ONCE). The sets of one model do not
move together (live 2026-11-22: EURO waves on the 12Z ECMWF run while the EURO swell sets, from CMEMS, were on 00Z), so a run
R is written when it is CLOSED: no expected set of the model still has a current run earlier than R (nothing can still publish
R), or some set holds R only as its PREVIOUS index (its next publish prunes R: write now or lose it). An open run is deferred
to the next publish. A set that has not published R when R closes is counted `set_unpublished` for (model, set, tier, R).
A run already archived is skipped, so re-publishes are idempotent.

RECORDS. One per (model, run, frame set, tier, buoy, lead), with the shared core of section 0.2: the `waves` set fills the bulk
block (hs_m, tp_s or tm_s as served, dir_deg); a partition set fills `partitions: [{kind, h, tp, dir}]` (`tp` is the shape's
period slot; `period_kind` says whether the served set carries a peak or a mean period). Absent is absent, never zero.
Statuses: ok | out_of_domain | cell_masked | distance_exceeded | sampler_fail (+ cause). Census rows (row_type "census")
account for every expected record per (model, set, tier, run), and carry set_unpublished / no_regional_tier counts.
Leads past 240 h are not sampled.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from services.point_archive import buoys as buoylist
from services.point_archive import cells as cellrule
from services.point_archive import core
from services.point_archive import decoder as dec
from services.point_archive.writer import JSONL_TYPE

SAMPLER_VERSION = "served-wave-sampler/1"
PURPOSE = "served"
TIER_A = "global_mid"
# Section 2a, frozen 2026-11-22 (frame_set.SETS / EURO_SWELL_SETS; frame_set_bundle.REGIONAL_SETS / OTHER_MODEL_SETS).
TIER_A_LAYERS = {"GFS": ("waves", "swell_1", "swell_2", "wind_waves"), "ICON": ("waves", "swell_1", "wind_waves"),
                 "EURO": ("waves",)}
EURO_SWELL_LAYERS = ("swell_1", "swell_2", "wind_waves")      # while FRAME_EURO_SWELL_SETS is '1' (its default)
TIER_B_LAYERS = {"GFS": ("waves", "swell_1", "swell_2", "wind_waves"), "EURO": ("waves",),
                 "ICON": ("waves", "swell_1", "wind_waves")}   # EURO / ICON while FRAME_REGIONAL_BUNDLES_EURO_ICON is on
# The period each served set carries (fetchers, 2026-11-22): GFS-Wave PERPW and ECMWF pp1d (mwp fallback) are PEAK periods;
# DWD GWAM tm10 and every partition period (GFS SWPER / WVPER, GWAM mpts / mpww, CMEMS VTM01_*) are MEAN periods.
PEAK_PERIOD_SETS = {("GFS", "waves"), ("EURO", "waves")}
PARTITION_KIND = {"swell_1": "swell_1", "swell_2": "swell_2", "wind_waves": "wind_waves"}
FETCH_WORKERS = 8
VALUE_DECIMALS = {dec.HEIGHT: 3, dec.PERIOD: 2, dec.DIRECTION: 2}   # frame_binary FIELD_SPECS steps: 0.001 m, 0.01 s, 0.01 deg


def expected_sets(doc, euro_swell=True, regional_euro_icon=True):
    """{model: [(layer, tier)]} the frozen list expects: Tier A for every layer; Tier B for each box a buoy is assigned."""
    out = {}
    for model, layers in TIER_A_LAYERS.items():
        lay = layers + (EURO_SWELL_LAYERS if model == "EURO" and euro_swell else ())
        out[model] = [(layer, TIER_A) for layer in lay]
    for model, layers in TIER_B_LAYERS.items():
        if model != "GFS" and not regional_euro_icon:
            continue
        for layer in layers:
            boxes = sorted({s.get("regional_box", {}).get(f"{model}/{layer}") for s in buoylist.stations(doc)} - {None})
            out[model] += [(layer, b) for b in boxes]
    return out


def set_key(model, layer, tier):
    return f"{model}/marine/{layer}/{tier}"


def period_kind(model, layer):
    return "tp" if (model, layer) in PEAK_PERIOD_SETS else "tm"


def tier_stations(doc, model, layer, tier):
    st = buoylist.stations(doc)
    if tier == TIER_A:
        return st
    return [s for s in st if s.get("regional_box", {}).get(f"{model}/{layer}") == tier]


class Sampler:
    def __init__(self, doc, frames, writer, decode=dec.decode_frames, decoder_version=None, euro_swell=True,
                 regional_euro_icon=True, log=print):
        self.doc, self.frames, self.writer, self.decode, self.log = doc, frames, writer, decode, log
        self.list_version, self.list_hash = doc["version"], buoylist.list_hash(doc)
        self.decoder_version = decoder_version or dec.decoder_version()
        self.expected = expected_sets(doc, euro_swell, regional_euro_icon)
        self.regional_euro_icon = regional_euro_icon
        self._json = {}

    def tier_b_layers(self, model):
        return TIER_B_LAYERS.get(model, ()) if (model == "GFS" or self.regional_euro_icon) else ()

    # ---- reads -----------------------------------------------------------------------------------------------------
    def get_json(self, path):
        if path not in self._json:
            data = self.frames.get(path)
            self._json[path] = json.loads(data) if data is not None else None
        return self._json[path]

    def indexes(self, latest, model):
        """{(layer, tier): {"current": index|None, "previous": index|None}} for the model's expected sets."""
        out = {}
        for layer, tier in self.expected[model]:
            rec = (latest.get("sets") or {}).get(set_key(model, layer, tier)) or {}
            cur = self.get_json(rec["index"]) if rec.get("index") else None
            prev = self.get_json(rec["previous_index"]) if rec.get("previous_index") else None
            out[(layer, tier)] = {"current": cur, "previous": prev}
        return out

    # ---- run selection ---------------------------------------------------------------------------------------------
    @staticmethod
    def closed_runs(ix):
        """[(run, closed?, why)] over every run any of the model's sets holds, oldest first."""
        runs = sorted({i["run"] for v in ix.values() for i in v.values() if i and i.get("run")})
        out = []
        for r in runs:
            lagging = [k for k, v in ix.items() if v["current"] and v["current"].get("run") and v["current"]["run"] < r]
            expiring = [k for k, v in ix.items() if v["previous"] and v["previous"].get("run") == r
                        and v["current"] and v["current"].get("run") and v["current"]["run"] > r]
            if not lagging:
                out.append((r, True, "no set lags"))
            elif expiring:
                out.append((r, True, f"expiring in {len(expiring)} set(s)"))
            else:
                out.append((r, False, f"{len(lagging)} set(s) still before this run"))
        return out

    def run(self, latest):
        """Sample every closed, unarchived run of every model. Returns a report {model: [{run, path|deferred|...}]}."""
        report = {}
        for model in self.expected:
            ix = self.indexes(latest, model)
            report[model] = []
            for r, closed, why in self.closed_runs(ix):
                path = core.run_path(PURPOSE, model, r)
                if self.writer.exists(path):
                    continue
                if not closed:
                    report[model].append({"run": r, "deferred": why})
                    self.log(f"[swv] {model} {r}: deferred ({why})")
                    continue
                rows = self.sample_run(model, r, ix)
                p, h = self.writer.write_run(PURPOSE, model, r, rows)
                n = sum(1 for x in rows if x["row_type"] == "record")
                report[model].append({"run": r, "path": p, "sha256": h, "records": n, "why": why})
                self.log(f"[swv] {model} {r}: {n} records -> {p}")
        return report

    # ---- one run ---------------------------------------------------------------------------------------------------
    def sample_run(self, model, run, ix):
        held = {}
        for key, v in ix.items():
            for which in ("current", "previous"):
                i = v[which]
                if i and i.get("run") == run:
                    held[key] = i
                    break
        run_hash = core.sha256_hex(core.canon(sorted([set_key(model, *k), i["path"]] for k, i in held.items())))
        records, census = [], []
        for layer, tier in self.expected[model]:
            st = tier_stations(self.doc, model, layer, tier)
            base = {"model": model.lower(), "frame_set": layer, "tier": tier, "run_time": core.iso_z(run)}
            if (layer, tier) not in held:
                census.append(self._census(base, set_unpublished=True, buoys=len(st)))
                continue
            recs, cen = self.sample_set(model, layer, tier, run, held[(layer, tier)], st, run_hash)
            records += recs
            census.append(cen)
        for layer in self.tier_b_layers(model):     # once per run, not per lead (section 2a)
            none = [s["id"] for s in buoylist.stations(self.doc) if f"{model}/{layer}" not in s.get("regional_box", {})]
            census.append(self._census({"model": model.lower(), "frame_set": layer, "tier": "regional",
                                        "run_time": core.iso_z(run)}, no_regional_tier=len(none)))
        records.sort(key=lambda x: (x["tier"], x["frame_set"], x["station_id"], x["lead_h"]))
        census.sort(key=lambda x: (x["tier"], x["frame_set"]))
        return census + records

    def _census(self, base, **kw):
        row = {"schema": core.SCHEMA, "purpose": PURPOSE, "row_type": "census", **base, "expected": 0, "counts": {},
               "leads": 0, "buoys": 0, "unbuilt": 0, "other_run": 0, "set_unpublished": False, "no_regional_tier": 0,
               "buoy_list_version": self.list_version, "buoy_list_hash": self.list_hash,
               "sampler_version": SAMPLER_VERSION}
        row.update(kw)
        return row

    def frame_list(self, index, run):
        """[(valid_time, entry)] the client would draw: built frames, authoritative before estimated, valid <= run + 240 h."""
        built, unbuilt = {}, 0
        for f in index.get("frames", []):
            has = f.get("path") or f.get("offset") is not None
            if not has:
                unbuilt += 1
                continue
            vt = core.iso_z(f["valid_time"])
            if core.lead_h(run, vt) > core.MAX_LEAD_H or core.lead_h(run, vt) < 0:
                continue
            if vt not in built or (built[vt].get("is_estimated") and not f.get("is_estimated")):
                built[vt] = f
        return sorted(built.items()), unbuilt

    def fetch_frames(self, index, frames):
        """[(gz bytes | None, cause | None)] per frame: an object per frame (Tier A) or slices of ONE bundle (Tier B),
        each slice's sha12 checked before decoding. A missing object is `pruned`."""
        bundle = (index.get("bundle") or {}).get("path")
        if bundle:
            from services.frame_set_bundle import sha12
            blob = self.frames.get(bundle)
            if blob is None:
                return [(None, "pruned")] * len(frames)
            out = []
            for _vt, f in frames:
                gz = blob[f["offset"]:f["offset"] + f["length"]]
                out.append((gz, None) if len(gz) == f["length"] and sha12(gz) == f.get("sha12") else (None, "sha12"))
            return out

        def one(item):
            try:
                gz = self.frames.get(item[1]["path"])
            except Exception as e:   # recorded as a sampler_fail, never hidden
                return None, f"fetch:{type(e).__name__}"
            return (gz, None) if gz is not None else (None, "pruned")
        with ThreadPoolExecutor(FETCH_WORKERS) as pool:
            return list(pool.map(one, frames))

    def sample_set(self, model, layer, tier, run, index, stations, run_hash):
        frames, unbuilt = self.frame_list(index, run)
        got = self.fetch_frames(index, frames)
        base = {"model": model.lower(), "frame_set": layer, "tier": tier, "run_time": core.iso_z(run)}
        census = self._census(base, buoys=len(stations), unbuilt=unbuilt, leads=len(frames))
        ok_items = [(k, gz) for k, (gz, _c) in enumerate(got) if gz is not None]
        try:
            masks = self.decode([{"gz": gz, "fields": [dec.HEIGHT], "nodes": [], "mask": True} for _k, gz in ok_items])
        except Exception as e:
            masks, cause = None, f"decode:{type(e).__name__}"
            got = [(None, cause)] * len(frames)
            ok_items = []
        heads = {}
        for (k, _gz), m in zip(ok_items, masks or []):
            if m.get("header") is None or m.get("mask") is None:
                got[k] = (None, "no_height_field")
            else:
                heads[k] = m
        ok_items = [(k, gz) for k, gz in ok_items if k in heads]
        # one cell table per grid snapshot (geometry + the first frame's mask of that geometry); cached per grid_hash
        tables, frame_grid = {}, {}
        for k, m in sorted(heads.items()):
            h = m["header"]
            geom = cellrule.geometry(h["cols"], h["rows"], (h["bounds"]["west"], h["bounds"]["south"],
                                                           h["bounds"]["east"], h["bounds"]["north"]))
            gkey = core.canon(geom)
            if gkey not in tables:
                gh = cellrule.grid_hash(geom, m["mask"])
                tables[gkey] = (gh, geom, cellrule.cell_table(geom, m["mask"], stations))
                self.save_cells(gh, geom, tables[gkey][2])
            frame_grid[k] = gkey
        # values at each table's ok cells, in one decoder call
        val_items, val_keys = [], []
        for k, gz in ok_items:
            gh, geom, table = tables[frame_grid[k]]
            nodes = sorted({cellrule.node_index(geom, c) for c in table.values() if c["status"] == "ok"})
            val_items.append({"gz": gz, "fields": list(dec.WAVE_FIELDS), "nodes": nodes})
            val_keys.append((k, nodes))
        vals = {}
        if val_items:
            try:
                for (k, nodes), o in zip(val_keys, self.decode(val_items)):
                    vals[k] = (nodes, o)
            except Exception as e:
                for k, _n in val_keys:
                    got[k] = (None, f"decode:{type(e).__name__}")
        run_ms = core.parse_time(run).timestamp() * 1000
        recs, counts = [], {}
        for k, (vt, f) in enumerate(frames):
            gz, cause = got[k]
            if gz is not None and k in vals and heads[k]["header"]["runMs"] != run_ms:
                census["other_run"] += 1
                continue
            common = {"schema": core.SCHEMA, "purpose": PURPOSE, "row_type": "record", **base,
                      "buoy_list_version": self.list_version, "buoy_list_hash": self.list_hash, "run_hash": run_hash,
                      "decoder_version": self.decoder_version, "sampler_version": SAMPLER_VERSION,
                      "writer_version": core.WRITER_VERSION, "period_kind": period_kind(model, layer)}
            if gz is None or k not in vals:
                common.update(valid_time=vt, lead_h=core.lead_h(run, vt))
                for s in stations:
                    recs.append({**common, "station_id": s["id"], "status": "sampler_fail",
                                 "cause": cause or "decode", "frame_sha12": f.get("sha12")})
                    counts["sampler_fail"] = counts.get("sampler_fail", 0) + 1
                census["expected"] += len(stations)
                continue
            gh, geom, table = tables[frame_grid[k]]
            nodes, o = vals[k]
            pos = {n: i for i, n in enumerate(nodes)}
            vt_hdr = core.iso_z(o["header"]["validMs"] / 1000.0)
            common.update(valid_time=vt_hdr, lead_h=core.lead_h(run, vt_hdr), frame_hash=core.sha256_hex(gz),
                          grid_hash=gh)
            for s in stations:
                c = table[s["id"]]
                row = {**common, "station_id": s["id"], "status": c["status"]}
                if c["status"] == "ok":
                    row.update({x: c[x] for x in ("cell_row", "cell_col", "cell_lat", "cell_lon", "distance_km")})
                    i = pos[cellrule.node_index(geom, c)]
                    h = o["values"][dec.HEIGHT][i]
                    if h is None:
                        row["status"] = "cell_masked"
                    else:
                        self._fill(row, model, layer, h, o["values"].get(dec.PERIOD), o["values"].get(dec.DIRECTION), i)
                elif c["status"] == "distance_exceeded":
                    row["distance_km"] = c.get("distance_km")
                counts[row["status"]] = counts.get(row["status"], 0) + 1
                if row["status"] != "out_of_domain":
                    census["expected"] += 1
                recs.append(row)
        census["counts"] = dict(sorted(counts.items()))
        return recs, census

    @staticmethod
    def _fill(row, model, layer, h, periods, dirs, i):
        """Values as the client draws them, written at the frame field's own quantisation step (height 1 mm; period and
        direction 0.01): that is the encoded code's value exactly; the client's Float32 of it differs by < 1e-5."""
        t = periods[i] if periods else None
        d = dirs[i] if dirs else None
        h = round(h, VALUE_DECIMALS[dec.HEIGHT])
        t = None if t is None else round(t, VALUE_DECIMALS[dec.PERIOD])
        d = None if d is None else round(d, VALUE_DECIMALS[dec.DIRECTION]) % 360.0
        if layer == "waves":
            row["hs_m"] = h
            if t is not None:
                row["tp_s" if period_kind(model, layer) == "tp" else "tm_s"] = t
            if d is not None:
                row["dir_deg"] = d
        else:
            p = {"kind": PARTITION_KIND[layer], "h": h}
            if t is not None:
                p["tp"] = t
            if d is not None:
                p["dir"] = d
            row["partitions"] = [p]

    def save_cells(self, gh, geom, table):
        """The (buoy -> cell) table beside the records, once per (grid_hash, buoy list)."""
        path = f"{core.ROOT}/{PURPOSE}/cells/{gh[:16]}-{self.list_hash[:12]}.json"
        if self.writer.exists(path):
            return
        body = core.canon({"grid_hash": gh, "geometry": geom, "rule": cellrule.CELL_RULE, "buoy_list_version": self.list_version,
                           "buoy_list_hash": self.list_hash, "cells": table}).encode("utf-8")
        try:
            self.writer.write_immutable(path, body, "application/json")
        except FileExistsError:
            pass
        self.log(f"[swv] cells {path}")


def failure_marker(writer, now, cause, error):
    """A whole-job sampler_fail (latest.json unreadable, the decoder missing...): one immutable marker, so the gap shows."""
    path = f"{core.ROOT}/{PURPOSE}/_sampler_fail/{core.run_stamp(now)}-{core.sha256_hex(str(error))[:8]}.json"
    body = core.canon({"schema": core.SCHEMA, "purpose": PURPOSE, "status": "sampler_fail", "cause": cause,
                       "error": str(error)[:500], "at": core.iso_z(now), "sampler_version": SAMPLER_VERSION})
    writer.write_immutable(path, body.encode("utf-8"), JSONL_TYPE)
    return path
