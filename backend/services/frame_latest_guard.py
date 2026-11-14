"""latest.json write guard (2026-11-14, the advisor's red-team of #888; the director's priority before more publishers go live).

THE RISK. Every publisher (publish_frame_images.publish_frame_sets, frame_set_raster.publish) reads v1/latest.json, changes its
own set records and writes the whole document back. SupabaseSink.read answered EVERY HTTP 400 with None ("missing"), and the
publisher then started from an empty document: one failed read (a 400 that is not "object not found") would write a latest.json
holding only that run's sets, dropping every other set's record. Each client would lose those sets until their publishers ran
again, and retention would then treat their frames as unreferenced.

THE RULE.
  * A strict read tells ABSENT from UNKNOWN. Absent = HTTP 404, or HTTP 400 whose JSON body says the object does not exist
    (Supabase answers a missing object with 400 and {"statusCode":"404","error":"not_found","code":"NoSuchKey"}, measured on the
    public CDN 2026-11-14). Anything else (another 400, a 5xx or a timeout after the retries, an unreadable or non-object body)
    is UNKNOWN, and the run writes no latest.json.
  * ABSENT is believed only on a FRESH bucket (no object under v1/ at all): latest.json missing beside published frames is a
    fault, not a first run. FRAME_LATEST_REBUILD=1 allows that rebuild once an operator has checked.
  * A latest.json is never written with FEWER set records than the document it was built from.
  Kill switch: FRAME_LATEST_GUARD=0 restores the old behaviour (any failed read = empty document; no shrink check).
"""
from __future__ import annotations

import json
import os

LATEST = "v1/latest.json"
EMPTY = {"version": 1, "sets": {}}


class LatestUnknown(RuntimeError):
    """latest.json could not be read with certainty: write nothing."""


class LatestRefused(RuntimeError):
    """The new latest.json would drop set records: write nothing."""


def enabled():
    return os.environ.get("FRAME_LATEST_GUARD", "1") != "0"


def is_not_found(status, body):
    """Does this storage answer mean "the object does not exist"? PURE."""
    if status == 404:
        return True
    if status != 400:
        return False
    try:
        doc = json.loads(body or b"{}")
    except (ValueError, TypeError):
        return False
    if not isinstance(doc, dict):
        return False
    return doc.get("code") == "NoSuchKey" or (str(doc.get("statusCode")) == "404" and doc.get("error") == "not_found")


def _has_any(sink, prefix):
    probe = getattr(sink, "has_any", None)
    if probe is not None:
        return probe(prefix)
    return bool(sink.list(prefix))


def read_latest(sink, log=print):
    """(document, state) with state 'ok' or 'absent'. Raises LatestUnknown when the read is not certain. With the guard off,
    any failed read is the empty document (the old behaviour)."""
    if not enabled():
        raw = sink.read(LATEST)
        return (json.loads(raw) if raw else json.loads(json.dumps(EMPTY))), ("ok" if raw else "absent")
    reader = getattr(sink, "read_strict", None) or sink.read
    try:
        raw = reader(LATEST)
    except LatestUnknown:
        raise
    except Exception as e:
        raise LatestUnknown(f"{LATEST} read failed: {type(e).__name__}: {e}"[:300])
    if raw is None:
        try:
            fresh = not _has_any(sink, "v1")
        except Exception as e:
            raise LatestUnknown(f"{LATEST} is absent and the bucket could not be listed: {type(e).__name__}: {e}"[:300])
        if not fresh and os.environ.get("FRAME_LATEST_REBUILD") != "1":
            raise LatestUnknown(f"{LATEST} is absent but the bucket holds v1/ objects: not a first run; nothing written "
                                "(FRAME_LATEST_REBUILD=1 rebuilds it after a check)")
        if not fresh:
            log(f"[frames] {LATEST} absent beside published objects; rebuilding it (FRAME_LATEST_REBUILD=1)")
        return json.loads(json.dumps(EMPTY)), "absent"
    try:
        doc = json.loads(raw)
    except ValueError as e:
        raise LatestUnknown(f"{LATEST} is not JSON: {e}"[:300])
    if not isinstance(doc, dict) or not isinstance(doc.get("sets", {}), dict):
        raise LatestUnknown(f"{LATEST} is not a document with a `sets` object")
    doc.setdefault("sets", {})
    return doc, "ok"


def check_write(new_doc, base_doc):
    """Raise LatestRefused when `new_doc` drops a set record `base_doc` (the document it was built from) holds: fewer records,
    or one set swapped for another. PURE."""
    if not enabled():
        return
    before = set((base_doc or {}).get("sets") or {})
    after = set((new_doc or {}).get("sets") or {})
    lost = sorted(before - after)
    if lost:
        raise LatestRefused(f"{LATEST} would drop {len(lost)} of {len(before)} set records ({', '.join(lost[:5])}"
                            f"{', ...' if len(lost) > 5 else ''}); nothing written")
