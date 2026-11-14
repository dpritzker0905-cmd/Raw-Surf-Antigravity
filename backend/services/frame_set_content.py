"""Content-keyed frame carry (2026-11-12, FRAME_CONTENT_CARRY, ON; kill switch '0').

WHY: frame_set.publish_set carries a frame without reading it only when its SOURCE IDENTITY (filename, model run, run_time,
ingested_at, + the fill donor's) matches the previous index. The pilots lane re-ingests the same CMEMS run every fire, and
each re-ingest stamps a new `run_time` (the manifest registration time) and `ingested_at`, so every EURO swell frame was
re-read, re-encoded and parity-checked in every run: 74-118 frames per set, ~20-40 s per set, ~200 s for the six sets
(9 pilots runs 11-11 00:14Z .. 11-12 11:52Z). On the CDN at 11-12 06:37Z, 73 of the 116 swell_1 frames of the new index had
the SAME sha256 as the previous index although every one of their identities had changed.

WHAT: when the identity differs, the publisher still reads the product bytes from disk (cheap), and this module computes a
CONTENT KEY: sha256 of the bytes with the VALUES of the two volatile keys blanked. If the key, the code fingerprint and (for a
filled set) the donor's key all equal what the previous frame recorded, the frame is carried: same path, sha, bytes and grid,
with its meta's run_time / ingested_at replaced by this product's. That is exactly what a rebuild writes when the frame's
sha comes out unchanged (frame_set's `unchanged` branch), minus the JSON parse, the fill, the encode and the parity check.

THE IDENTITY, field by field (in = part of the key; the failure if the choice were wrong):
  * product bytes, all of them        IN   every byte the encoder, the parity gate, the fill and product_meta can read. A field
                                           left out could change pixels while the frame is carried: a WRONG frame.
  * run_time, ingested_at values      OUT  blanked: the encoder reads neither (frame_binary.encode_frame reads valid_time and
                                           model_run_time), the fill reads neither, and product_meta's copies are rewritten
                                           from the bytes on carry. Left IN, nothing is ever carried (today's churn).
      Guard: each key must occur EXACTLY ONCE, at the top level (brace depth 1), and its value must equal the manifest entry's
      (the same check the stale-copy guard makes for run_time). Otherwise no content carry: a rebuild, today's path.
  * model_run_time                    IN   (in the bytes, and the manifest's must equal the previous frame's): the encoder
                                           writes it into the frame header, and the stale-copy guard compares it.
  * filename                          IN   (must equal the previous frame's): it is the meta's product_id.
  * code fingerprint                  IN   sha of frame_binary, frame_set, frame_set_fill, this module and coarse_gulf_fill.
                                           Without it a deploy that changes the encoder or the fill would keep serving frames
                                           built by the old code until the CMEMS run rolls (daily); today's churn hid that.
  * fill donor: filename, model_run_time, manifest resolution, and the donor's content key   IN (filled sets only).
                                           The fill rewrites every masked node from the donor, so a changed donor changes
                                           pixels; its filename is in the frame's coarse_fill stamp; apply_fill reads the
                                           manifest's resolution. A donor whose run_time is not the one its manifest entry
                                           names fails coarse_gulf_fill._same_run on a rebuild, so it is never carried either.
  * KEY_VERSION                        IN   bump it to rebuild every content-carried frame once.

NOT ELIGIBLE (identity carry only, as before): wind sets (the HRRR lane), rated sets (the rating chain) and frames the Bight
composition touches: their bytes depend on more than the product and its donor.

KNOWN DIFFERENCE from a rebuild: the index's set-level `parity_max_abs_err` / the step's parity stats cover the frames CHECKED
this run, as they already do for identity-carried frames; every carried frame passed the gate when it was built.
"""
from __future__ import annotations

import hashlib
import json
import os
import re

FLAG = "FRAME_CONTENT_CARRY"
KEY_VERSION = 1
VOLATILE = ("run_time", "ingested_at")
_VALUE = rb'"((?:[^"\\]|\\.)*)"|null'
_KEY_RX = {k: re.compile(rb'"' + k.encode("ascii") + rb'"\s*:\s*(?:' + _VALUE + rb')') for k in VOLATILE}

_HERE = os.path.dirname(os.path.abspath(__file__))
CODE_FILES = tuple(os.path.join(_HERE, f) for f in (
    "frame_binary.py", "frame_set.py", "frame_set_fill.py", "frame_set_content.py",
    os.path.join("weather_pipeline", "coarse_gulf_fill.py")))
_code = None


def enabled():
    return os.environ.get(FLAG, "1") != "0"


def code_sha12():
    """The fingerprint of the code that turns product bytes into frame bytes (read once per process)."""
    global _code
    if _code is None:
        h = hashlib.sha256()
        for path in CODE_FILES:
            h.update(os.path.basename(path).encode("utf-8"))
            try:
                with open(path, "rb") as fh:
                    h.update(fh.read())
            except OSError:
                h.update(b"<missing>")
        _code = h.hexdigest()[:12]
    return _code


def masked(raw):
    """(sha256[:32] of `raw` with every VOLATILE value blanked, {key: value or None}), or None when that is not provably safe:
    a key absent or repeated, or not at the top level of the JSON object. PURE."""
    if not isinstance(raw, (bytes, bytearray)):
        return None
    vals, spans = {}, []
    for k, rx in _KEY_RX.items():
        found = list(rx.finditer(raw))
        if len(found) != 1:
            return None
        m = found[0]
        if raw.count(b"{", 0, m.start()) - raw.count(b"}", 0, m.start()) != 1:
            return None                     # nested (or a brace inside a string before it): not provably the top-level key
        vals[k] = None if m.group(1) is None else json.loads(b'"' + m.group(1) + b'"')
        spans.append(m.span())
    h = hashlib.sha256()
    pos = 0
    for a, b in sorted(spans):
        h.update(raw[pos:a])
        h.update(b"\x00")
        pos = b
    h.update(raw[pos:])
    return h.hexdigest()[:32], vals


def _keyed(raw, filled, donor, donor_raw):
    """(content record, the product's volatile values, the donor's) or None: each file is scanned once."""
    m = masked(raw)
    if m is None:
        return None
    rec = {"v": KEY_VERSION, "code": code_sha12(), "product": m[0]}
    dvals = None
    if filled:
        dm = masked(donor_raw) if donor is not None else None
        if dm is None:
            return None
        rec["donor"] = {"filename": donor.get("filename"), "model_run_time": donor.get("model_run_time"),
                        "resolution": donor.get("resolution"), "masked": dm[0]}
        dvals = dm[1]
    return rec, m[1], dvals


def content_key(raw, filled=False, donor=None, donor_raw=None):
    """The `content` record a frame built from `raw` carries in the index, or None (no content carry for it). PURE but for
    the code fingerprint."""
    k = _keyed(raw, filled, donor, donor_raw)
    return k[0] if k else None


def _iso_s(t):
    return None if not t else str(t).replace("+00:00", "Z")[:19]


def try_carry(prev, ident, raw, iso, filled=False, donor=None, donor_raw=None):
    """The previous frame carried under this run's identity, or None (rebuild). `prev` is the previous index's frame with its
    full meta; `ident` this run's source identity; `raw` the product bytes on disk; `iso` frame_set.iso. PURE but for the code
    fingerprint."""
    if not prev or not prev.get("path") or not prev.get("content") or raw is None:
        return None
    psrc = prev.get("source") or {}
    if ident.get("filename") != psrc.get("filename") or ident.get("model_run_time") != psrc.get("model_run_time"):
        return None
    keyed = _keyed(raw, filled, donor, donor_raw)
    if keyed is None or keyed[0] != prev["content"]:
        return None
    key, vals, dvals = keyed
    rt, ia = iso(vals["run_time"]), iso(vals["ingested_at"])
    if rt != ident.get("run_time") or ia != ident.get("ingested_at"):
        return None                         # the copy on disk is not the registration the manifest names: never mix them
    if filled:                              # coarse_gulf_fill._same_run, as apply_fill checks it on a rebuild
        drt = dvals["run_time"]
        if donor.get("run_time") and drt and _iso_s(donor["run_time"]) != _iso_s(drt):
            return None
    meta = dict(prev.get("meta") or {}, run_time=rt, ingested_at=ia)
    return dict(prev, source=ident, content=key, meta=meta)
