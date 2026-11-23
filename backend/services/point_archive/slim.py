"""The SLIM run-file layout (`slim/1`; gate served-wave-verify-v1 amendment 1, A2). PURE.

A run file holds ~10^5 records that repeat the same run provenance, the same per-frame provenance and the same per-buoy cell
on every line. The slim layout writes each of those ONCE and leaves each record only what is its own. It is LOSSLESS:
`unpack(pack(rows)) == rows` exactly (the same rows, keys and values, in the same order; files are written with sorted keys,
so key order inside a row carries nothing), so the record schema (`point-archive/1`) and the scorer are unchanged; only the
bytes on disk shrink (measured ~0.30 -> ~0.125 GB a month).

Lines, in order:
  {"row_type": "header", "layout": "slim/1", "run": {RUN_KEYS shared by every record}}
  {"row_type": "frame", "k": <id>, ...FRAME_KEYS}            one per distinct frame provenance
  {"row_type": "cells", "grid_hash": ..., "cells": {station_id: {CELL_KEYS}}}   one per grid snapshot
  then the original rows in their original order: census rows as they are, each record as
  {"row_type": "r", "k": <frame id>, ...its remaining keys}  (its cell keys dropped, and "c": 1 set, when they equal its
  grid's cells table)
A file whose first line is not a slim header is read as plain JSONL (the full layout).
"""
from __future__ import annotations

LAYOUT = "slim/1"
RUN_KEYS = ("schema", "purpose", "model", "run_time", "buoy_list_version", "buoy_list_hash", "run_hash", "decoder_version",
            "sampler_version", "writer_version")
FRAME_KEYS = ("frame_set", "tier", "lead_h", "valid_time", "frame_hash", "grid_hash", "period_kind", "frame_sha12")
CELL_KEYS = ("cell_row", "cell_col", "cell_lat", "cell_lon", "distance_km")
_MISSING = object()


def _is_record(r):
    return r.get("row_type") == "record"


def pack(rows):
    """Slim lines for `rows` (the sampler's census + record rows of one run file)."""
    recs = [r for r in rows if _is_record(r)]
    run = {}
    if recs:
        for k in RUN_KEYS:
            vals = {repr(r.get(k, _MISSING)) for r in recs}
            if len(vals) == 1 and k in recs[0]:
                run[k] = recs[0][k]
    frames, frame_ids = [], {}
    cells = {}                                   # grid_hash -> {station: cell dict}, only when every use agrees
    clash = set()
    for r in recs:
        gh = r.get("grid_hash")
        if gh is None or not all(k in r for k in CELL_KEYS):
            continue
        c = {k: r[k] for k in CELL_KEYS}
        prev = cells.setdefault(gh, {}).get(r["station_id"])
        if prev is None:
            cells[gh][r["station_id"]] = c
        elif prev != c:
            clash.add((gh, r["station_id"]))
    out = [{"row_type": "header", "layout": LAYOUT, "run": run}]
    body = []
    for r in rows:
        if not _is_record(r):
            body.append(r)
            continue
        fkey = tuple((k, r[k]) for k in FRAME_KEYS if k in r)
        if fkey not in frame_ids:
            frame_ids[fkey] = len(frames)
            frames.append({"row_type": "frame", "k": frame_ids[fkey], **dict(fkey)})
        slim = {"row_type": "r", "k": frame_ids[fkey]}
        gh = r.get("grid_hash")
        factored = (gh in cells and r.get("station_id") in cells[gh] and (gh, r["station_id"]) not in clash
                    and all(r.get(k, _MISSING) == cells[gh][r["station_id"]][k] for k in CELL_KEYS))
        for k, v in r.items():
            if k == "row_type" or k in run or k in dict(fkey) or (factored and k in CELL_KEYS):
                continue
            slim[k] = v
        if factored:
            slim["c"] = 1                        # its cell keys come from the grid's cells table
        body.append(slim)
    grid_rows = [{"row_type": "cells", "grid_hash": gh, "cells": {s: c for s, c in sorted(table.items())
                                                                  if (gh, s) not in clash}}
                 for gh, table in sorted(cells.items())]
    return out + frames + grid_rows + body


def unpack(lines):
    """The full rows of a slim file (or `lines` unchanged when it is not one)."""
    if not lines or lines[0].get("row_type") != "header" or lines[0].get("layout") != LAYOUT:
        return lines
    run = lines[0]["run"]
    frames = {x["k"]: {k: v for k, v in x.items() if k not in ("row_type", "k")} for x in lines if x.get("row_type") == "frame"}
    cells = {x["grid_hash"]: x["cells"] for x in lines if x.get("row_type") == "cells"}
    rows = []
    for x in lines[1:]:
        t = x.get("row_type")
        if t in ("frame", "cells"):
            continue
        if t != "r":
            rows.append(x)
            continue
        full = {"row_type": "record", **run, **frames[x["k"]]}
        full.update({k: v for k, v in x.items() if k not in ("row_type", "k", "c")})
        if x.get("c"):
            full.update(cells[full["grid_hash"]][full["station_id"]])
        rows.append(full)
    return rows
