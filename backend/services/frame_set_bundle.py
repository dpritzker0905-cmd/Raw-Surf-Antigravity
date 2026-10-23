"""Regional static frames as ONE immutable bundle per set per run (2026-10-23, the z7-9 instant scrub; frame_set.py builds).

WHY A BUNDLE. A regional set is small (0.03-0.9 MB per run) but has 41-113 frames. As one object per frame the pilots step
would upload ~4,500 objects a run one by one (~230-680 s, past FRAME_PUBLISH_BUDGET_S), and the client would fan out up to 113
requests per box, which already met Supabase 429s on the world fill. One bundle per set is one upload and one CDN request.

WHAT IT IS. The set's frames are built and checked exactly as frame_set.publish_set builds world frames (the same codec, the
same per-node parity, the same coverage gate, run identity and selection); their gzip members are then concatenated, in
valid-time order, into
  v1/<model>/<domain>/<layer>/<region_id>/<run>/bundle-<sha12>.bin      (public, immutable)
and each frame's slice [offset, offset + length) is byte-identical to the per-frame object the world path would upload. The
index (immutable, beside it) lists every selected entry:
  frames[]: valid_time, is_estimated, meta, source, offset, length, sha12   (offset null + `unbuilt` = no frame: /grid)
  bundle:   {path, bytes, sha12}        grid: the tile lattice (cell_bounds), not the stored request box
and the latest.json record carries `index` as for every set plus `bundle`, so a client can fetch both at once.
sha12 = the first 12 hex of sha256 over the slice's gzip bytes (a client checks it before decoding).

UNCHANGED RUNS upload nothing: the bundle and index are content-addressed, so when the new index path equals the published one
the set is left as it is. Retention keeps the current and previous index and their bundles (frame_set.referenced_paths).

SETS: GFS waves on every GFS marine pilot box (phase 1, the lead's contract 2026-10-22), then (2026-10-23) GFS swell_1, swell_2
and wind_waves on the same boxes: the live read of the owner's opening view (florida_east_coast, z9) measured their prefetch
/grid_series pages at 6.3, 6.6 and 11.1 s of box work, against 5.1 + 3.9 + 1.2 s for waves. Ordered layer by layer, waves first,
so the publish budget's stagger drops the trains before any waves set. A box with no stored products of a layer (SoCal has
no swell_2) builds nothing. Kill: FRAME_REGIONAL_BUNDLES=0 (all); FRAME_REGIONAL_BUNDLE_LAYERS narrows the layers (comma list).
The client half is dark (the mid-zoom session's PR); publishing alone changes nothing a user sees.
"""
from __future__ import annotations

import hashlib
import json
import os

from services import frame_set as fs

BUNDLE_LAYOUT = "concatenated RSWF v1 gzip members; frame = bundle[offset:offset+length], sha12 = sha256(slice)[:12]"


def _regional_ids():
    """Every GFS marine pilot box, ungated (the ingest's own gates decide what is on disk; a box with no products builds
    nothing). Flagship first, then the worldwide boxes, the F-08 extras and the dark Stage B box, in their config order."""
    from services.weather_pipeline import pilot_regions as pr
    ids = []
    for group in (pr.REGIONAL_CONFIGS, pr.WORLDWIDE_COASTAL_REGIONS, getattr(pr, "GFS_MARINE_EXTRA_REGIONS", {}),
                  getattr(pr, "GFS_MARINE_STAGE_B_REGIONS", {})):
        ids += [r for r in group if r not in ids]
    return ids


REGIONAL_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
REGIONAL_SETS = tuple({"model": "GFS", "domain": "marine", "layer": layer, "region_id": r, "bundle": True}
                      for layer in REGIONAL_LAYERS for r in _regional_ids())


def selected_regional_sets():
    """REGIONAL_SETS narrowed by FRAME_REGIONAL_BUNDLE_LAYERS (comma list; default every layer)."""
    want = [x.strip() for x in os.environ.get("FRAME_REGIONAL_BUNDLE_LAYERS", "").split(",") if x.strip()]
    return tuple(t for t in REGIONAL_SETS if not want or t["layer"] in want)


def enabled():
    return os.environ.get("FRAME_REGIONAL_BUNDLES", "1") != "0"


def is_bundle(target):
    return bool((target or {}).get("bundle"))


def selector(target):
    """The manifest fields a set matches on (the `bundle` marker is the publisher's, not the manifest's)."""
    return {k: v for k, v in target.items() if k != "bundle"}


def sha12(data):
    return hashlib.sha256(data).hexdigest()[:12]


def publish_bundle_set(source, sink, target, previous_index, uploader, log=print, coverage_floor=None):
    """(bundle index or None, stats) for one regional set; uploads the bundle (only) through `uploader` when it changed.

    Frames are built by frame_set.publish_set with NO previous index (a regional run is small; every frame is rebuilt and
    re-checked) and a capturing uploader, so nothing reaches the sink until the whole set has passed parity and the coverage
    gate. None = nothing built, coverage refused, or the published index already is this one."""
    captured = []
    index, stats = fs.publish_set(source, sink, selector(target), None, captured.extend, log=log, coverage_floor=coverage_floor)
    stats["uploaded"], stats["bytes_uploaded"] = 0, 0
    if index is None:
        return None, stats
    members = {path: gz for path, gz, _ctype, _cache in captured}
    blob, frames = bytearray(), []
    for f in index["frames"]:                      # publish_set sorts by (valid_time, is_estimated)
        g = {k: v for k, v in f.items() if k not in ("path", "bytes", "sha256", "raw_bytes")}
        path = f.get("path")
        if path:
            member = members[path]
            g.update(offset=len(blob), length=len(member), sha12=sha12(member))
            blob += member
        else:
            g.update(offset=None, length=None, sha12=None)
        frames.append(g)
    blob = bytes(blob)
    run = fs.stamp(index["run"])
    prefix = fs.set_prefix(target)
    bundle = {"path": f"{prefix}/{run}/bundle-{sha12(blob)}.bin", "bytes": len(blob), "sha12": sha12(blob)}
    out = {k: v for k, v in index.items() if k not in ("frames", "path")}
    out.update(frames=frames, bundle=bundle, layout=BUNDLE_LAYOUT, set=fs.set_key(target))
    body = json.dumps(out, sort_keys=True, separators=(",", ":")).encode("utf-8")
    out["path"] = f"{prefix}/index/{run}-{sha12(body)}.json"
    if previous_index and previous_index.get("path") == out["path"]:
        return None, stats                         # content-addressed: the published index already is this one
    uploader([(bundle["path"], blob, fs.FRAME_TYPE, fs.IMMUTABLE)])
    stats["uploaded"], stats["bytes_uploaded"] = 1, len(blob)
    return out, stats


def latest_record(index, previous_entry, written_at, writer):
    """frame_set.latest_record plus the bundle (frames are counted by slice, since a bundle frame has no own path)."""
    rec = fs.latest_record(index, previous_entry, written_at, writer)
    rec["frames"] = sum(1 for f in index["frames"] if f.get("offset") is not None)
    rec["bundle"] = index["bundle"]
    return rec
