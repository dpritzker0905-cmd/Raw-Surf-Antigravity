"""MANIFEST_MERGE_AT_COMMIT (dark, default off): merge against the head the pointer CAS is about to replace.

★ THE DEFECT (2026-10-16; tests/test_manifest_publish_lost_update.py). An upload merges its snapshot with the head at
RECONCILE time but swaps the pointer at PUBLISH time, 1-3 s later on the serial manifest executor, and
`publish_run_keyed` takes its CAS generation from a pointer read made at publish time. A writer that published in the
gap is overwritten by a snapshot that never saw it (core's 14 estimated EURO frames, 2026-10-16: /api/health/data 503).

THE LANE, three steps that line up with the three functions every upload already runs:
  1. reconcile_manifest_products_for_upload -> capture_basis(): read the pointer row (generation g0), GET that
     generation's manifest, remember {generation, key, product id -> digest}. The same bytes feed the fold, so the
     basis is exactly what the snapshot was merged against. set_pending_basis() parks it for this thread.
  2. dump_manifest_for_l2 -> register_basis_for_bytes(): files the pending basis under sha256 of the serialized
     bytes (the only thing that survives the hop to the manifest executor). Bounded registry. Bytes never change.
  3. publish_run_keyed -> commit_merged(): up to MAX_ATTEMPTS times read the pointer; if the head is still g0 the
     snapshot is published as it is; if it MOVED, three_way_merge() it against the head and CAS from THAT head's
     generation. A lost CAS repeats against the new head with the SAME basis (our diff against g0 does not change).
     No basis, an unmergeable head, an exception or MAX_ATTEMPTS lost CASes: `handled` False and the caller runs the
     single-read publish exactly as it always has. Nothing here raises.

THE MERGE RULE (per product id; B = basis digests, O = our bytes, T = the head's manifest):
    in O and untouched by us (digest == B)   -> T's entry (a newer version of it, or T's deletion)
    in O and added/changed by us             -> OURS
    not in O, in B (we removed it)           -> stays removed
    not in O, not in B, in T                 -> T's entry (registered by someone else since the basis)
  A union would resurrect what the other writer PRUNED and what WE pruned (the dangling-entry 404 class,
  audit #28); "ours always wins" is the lost update itself. Result = T's top-level fields, merged products,
  written_by ours.

After a commit whose merged content differs from our bytes, manifest.json (PUT earlier with those bytes) gets the
merged bytes once, best-effort, behind a thread-local guard so that PUT's own publish_run_keyed is a no-op.

Not covered, by design: the run-keyed object name is deterministic (manifest-g<N+1>.json), so a loser's upload can
overwrite the winner's object at that name before the loser's CAS fails (manifest_immutable.py's unique names fix
the name but do not merge; with MANIFEST_IMMUTABLE_PUBLICATION=1 this lane stands aside).
"""
import hashlib
import json
import logging
import os
import threading
from collections import OrderedDict
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

FLAG = "MANIFEST_MERGE_AT_COMMIT"
MAX_ATTEMPTS = 3
# Snapshots queued behind the single manifest executor, oldest evicted first. Every per-product save queues its own upload and a
# reconcile (one GET) is faster than an upload (a 16 MB PUT + the run-keyed copy + the CAS), so a backlog can run to dozens;
# the executor is FIFO, so a small bound would evict exactly the OLDEST (most stale) snapshots, the ones this lane is for.
# A key is a 64-char hash and the basis behind it is shared per head generation (`_basis_cache`), so depth is cheap.
MAX_REGISTERED = 256

_bases = OrderedDict()                 # sha256(serialized bytes) -> basis
_basis_cache = None                    # (generation, key, basis) of the last head captured: one digest map per head
_bases_lock = threading.Lock()
_local = threading.local()             # .pending = (manifest, basis) between reconcile and dump; .reputting


class Unmergeable(ValueError):
    """The bytes cannot be merged by product id (not a manifest, an entry without an id, a repeated id)."""


def merge_at_commit_enabled() -> bool:
    """Read at call time. The immutable-publication lane owns the commit when it is on and does not merge."""
    return os.environ.get(FLAG, "0") == "1" and os.environ.get("MANIFEST_IMMUTABLE_PUBLICATION", "0") != "1"


def entry_id(raw: dict):
    return raw.get("product_id") or raw.get("filename")


def entry_digest(raw: dict) -> str:
    return hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:24]


def _products_of(doc) -> list:
    products = doc.get("products") if isinstance(doc, dict) else None
    if not isinstance(products, list):
        raise Unmergeable("not a manifest (no products list)")
    return products


def _by_id(products: list, whose: str) -> dict:
    out = {}
    for raw in products:
        pid = entry_id(raw)
        if not pid:
            raise Unmergeable(f"{whose} manifest has an entry with no product_id/filename")
        if pid in out:
            raise Unmergeable(f"{whose} manifest lists {pid} twice")
        out[pid] = raw
    return out


def _later_stamp(ours, theirs):
    """Whichever `last_manifest_update` is later (the original string), else the head's: a merged manifest must not read
    OLDER than the snapshot that was just published. Unparseable on either side -> the head's, as before."""
    from datetime import datetime, timezone

    def parse(value):
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    try:
        return ours if parse(ours) > parse(theirs) else theirs
    except Exception:
        return theirs


def _generation(head) -> Optional[int]:
    generation = head.get("generation") if isinstance(head, dict) else None
    return generation if type(generation) is int and generation >= 1 else None


# ── step 1: reconcile ────────────────────────────────────────────────────────────────────────────────────────────

def capture_basis() -> Tuple[Optional[dict], Optional[list]]:
    """(basis, raw head products) read from ONE pointer row + ONE GET of that generation's object. (None, None) on
    any failure: the caller then reconciles exactly as it does with the lane off, and the commit has no basis."""
    try:
        from services.weather_pipeline import manifest_pointer as pointer
        head = pointer.read_pointer()
        generation = _generation(head)
        if generation is None or not head.get("manifest_key"):
            return None, None
        body = pointer.fetch_manifest_object(head["manifest_key"])
        if body is None:
            return None, None
        products = _products_of(json.loads(body.decode("utf-8")))
        global _basis_cache
        cached = _basis_cache
        if cached is not None and cached[0] == generation and cached[1] == head["manifest_key"]:
            return cached[2], products         # the same head: share its digests (a backlog of snapshots, one hash pass)
        try:
            digests = {pid: entry_digest(raw) for pid, raw in _by_id(products, "head").items()}
        except Unmergeable as e:
            logger.warning(f"[Manifest Merge] no basis captured, {e}")
            return None, products
        basis = {"generation": generation, "key": head["manifest_key"], "products": digests}
        _basis_cache = (generation, head["manifest_key"], basis)
        return basis, products
    except Exception as e:
        logger.warning(f"[Manifest Merge] no basis captured: {e}")
        return None, None


def set_pending_basis(manifest, basis: Optional[dict]) -> None:
    """Park (or, with None, clear) this thread's basis for `manifest`. reconcile and dump run back to back on
    the caller's thread, so a thread-local cannot cross two writers' snapshots."""
    _local.pending = (manifest, basis)


# ── step 2: dump ─────────────────────────────────────────────────────────────────────────────────────────────────

def register_basis_for_bytes(manifest, data: bytes) -> None:
    """File the parked basis under the serialized bytes; consumed here, so a later dump of a changed snapshot
    that skipped reconcile cannot inherit a basis that describes other products."""
    pending = getattr(_local, "pending", None)
    _local.pending = None
    if not pending or pending[0] is not manifest or pending[1] is None:
        return
    key = hashlib.sha256(data).hexdigest()
    with _bases_lock:
        _bases[key] = pending[1]
        _bases.move_to_end(key)
        while len(_bases) > MAX_REGISTERED:
            _bases.popitem(last=False)


def _lookup_basis(data: bytes) -> Optional[dict]:
    with _bases_lock:
        return _bases.get(hashlib.sha256(data).hexdigest())


# ── step 3: commit ───────────────────────────────────────────────────────────────────────────────────────────────

def three_way_merge(basis: dict, ours_bytes: bytes, head_bytes: bytes) -> bytes:
    """Merge our bytes into the head per the rule in the module docstring. Returns `ours_bytes` itself when the
    merge adds nothing to it. Raises Unmergeable (or any parse error) when it cannot be done."""
    ours_doc = json.loads(ours_bytes.decode("utf-8"))
    head_doc = json.loads(head_bytes.decode("utf-8"))
    ours = _by_id(_products_of(ours_doc), "our")
    theirs = _by_id(_products_of(head_doc), "head")
    base = basis["products"]

    def untouched(pid):
        return pid in base and entry_digest(ours[pid]) == base[pid]

    merged = {}
    for pid, theirs_raw in theirs.items():
        if pid in ours:
            merged[pid] = theirs_raw if untouched(pid) else ours[pid]
        elif pid not in base:
            merged[pid] = theirs_raw
    for pid, ours_raw in ours.items():
        if pid not in theirs and not untouched(pid):
            merged[pid] = ours_raw
    if merged == ours:
        return ours_bytes
    result = dict(head_doc)
    result["products"] = list(merged.values())
    if "written_by" in ours_doc:
        result["written_by"] = ours_doc["written_by"]
    if "last_manifest_update" in ours_doc:
        result["last_manifest_update"] = _later_stamp(ours_doc["last_manifest_update"], head_doc.get("last_manifest_update"))
    return json.dumps(result, indent=2, ensure_ascii=False).encode("utf-8")


class _GiveUp(Exception):
    """Not an error: the lane cannot commit this one and the single-read publish should run."""


def commit_merged(manifest_bytes: bytes, upload_fn, delete_fn) -> Tuple[bool, Optional[str]]:
    """(handled, key). handled False = run the single-read publish. Never raises."""
    if getattr(_local, "reputting", False):
        return True, None                      # the legacy re-PUT's own publish: its head is already merged
    basis = _lookup_basis(manifest_bytes)
    if basis is None:
        logger.warning("[Manifest Merge] no merge basis registered for these bytes (not produced by reconcile + "
                       "dump on this process, or the basis could not be captured) - falling back to the "
                       "single-read publish")
        return False, None
    try:
        from services.weather_pipeline import manifest_pointer as pointer
        from services.weather_pipeline.store import _l2_writer_identity
        run_id, written_by = os.environ.get("GITHUB_RUN_ID"), _l2_writer_identity()
        for attempt in range(1, MAX_ATTEMPTS + 1):
            head = pointer.read_pointer()
            generation = _generation(head)
            if generation is None:
                raise _GiveUp("the pointer row is unavailable")
            if generation == basis["generation"]:
                payload = manifest_bytes
            else:
                head_bytes = pointer.fetch_manifest_object(head.get("manifest_key"))
                if head_bytes is None:
                    raise _GiveUp(f"head g{generation} could not be fetched to merge against")
                payload = three_way_merge(basis, manifest_bytes, head_bytes)
            key = pointer.run_keyed_manifest_key(generation + 1)
            upload_fn(key, payload)
            if pointer.cas_advance(generation, key, run_id, written_by):
                _after_win(pointer, generation, key, upload_fn, delete_fn,
                           merged=None if payload is manifest_bytes else payload)
                return True, key
            logger.warning(f"[Manifest Merge] CAS lost at generation {generation} (attempt {attempt}/{MAX_ATTEMPTS}) "
                           f"- {key} left unreferenced")
        raise _GiveUp(f"{MAX_ATTEMPTS} attempts all lost the CAS")
    except Exception as e:
        logger.warning(f"[Manifest Merge] {e} - falling back to the single-read publish")
        return False, None


def _after_win(pointer, generation, key, upload_fn, delete_fn, merged: Optional[bytes]) -> None:
    """Everything after a WON CAS is best-effort: the pointer already moved, so nothing here may fall back.
    `merged` is the published payload when it differs from the bytes manifest.json was PUT with, else None."""
    try:
        old_generation = generation + 1 - pointer.KEEP_RUN_KEYED
        if old_generation > 0:
            try:
                delete_fn(pointer.run_keyed_manifest_key(old_generation))
            except Exception:
                pass
        logger.info(f"[Manifest Merge] advanced g{generation}→g{generation + 1} → {key}"
                    + (" (merged against a moved head)" if merged is not None else ""))
        if merged is not None:
            _local.reputting = True
            try:
                upload_fn("manifest.json", merged)
            finally:
                _local.reputting = False
    except Exception as e:
        logger.warning(f"[Manifest Merge] legacy manifest.json re-PUT failed (pointer lane is correct): {e}")
