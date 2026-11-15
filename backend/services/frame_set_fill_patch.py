"""A cheaper rebuild for the Gulf-filled world frames (2026-11-15, FRAME_FILLED_PATCH, ON; kill switch '0').

WHY. The EURO/ICON `global_mid_filled` sets never carry: their GFS donor changes every pilots run, so every frame's bytes really
change (5 runs after #832: 111-118 frames rebuilt per set, `unchanged` 0; ~45-75 s a set). A filled frame is the plain
`global_mid` frame of the SAME stored product with the masked nodes the targeted fill reached rewritten, so a full rebuild
re-encodes and re-checks ~15,000 nodes to change a few hundred or thousand.

WHAT. When the plain set's frame for the same hour is PROVABLY the encode of this very product, the filled frame is that frame
with only the nodes the fill changed rewritten (frame_binary.patch_nodes), and the parity gate checks exactly those nodes:
  1. the plain index frame's `content` record (frame_set_content: the product's bytes but for run_time / ingested_at, the code
     fingerprint, the key version) equals this product's content key, so its bytes are encode_frame(this product) by this code;
  2. the downloaded plain frame's sha256 equals the index's;
  3. the header encode_frame would write for the FILLED product equals the plain frame's. Every header byte but one is a pure
     function of the grid shape, the node positions (check_regular, cell_bounds), the valid and model-run times and the
     fields: so the shape, the times and the field mask must equal, and every changed node must keep its exact lat/lng. The
     one byte that reads values, the uv convention (decided by the first valid node, which a filled node can become), is
     recomputed from the filled vectors and compared;
  4. the changed nodes are every node whose vector the fill changed (dict inequality, over the whole grid).
Each failure falls back to the full rebuild (stats `patch_fallback_<reason>`), never to a different frame. The result equals the
full rebuild's bytes: same header (3), the unchanged nodes' codes are the plain frame's, which encoded the same vectors (1, 4), and
the changed nodes are encoded by encode_frame's own field_code. FRAME_FILLED_PATCH_VERIFY=1 builds the full frame as well and
compares (a mismatch publishes the full frame and counts `patch_mismatch`): the check for a first live run.

KNOWN DIFFERENCE (the same as identity / content carry): the set's reported parity statistics cover the nodes CHECKED this run.
The unchanged nodes passed the gate when the plain frame was built.
"""
from __future__ import annotations

import gzip
import os
from concurrent.futures import ThreadPoolExecutor

from services import frame_binary as fb
from services import frame_set_content as fsc

FLAG = "FRAME_FILLED_PATCH"
VERIFY = "FRAME_FILLED_PATCH_VERIFY"


def enabled():
    return os.environ.get(FLAG, "1") != "0"


def verify_mode():
    return os.environ.get(VERIFY, "0") == "1"


def plain_target(target):
    """The plain set a filled set is cut from (the same keys without `variant`)."""
    return {k: v for k, v in target.items() if k != "variant"}


class PlainFrames:
    """The plain set's frames for one filled set: index entries by (valid_time, is_estimated), bytes fetched in parallel."""

    def __init__(self, plain_index, sink, workers=8):
        self.entries = {}
        for f in (plain_index or {}).get("frames", []) or []:
            if f.get("path") and f.get("content") and f.get("sha256"):
                self.entries[(f["valid_time"], bool(f.get("is_estimated")))] = f
        self.raw = {}
        self.sink = sink
        self.workers = workers

    def prefetch(self):
        """Fetch every listed frame's bytes; one that cannot be read or whose sha256 differs is simply absent (fallback)."""
        def one(item):
            key, f = item
            try:
                data = self.sink.read(f["path"])
                raw = gzip.decompress(data) if data and data[:2] == fb.GZIP_MAGIC else data
                return key, raw if raw and fb.sha256_hex(raw) == f["sha256"] else None
            except Exception:
                return key, None
        if not self.entries or self.sink is None:
            return
        with ThreadPoolExecutor(max_workers=max(1, self.workers)) as pool:
            for key, raw in pool.map(one, list(self.entries.items())):
                if raw is not None:
                    self.raw[key] = raw


def try_patch(plain, vt, est, raw_json, unfilled, filled, fields):
    """(raw, parity check) of the filled frame by patching the plain one, or (None, reason) when it cannot be proven equal."""
    entry = plain.entries.get((vt, est))
    if entry is None:
        return None, "no_plain"
    if fsc.content_key(raw_json) != entry["content"]:
        return None, "content"
    raw0 = plain.raw.get((vt, est))
    if raw0 is None:
        return None, "fetch"
    head = fb.read_header(raw0)
    fids = tuple(sorted(set(fields)))
    if head["mask"] != sum(1 << f for f in fids):
        return None, "fields"
    g0, g1 = unfilled.get("grid") or {}, filled.get("grid") or {}
    base, vectors = g0.get("vectors") or [], g1.get("vectors") or []
    same_grid = (g0.get("cols"), g0.get("rows"), len(base)) == (g1.get("cols"), g1.get("rows"), len(vectors))
    same_frame = (head["cols"], head["rows"]) == (g1.get("cols"), g1.get("rows")) and head["cols"] * head["rows"] == len(vectors)
    if not (same_grid and same_frame):
        return None, "shape"
    if any(unfilled.get(k) != filled.get(k) for k in ("valid_time", "model_run_time")):
        return None, "times"
    changed = {i: v for i, (a, v) in enumerate(zip(base, vectors)) if a != v}
    if any((v.get("lat"), v.get("lng")) != (base[i].get("lat"), base[i].get("lng")) for i, v in changed.items()):
        return None, "position"
    if fb.uv_convention(vectors) != head["uv_convention"]:
        return None, "header"
    raw = fb.patch_nodes(raw0, head["header_bytes"], fids, len(vectors), changed)
    return (raw, fb.parity(filled, fb.decode_frame(raw), only=set(changed))), "patched"
