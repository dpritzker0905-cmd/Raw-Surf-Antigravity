"""The LOCKED final holdout, as the served-wave scorer sees it (#1199 served-wave-skill-v1 section 1a; amendment 2 here). PURE
except for reading the frozen list file.

  * Collection archives EVERY buoy; only the scorer and what it prints or publishes are filtered.
  * The buoy list carries `holdout.locked_list`: null until #1199's freeze, then {"path", "sha256"} naming the committed
    LOCKED list and the SHA-256 of that file's raw bytes. Every station carries `locked` (null until the freeze, then
    true / false, which must equal membership in the list).
  * state(doc) is the ONLY gate: NOT_READ (no frozen list, or a list that does not verify) means the scorer reads no
    record and no truth, and publishes nothing; READY returns the locked ids, which the scorer drops before it reads.
    A list that is named but missing, or whose bytes do not hash to the recorded SHA-256, is NOT_READ with the reason,
    and the CLI exits non-zero so it is seen: it fails closed, never open.
  * redact() keeps locked ids out of every line a job prints (GitHub Actions logs of this repository are PUBLIC).

The locked-list file contract (written by #1199's freeze, never by this lane):
    {"gate": "docs/weather-program/gates/served-wave-skill-v1.md", "seed": 1199, "fraction": 0.2, "stratified_by": "region",
     "drawn_from_buoy_list_hash": "<buoys.list_hash of the list it was drawn from>", "locked": ["<station id>", ...]}
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from services.point_archive import buoys as buoylist

NOT_READ = "NOT_READ"
READY = "READY"
LOCKED_LIST_PATH = "docs/weather-program/gates/served-wave-skill-v1-locked.json"
REDACTED = "<locked>"


class HoldoutError(ValueError):
    """The frozen list is named but does not verify (missing, hash mismatch, unknown ids, tags disagree)."""


def _verified_ids(doc, repo_root):
    ref = (doc.get("holdout") or {}).get("locked_list")
    if not ref:
        return None
    path = Path(repo_root) / ref["path"]
    if not path.is_file():
        raise HoldoutError(f"locked list {ref['path']} is named but missing")
    raw = path.read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != ref["sha256"]:
        raise HoldoutError(f"locked list {ref['path']} sha256 {got[:12]} != recorded {str(ref['sha256'])[:12]}")
    body = json.loads(raw.decode("utf-8"))
    ids = [str(i).upper() for i in body.get("locked") or []]
    known = {s["id"].upper() for s in doc["stations"]}
    unknown = sorted(set(ids) - known)
    if unknown or not ids or len(set(ids)) != len(ids):
        raise HoldoutError(f"locked list ids invalid ({len(unknown)} unknown, {len(ids)} listed)")
    locked = frozenset(ids)
    disagree = [s for s in doc["stations"] if s.get("locked") is not (s["id"].upper() in locked)]
    if disagree:
        raise HoldoutError(f"{len(disagree)} station `locked` tag(s) disagree with the locked list")
    return locked, got


def state(doc, repo_root=buoylist.REPO_ROOT):
    """(status, info). NOT_READ: info = {"reason": str, "error": bool}. READY: info = {"locked": frozenset, "sha256": str}."""
    try:
        verified = _verified_ids(doc, repo_root)
    except (HoldoutError, ValueError, KeyError, TypeError) as e:
        return NOT_READ, {"reason": f"locked list does not verify: {e}", "error": True}
    if verified is None:
        if any(s.get("locked") is not None for s in doc["stations"]):
            return NOT_READ, {"reason": "stations carry `locked` tags but no locked list is recorded", "error": True}
        return NOT_READ, {"reason": "the #1199 LOCKED list is not frozen and committed yet: collect-only", "error": False}
    locked, sha = verified
    return READY, {"locked": locked, "sha256": sha}


def visible_doc(doc, locked):
    """The buoy list with the LOCKED stations removed (what the scorer is allowed to see)."""
    return {**doc, "stations": [s for s in doc["stations"] if s["id"].upper() not in locked]}


def redact(text, locked):
    """`text` with every locked station id replaced by REDACTED (word-bounded, case-insensitive)."""
    if not locked:
        return text
    pat = re.compile(r"(?<![0-9A-Za-z])(" + "|".join(sorted(map(re.escape, locked), key=len, reverse=True)) + r")(?![0-9A-Za-z])",
                     re.IGNORECASE)
    return pat.sub(REDACTED, text)


def is_locked_path(path, locked):
    """True for an archive path under a locked station's truth folder (truth/<ID>/...)."""
    parts = str(path).split("/")
    return "truth" in parts and parts.index("truth") + 1 < len(parts) and parts[parts.index("truth") + 1].upper() in locked
