"""Manifest publication in ONE step (dark flag MANIFEST_PUBLISH_ONE_STEP, default "0").

THE DEFECT THIS CLOSES (2026-10-16). manifest.json is rewritten whole by several concurrent CI writers (core ingest,
pilots, precompute). Each upload used to be three separate moments:

    1. reconcile_manifest_products_for_upload()   folds in the head's entries     (CALLER thread, head = generation g0)
    2. dump_manifest_for_l2()                     serializes the snapshot
    3. a queued manifest.json PUT whose publish_run_keyed() reads the pointer NOW and CASes from THAT generation

A snapshot merged against g0 but published after another writer committed g1 therefore won its CAS (from g1) and
replaced the head with bytes that had never seen the other writer's registrations: 14 EURO wind estimated frames, gone.
The CAS protected the generation-copy upload, not the merge it was meant to protect.

THE DESIGN. With the flag on, a save only serializes its snapshot (cheap, no I/O) and hands it to a process-level
COALESCING slot. ONE job on the manifest executor then does, per attempt (up to MAX_ATTEMPTS, jittered backoff):

    a. g = read_pointer()                         the generation we will CAS from
    b. head = the object the pointer names        fetched BY KEY, so the bytes are generation g's, not a later read
    c. merge the ORIGINAL snapshot into the head  the existing reconcile (union, retention, prefer-newer, exclude_keys)
    d. upload a UNIQUE create-only object         manifests/manifest-g<g+1>-<uuid4>.json, strict, overwrite=False
    e. cas_advance(g, key, ...)                   the SAME g the merge was made against

and nothing that fails ever publishes the snapshot unmerged: an unreadable pointer, an unreadable head, an upload that
was not acknowledged, a CAS that lost (or whose answer was lost) all send the attempt back to step a. After
MAX_ATTEMPTS the pointer, the unique objects and the legacy manifest.json are untouched, the failure is logged at ERROR
and the snapshot stays pending for the next job. There is NO fall-back to the old publish path, whatever failed, EXCEPT
the one case where there is no pointer lane at all (the table is missing: permanent, nothing to protect).

After a WON CAS the job asks manifest_immutable to retire old copies, then PUTs the merged bytes to the legacy
manifest.json (the readers' fallback) with publish_run_keyed suppressed on this thread, so that PUT cannot publish a
second generation. Both are best effort: the pointer win is the commit.

Flag off, or the lane unavailable (pointer disabled, MANIFEST_IMMUTABLE_PUBLICATION=1, MANIFEST_MERGE_ON_UPLOAD=0, not
the designated writer): `submit_manifest_publish` is exactly the three lines it replaced at the six call sites.

Where to flip it: the L2 writers' workflow env together (forecast-ingest, forecast-ingest-pilots, precompute), not Render.
"""
import json
import logging
import os
import random
import threading
import time
from uuid import uuid4

from services.weather_pipeline import manifest_pointer as mp

logger = logging.getLogger(__name__)

FLAG = "MANIFEST_PUBLISH_ONE_STEP"
MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 0.25
BACKOFF_CAP_SECONDS = 3.0
_sleep = time.sleep          # injectable: tests must not wait


def _store_module():
    from services.weather_pipeline import store
    return store


def backoff_seconds(retry: int) -> float:
    """Jittered exponential wait before retry number `retry` (1 = the first retry): 0.25, 0.5, 1, 2 s, each times 0.5-1."""
    return min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (retry - 1)) * random.uniform(0.5, 1.0)


def _submit_legacy(store, manifest, exclude_keys):
    """Today's three lines, byte for byte: reconcile on the caller's thread, dump, queue the manifest.json PUT."""
    store_mod = _store_module()
    if exclude_keys is None:
        store_mod.reconcile_manifest_products_for_upload(manifest)
    else:
        store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=exclude_keys)
    manifest_json = store_mod.dump_manifest_for_l2(manifest)
    store_mod._manifest_executor.submit(store._upload_to_supabase, "manifest.json", manifest_json)


def one_step_active() -> bool:
    """Flag on AND this process can use the lane. Anything else is today's path, unchanged."""
    if os.environ.get(FLAG, "0") != "1":
        return False
    if os.environ.get("MANIFEST_IMMUTABLE_PUBLICATION", "0") == "1":
        return False                        # that lane owns the commit
    if os.environ.get("MANIFEST_MERGE_ON_UPLOAD", "1") == "0":
        return False                        # the operator turned merging off: the merge is this lane's whole point
    if not mp.pointer_enabled():
        return False                        # no pointer table: nothing to compare-and-swap
    return _store_module()._l2_pipeline_writes_allowed()


class _Pending:
    """The newest snapshot not yet published, and every exclusion submitted since the last successful publish."""
    __slots__ = ("store", "snapshot", "excludes")

    def __init__(self, store, snapshot, excludes):
        self.store, self.snapshot, self.excludes = store, snapshot, excludes


class _Slot:
    def __init__(self):
        self.lock = threading.Lock()
        self.pending = None                 # _Pending or None
        self.scheduled = False              # a job is queued or running on the manifest executor


_slot = _Slot()


def submit_manifest_publish(store, manifest, exclude_keys=None):
    """Publish `manifest` (this process's cumulative in-memory registry) to L2.

    `exclude_keys`: product ids this call pruned (their objects are deleted), which a head that still names them must
    not bring back. Raises what the three lines it replaces raised; the call sites already log that."""
    if not one_step_active():
        _submit_legacy(store, manifest, exclude_keys)
        return
    snapshot = _store_module().dump_manifest_for_l2(manifest)            # serialization only: no I/O on this thread
    excludes = frozenset(exclude_keys or ())
    slot = _slot
    with slot.lock:
        if slot.pending is not None:
            excludes = slot.pending.excludes | excludes                   # snapshots are cumulative, exclusions add up
        slot.pending = _Pending(store, snapshot, excludes)
        schedule = not slot.scheduled
        slot.scheduled = True
    if schedule:
        try:
            _store_module()._manifest_executor.submit(_drain, slot)
        except BaseException:
            with slot.lock:
                slot.scheduled = False                                    # nothing is running: do not wedge the slot
            raise


def _drain(slot):
    """The one job: publish the pending snapshot, and again for any newer one that arrived meanwhile.

    A newer snapshot is published by THIS job rather than by a follow-up job submitted from here, because a worker cannot
    submit to its own executor once the interpreter has begun to exit, and exit is exactly when the join must finish it."""
    try:
        while True:
            with slot.lock:
                current = slot.pending
                if current is None:
                    slot.scheduled = False
                    return
            published = _publish(current)
            with slot.lock:
                if published and slot.pending is current:
                    slot.pending = None                                   # a newer snapshot, if any, stays
                if slot.pending is None or slot.pending is current:
                    slot.scheduled = False                                # drained, or failed with nothing newer to try
                    return
    except BaseException:
        with slot.lock:
            slot.scheduled = False
        raise


def _publish(pending) -> bool:
    """True when the snapshot is published. Never raises."""
    try:
        for number in range(1, MAX_ATTEMPTS + 1):
            if number > 1:
                _sleep(backoff_seconds(number - 1))
            if _attempt(pending, number):
                return True
        logger.error(
            f"[Manifest Publish] NOT published after {MAX_ATTEMPTS} attempts: the pointer, the unique manifest objects "
            f"and the legacy manifest.json are untouched; the snapshot and its exclude_keys stay pending for the next job.")
    except Exception as exc:
        logger.error(f"[Manifest Publish] NOT published, the job failed unexpectedly: {type(exc).__name__}: {exc}")
    return False


def _attempt(pending, number) -> bool:
    try:
        return _attempt_once(pending)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] attempt {number}/{MAX_ATTEMPTS} failed: {type(exc).__name__}: {exc}")
        return False


def _head_products(head_bytes):
    doc = json.loads(head_bytes)
    products = doc.get("products") if isinstance(doc, dict) else None
    if not isinstance(products, list):
        raise ValueError("the head object is not a manifest")
    return products


def _attempt_once(pending) -> bool:
    """One read-merge-CAS. True = published (or, with no pointer lane at all, written the old way). False = try again."""
    from services.weather_pipeline.schemas import PipelineManifest
    store_mod = _store_module()
    row = mp.read_pointer()
    if row is None:
        if not mp.pointer_enabled():                                     # the table is missing: permanent
            _publish_old_path(pending)
            return True
        logger.warning("[Manifest Publish] the pointer row could not be read")
        return False
    generation, head_key = row.get("generation"), row.get("manifest_key")
    if type(generation) is not int or not 1 <= generation < 999999999999 or not head_key:
        logger.warning(f"[Manifest Publish] unusable pointer row: generation={generation!r} key={head_key!r}")
        return False
    head_bytes = mp.fetch_manifest_object(head_key)
    if head_bytes is None:
        logger.warning(f"[Manifest Publish] the head object {head_key} could not be read")
        return False
    head_products = _head_products(head_bytes)
    del head_bytes
    manifest = PipelineManifest.model_validate_json(pending.snapshot)     # the ORIGINAL snapshot, every attempt
    store_mod.reconcile_manifest_products_for_upload(
        manifest, exclude_keys=pending.excludes, remote_products=head_products)
    merged = store_mod.dump_manifest_for_l2(manifest)
    del manifest, head_products
    key = f"manifests/manifest-g{generation + 1:012d}-{uuid4().hex}.json"
    if pending.store._upload_to_supabase(key, merged, strict=True, overwrite=False) is not True:
        logger.warning(f"[Manifest Publish] {key} was not acknowledged; it is never swapped in")
        return False
    if not mp.cas_advance(generation, key, os.environ.get("GITHUB_RUN_ID"), store_mod._l2_writer_identity()):
        logger.warning(f"[Manifest Publish] CAS from generation {generation} lost (or its answer was lost); merging again")
        return False
    logger.info(f"[Manifest Publish] advanced g{generation}->g{generation + 1} -> {key}")
    _after_win(pending.store, generation + 1, merged)
    return True


def _after_win(store, generation, merged):
    """Best effort, in this order: retire old unique copies, then refresh the readers' fallback manifest.json."""
    try:
        from services.weather_pipeline import manifest_immutable
        manifest_immutable.prune_immutable_copies(generation)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] retention after g{generation} deferred: {exc}")
    try:
        with mp.publish_run_keyed_suppressed():
            store._upload_to_supabase("manifest.json", merged)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] legacy manifest.json refresh after g{generation} failed (the pointer win stands): {exc}")


def _publish_old_path(pending):
    """No pointer lane exists (table missing), so there is nothing to compare-and-swap: today's path, once."""
    from services.weather_pipeline.schemas import PipelineManifest
    store_mod = _store_module()
    manifest = PipelineManifest.model_validate_json(pending.snapshot)
    store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=pending.excludes)
    pending.store._upload_to_supabase("manifest.json", store_mod.dump_manifest_for_l2(manifest))
