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
    e. cas_advance(g, key, ..., expected_key=head)  the SAME g, and the SAME head object, the merge was made against

and nothing that fails ever publishes the snapshot unmerged: an unreadable pointer, an unreadable head, an upload that
was not acknowledged, a CAS that lost (or whose answer was lost) all send the attempt back to step a. After
MAX_ATTEMPTS the pointer, the unique objects and the legacy manifest.json are untouched, the failure is logged at ERROR
and the snapshot stays pending for the next job (and, at interpreter exit, `_flush_at_exit` tries again on the main thread
with a bounded extra budget and raises a GitHub error annotation if it still cannot). There is NO fall-back to the old
publish path, whatever failed, EXCEPT the one case where there is no pointer lane at all (the table is missing: permanent,
nothing to protect). One more case is not a failure: when Storage says DEFINITELY that the head object does not exist
(`manifest_pointer.MISSING`, never a 5xx or a timeout), the merge is made against the legacy manifest.json, and the swap still
names g and the missing key, so a concurrent writer wins over us.

After a WON CAS the job retires old unique copies (`_retire_old_copies`: this lane's OWN retention, generation <= G-5 and older
than a short grace, one listing and one batch delete), then PUTs the merged bytes to the legacy manifest.json (the readers'
fallback) with publish_run_keyed suppressed on this thread, so that PUT cannot publish a second generation. Both are best
effort: the pointer win is the commit. The merged bytes are also kept in the slot, and the caller's next call (a save, or a
prune helper about to decide what to delete) folds them into its in-memory manifest (`absorb_published_head`): the merge
moved off the caller's thread, and without this the manifest the prune helpers decide from would stay the restore-time view.

Exclusions (the ids a prune deleted) carry the sequence of the submit that named them; a publish drops those it has applied
from whatever is pending behind it, so one prune is never applied to a later publish that would erase a legitimate
re-registration by another writer.

Flag off, or the lane unavailable (pointer disabled, MANIFEST_IMMUTABLE_PUBLICATION=1, MANIFEST_MERGE_ON_UPLOAD=0, not
the designated writer): `submit_manifest_publish` is exactly the three lines it replaced at the six call sites, and
`absorb_published_head` does nothing.

Where to flip it: the L2 writers' workflow env together (forecast-ingest, forecast-ingest-pilots, precompute), not Render.

KNOWN LIMITS. (1) The pointer ROW must already exist: `read_pointer` answers None both for "no row" and for "unreadable", so an
empty table is a failed read for ever and the lane never bootstraps it (one flag-off publish creates the row). (2) Flip the flag on
every L2 writer together: a writer still on the old path names its objects `manifest-g<N>.json` and overwrites in place, which can
land on a winner's object. (3) A head object that cannot be fetched for a reason other than a definite miss blocks publishing
until it can (fail closed: an unmerged snapshot is never published over it).
"""
import atexit
import json
import logging
import os
import random
import re
import sys
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

from services.weather_pipeline import manifest_pointer as mp

logger = logging.getLogger(__name__)

FLAG = "MANIFEST_PUBLISH_ONE_STEP"
MAX_ATTEMPTS = 5
UNUSABLE_HEAD_ATTEMPTS = 3   # consecutive attempts that fetch the SAME head key and cannot parse it, before it is treated like a missing one
BACKOFF_BASE_SECONDS = 0.25
BACKOFF_CAP_SECONDS = 3.0
EXIT_ROUNDS = 3              # extra rounds of MAX_ATTEMPTS at interpreter exit (see _flush_at_exit)
EXIT_BUDGET_SECONDS = 120.0  # and the wall-clock ceiling on all of them
RETENTION_KEEP_GENERATIONS = 5   # after a win at generation G, objects of generation <= G-5 may be retired ...
RETENTION_GRACE_SECONDS = 60     # ... once they are also this old (a reader mid-GET of a recent head is safe)
RETENTION_SCAN_LIMIT = 100       # rows of ONE listing (oldest generation first)
RETENTION_DELETE_LIMIT = 50      # keys of ONE batch delete
RETENTION_TIMEOUT_SECONDS = 5
_COPY_NAME = re.compile(r"manifest-g(\d{12})-[0-9a-f]{32}\.json")
_sleep = time.sleep          # injectable: tests must not wait
_monotonic = time.monotonic
_utcnow = lambda: datetime.now(timezone.utc)  # noqa: E731  (injectable: the retention grace)


def _store_module():
    from services.weather_pipeline import store
    return store


class _OutOfBudget(Exception):
    """The exit flush's wall-clock budget is spent: the next network call is not made."""


def _timeout_kw(deadline, default):
    """Keyword arguments for ONE network call. Outside the exit flush (no deadline): none, the call keeps its own timeout. Inside it:
    the call's own default or what is left of the budget, whichever is LESS; and when nothing is left the call is not made."""
    if deadline is None:
        return {}
    left = deadline - _monotonic()
    if left <= 0:
        raise _OutOfBudget("the exit budget is spent")
    return {"timeout": min(default, left)}


def _cap(deadline, default):
    return _timeout_kw(deadline, default).get("timeout", default)


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
    """The newest snapshot not yet published, with the exclusions no publish has applied yet.

    `excludes` maps product id -> the submit SEQUENCE that named it. A publish of snapshot s has applied every exclusion with
    sequence <= s (the head it wrote no longer names those ids), so those are dropped from whatever is pending behind it; an id a
    LATER submit names again keeps its newer sequence and rides on. Without this an exclusion would ride on every publish for as
    long as saves keep landing during publishes, and erase another writer's later re-registration of the same key."""
    __slots__ = ("store", "snapshot", "excludes", "sequence", "merged", "attempted", "unconfirmed")

    def __init__(self, store, snapshot, excludes, sequence):
        self.store, self.snapshot, self.excludes, self.sequence = store, snapshot, excludes, sequence
        self.merged = None                  # the bytes this snapshot was published as, once it has been
        self.attempted = {}                 # {unique key: (merged bytes, target generation)} of the newest swap that may have landed
        self.unconfirmed = None             # {excluded id: the head's entry for it, or None} as seen by that swap's attempt


class _Head:
    """The last PUBLISHED (merged) manifest bytes, until the caller's in-memory manifest has absorbed them."""
    __slots__ = ("data", "absorbed")

    def __init__(self, data):
        self.data, self.absorbed = data, False


class _Slot:
    def __init__(self):
        self.lock = threading.Lock()
        self.pending = None                 # _Pending or None
        self.head = None                    # _Head or None
        self.sequence = 0                   # submits so far
        self.unusable = {}                  # {head key: consecutive attempts that fetched it and could not parse it}
        self.scheduled = False              # a job is queued or running on the manifest executor


_slot = _Slot()


def submit_manifest_publish(store, manifest, exclude_keys=None):
    """Publish `manifest` (this process's cumulative in-memory registry) to L2.

    `exclude_keys`: product ids this call pruned (their objects are deleted), which a head that still names them must
    not bring back. Raises what the three lines it replaces raised; the call sites already log that."""
    if not one_step_active():
        _submit_legacy(store, manifest, exclude_keys)
        return
    exclude_keys = list(exclude_keys or ())
    absorb_published_head(manifest, exclude_keys)                         # BEFORE the dump: the snapshot carries what it folds in
    snapshot = _store_module().dump_manifest_for_l2(manifest)            # serialization only: no I/O on this thread
    slot = _slot
    with slot.lock:
        slot.sequence += 1
        excludes = dict(slot.pending.excludes) if slot.pending is not None else {}     # snapshots are cumulative: they add up
        excludes.update(dict.fromkeys(exclude_keys, slot.sequence))
        newest = _Pending(store, snapshot, excludes, slot.sequence)
        if slot.pending is not None:                                      # a swap that may have landed unheard belongs to the lineage
            newest.attempted, newest.unconfirmed = slot.pending.attempted, slot.pending.unconfirmed
        slot.pending = newest
        schedule = not slot.scheduled
        slot.scheduled = True
    if schedule:
        try:
            _store_module()._manifest_executor.submit(_drain, slot)
        except BaseException:
            with slot.lock:
                slot.scheduled = False                                    # nothing is running: do not wedge the slot
            raise


def absorb_published_head(manifest, extra_excludes=()):
    """Fold the last PUBLISHED head into the caller's in-memory manifest (no I/O), once per publish cycle.

    With the lane on, the merge happens on the executor thread, so without this the manifest the caller keeps working from stays
    the restore-time view for ever, and the prune helpers decide from it and delete objects BY KEY (`product_id` is the filename,
    no run time in it): they would delete another writer's fresher object stored under the same key. This is what flag off's
    caller-thread reconcile did, with a lag of one publish. Exclusions still pending (and `extra_excludes`, the ids this call is
    pruning) are not folded back. A failure here costs freshness, never a publish: the head stays un-absorbed and is tried again.
    A no-op unless the lane is active, so flag off is untouched."""
    if not one_step_active():
        return
    slot = _slot
    with slot.lock:
        head = slot.head
        if head is None or head.absorbed:
            return
        data = head.data
        excludes = set(slot.pending.excludes) if slot.pending is not None else set()
    excludes.update(extra_excludes)
    try:
        _store_module().reconcile_manifest_products_for_upload(
            manifest, exclude_keys=excludes, remote_products=_head_products(data))
    except Exception as exc:
        logger.warning(f"[Manifest Publish] could not absorb the published head into the in-memory manifest: {type(exc).__name__}: {exc}")
        return
    with slot.lock:
        if slot.head is head:
            head.absorbed, head.data = True, None


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
            if not _settle(slot, current, _publish(current)):
                return
    except BaseException:
        with slot.lock:
            slot.scheduled = False
        raise


def _settle(slot, current, published) -> bool:
    """The books after one publish of `current`. True = a newer snapshot is waiting and is published next."""
    with slot.lock:
        if published and current.merged is not None:
            slot.head = _Head(current.merged)                             # for the caller's next absorb
        if published and slot.pending is current:
            slot.pending = None
        elif published and slot.pending is not None:                      # a newer snapshot stays, minus what this one applied
            slot.pending.excludes = {k: n for k, n in slot.pending.excludes.items() if n > current.sequence}
        if slot.pending is None or slot.pending is current:
            slot.scheduled = False                                        # drained, or failed with nothing newer to try
            return False
        return True


def _flush_at_exit():
    """atexit: publish what is still pending, on the main thread, with a bounded extra budget (EXIT_ROUNDS more rounds of
    MAX_ATTEMPTS, never past EXIT_BUDGET_SECONDS), and say so loudly if it still cannot.

    CPython joins the thread-pool executor's workers BEFORE it runs atexit hooks, so by now the job that exhausted its attempts
    is finished and nothing else will ever look at its snapshot: without this the last save of a CI run is lost in silence."""
    slot = _slot
    deadline = _monotonic() + EXIT_BUDGET_SECONDS
    for _ in range(EXIT_ROUNDS):
        with slot.lock:
            current = slot.pending
        if current is None or _monotonic() >= deadline:
            break
        _settle(slot, current, _publish(current, deadline))
    with slot.lock:
        left = slot.pending
    if left is not None:
        message = (f"[Manifest Publish] NOT published at exit: the last manifest snapshot ({len(left.snapshot)} bytes, "
                   f"{len(left.excludes)} exclusions) never reached the pointer; the head is untouched and the next run must republish it")
        logger.error(message)
        sys.stdout.write(f"::error::{message}\n")
        sys.stdout.flush()


def _register_exit_flush():
    atexit.register(_flush_at_exit)


def _publish(pending, deadline=None) -> bool:
    """True when the snapshot is published. Never raises. `deadline` (a _monotonic() reading) stops the attempts early."""
    try:
        for number in range(1, MAX_ATTEMPTS + 1):
            if number > 1:
                if deadline is not None and _monotonic() >= deadline:
                    break
                _sleep(backoff_seconds(number - 1))
            if _attempt(pending, number, deadline):
                return True
        logger.error(
            f"[Manifest Publish] NOT published after {MAX_ATTEMPTS} attempts: the pointer, the unique manifest objects "
            f"and the legacy manifest.json are untouched; the snapshot and its exclude_keys stay pending for the next job.")
    except Exception as exc:
        logger.error(f"[Manifest Publish] NOT published, the job failed unexpectedly: {type(exc).__name__}: {exc}")
    return False


def _attempt(pending, number, deadline=None) -> bool:
    try:
        return _attempt_once(pending, deadline)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] attempt {number}/{MAX_ATTEMPTS} failed: {type(exc).__name__}: {exc}")
        return False


def _head_products(head_bytes):
    doc = json.loads(head_bytes)
    products = doc.get("products") if isinstance(doc, dict) else None
    if not isinstance(products, list):
        raise ValueError("the head object is not a manifest")
    return products


def _legacy_products(deadline=None):
    """The legacy manifest.json's products, read DIRECTLY (cache-busted GET), never through the pointer: the pointed head is exactly
    what is missing or unusable when this is called. None when it cannot be read or is not a manifest."""
    base, headers = mp._rest_base_and_headers()
    if not base:
        return None
    try:
        import requests
        store_mod = _store_module()
        reply = requests.get(store_mod.manifest_download_url(base, store_mod.WEATHER_BUCKET), headers={
            **headers, "Cache-Control": "no-cache", "Pragma": "no-cache"}, **(_timeout_kw(deadline, 15) or {"timeout": 15}))
        return _head_products(reply.content) if reply.status_code == 200 else None
    except Exception as exc:
        logger.warning(f"[Manifest Publish] the legacy manifest.json could not be read: {type(exc).__name__}: {exc}")
        return None


def _entries_by_id(products, ids):
    """{id: raw entry} for the `ids` the raw product list names."""
    found = {}
    for raw in products:
        pid = (raw.get("product_id") or raw.get("filename")) if isinstance(raw, dict) else None
        if pid in ids:
            found[pid] = raw
    return found


def _adopt_landed(pending, row, deadline=None) -> bool:
    """True when the pointer names an object THIS publish uploaded: its swap landed although the answer never came back. It is then
    settled exactly like a confirmed win (retention, the legacy refresh, the books), instead of being merged and published again."""
    key = row.get("manifest_key") if isinstance(row, dict) else None
    landed = pending.attempted.get(key)
    if landed is None:
        return False
    merged, generation, sequence = landed
    if sequence != pending.sequence:
        # An OLDER snapshot's swap landed (its job ran out of attempts before it could look). Nothing of THIS snapshot is published,
        # so there is nothing to settle; what that swap applied is spent, and the head is an ordinary one to merge against.
        logger.warning(f"[Manifest Publish] the head {key} is an older snapshot's swap, which landed unconfirmed; its exclusions are spent")
        pending.excludes = {k: n for k, n in pending.excludes.items() if n > sequence}
        pending.attempted, pending.unconfirmed = {}, None
        return False
    logger.warning(f"[Manifest Publish] the swap to g{generation} -> {key} landed although its answer was lost; settling it as a win")
    pending.merged, pending.attempted, pending.unconfirmed = merged, {}, None
    _after_win(pending.store, generation, key, merged, deadline)
    return True


def _effective_excludes(pending, head_products):
    """The ids to keep out of this merge. After a swap that MAY have landed (its answer was lost), an excluded id whose entry in the
    head has CHANGED since that attempt saw it is another writer's newer registration of the same key, not the entry whose object we
    deleted: it is kept, and its exclusion is spent. Everything else stays excluded. (After a swap that certainly did not land there
    is nothing to refine: `unconfirmed` is None.)"""
    excludes = set(pending.excludes)
    seen = pending.unconfirmed
    if not seen or not excludes:
        return excludes
    now = _entries_by_id(head_products, excludes & set(seen))
    changed = {pid for pid, entry in now.items() if entry != seen.get(pid)}
    if changed:
        logger.warning(f"[Manifest Publish] {len(changed)} excluded id(s) were registered again since the unconfirmed swap "
                       f"(e.g. {sorted(changed)[0]}): kept")
        excludes -= changed
        pending.excludes = {k: n for k, n in pending.excludes.items() if k not in changed}
    return excludes


def _attempt_once(pending, deadline=None) -> bool:
    """One read-merge-CAS. True = published (or, with no pointer lane at all, written the old way). False = try again.
    `deadline`: set only by the exit flush; every network call is then capped by what is left of it (see `_timeout_kw`)."""
    from services.weather_pipeline.schemas import PipelineManifest
    store_mod = _store_module()
    row = mp.read_pointer(**_timeout_kw(deadline, 8))
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
    if _adopt_landed(pending, row, deadline):
        return True
    head_bytes = mp.fetch_manifest_object(head_key, **_timeout_kw(deadline, 30))
    legacy = None
    if head_bytes is mp.MISSING:
        # The pointer names an object that does not exist (an old-path writer's failed upload, or a deletion). Merge against the
        # legacy manifest.json instead. The swap below still names generation g AND this key, so a writer that commits meanwhile
        # wins over us, and a STALE legacy file can never replace a head that moved.
        legacy = f"the head object {head_key} is missing"
        logger.warning(f"[Manifest Publish] {legacy}; merging against the legacy manifest.json")
    elif head_bytes is None:
        logger.warning(f"[Manifest Publish] the head object {head_key} could not be read")
        return False
    else:
        try:
            head_products = _head_products(head_bytes)
            _slot.unusable = {}
        except ValueError as exc:                                        # not JSON, or not a manifest
            failures = _slot.unusable.get(head_key, 0)
            if failures < UNUSABLE_HEAD_ATTEMPTS:
                _slot.unusable = {head_key: failures + 1}                # a transient fetch failure never gets this far: it does not count
                raise
            legacy = f"the head object {head_key} could not be parsed in {failures} consecutive attempts ({exc})"
            logger.error(f"[Manifest Publish] {legacy}; treating it as unusable and merging against the legacy manifest.json")
    if legacy is not None:
        head_products = _legacy_products(deadline)
        if head_products is None:
            logger.warning("[Manifest Publish] the legacy manifest.json could not be read either")
            return False
    del head_bytes
    excludes = _effective_excludes(pending, head_products)
    manifest = PipelineManifest.model_validate_json(pending.snapshot)     # the ORIGINAL snapshot, every attempt
    store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=excludes, remote_products=head_products)
    merged = store_mod.dump_manifest_for_l2(manifest)
    seen = _entries_by_id(head_products, excludes) if excludes else {}
    del manifest, head_products
    key = f"manifests/manifest-g{generation + 1:012d}-{uuid4().hex}.json"
    if pending.store._upload_to_supabase(key, merged, strict=True, overwrite=False, **_timeout_kw(deadline, 30)) is not True:
        logger.warning(f"[Manifest Publish] {key} was not acknowledged; it is never swapped in")
        return False
    pending.attempted = {key: (merged, generation + 1, pending.sequence)}      # from here on this swap MAY land unheard
    pending.unconfirmed = {pid: seen.get(pid) for pid in excludes}
    if not mp.cas_advance(generation, key, os.environ.get("GITHUB_RUN_ID"), store_mod._l2_writer_identity(),
                          expected_key=head_key, **_timeout_kw(deadline, 8)):
        if mp.last_cas_answer() == "lost":                               # a clean "precondition missed": it certainly did not apply
            pending.attempted, pending.unconfirmed = {}, None
            logger.warning(f"[Manifest Publish] CAS from generation {generation} lost to another writer; merging again")
            return False
        logger.warning(f"[Manifest Publish] CAS from generation {generation} was not confirmed; looking at the pointer")
        return _adopt_landed(pending, mp.read_pointer(**_timeout_kw(deadline, 8)), deadline)
    pending.merged, pending.attempted, pending.unconfirmed = merged, {}, None
    logger.info(f"[Manifest Publish] advanced g{generation}->g{generation + 1} -> {key}")
    _after_win(pending.store, generation + 1, key, merged, deadline)
    return True


def _retire_old_copies(generation, head_key, deadline=None):
    """After a WON swap at `generation`: ONE bounded listing and ONE bounded batch delete of the unique copies this lane leaves.

    manifest_immutable's retention keeps every copy younger than an hour whatever its generation, which suits a writer that
    publishes every few minutes and not this lane (a publish after every coalesced save: 300 copies at 8 s spacing, none
    deleted, about 16 MB each). Here a copy goes once its generation is <= G-5 AND it is older than a short grace. The object the
    pointer names is never touched, nor is anything newer than G-5, nor a name or a timestamp this cannot read. Unique objects
    from LOST attempts carry a stale generation number and are retired by the same rule. Never raises."""
    try:
        cutoff = generation - RETENTION_KEEP_GENERATIONS
        base, headers = mp._rest_base_and_headers()
        if cutoff < 1 or not base:
            return
        import requests
        from services.weather_pipeline.store import WEATHER_BUCKET
        listing = requests.post(
            f"{base}/storage/v1/object/list/{WEATHER_BUCKET}", headers=headers,
            timeout=_cap(deadline, RETENTION_TIMEOUT_SECONDS),
            json={"prefix": "manifests", "search": "manifest-g", "limit": RETENTION_SCAN_LIMIT, "offset": 0,
                  "sortBy": {"column": "name", "order": "asc"}})
        rows = listing.json() if listing.status_code == 200 else None
        if not isinstance(rows, list):
            return
        now, doomed = _utcnow(), []
        for row in rows[:RETENTION_SCAN_LIMIT]:
            name = row.get("name") if isinstance(row, dict) else None
            match = _COPY_NAME.fullmatch(name) if isinstance(name, str) else None
            key = f"manifests/{name}" if match else None
            if not match or int(match[1]) > cutoff or key == head_key:
                continue
            try:
                stamps = [datetime.fromisoformat(row[field].replace("Z", "+00:00")) for field in ("created_at", "updated_at") if row.get(field)]
                if (now - max(stamps)).total_seconds() < RETENTION_GRACE_SECONDS:      # no stamp: max() raises; naive stamp: the
                    continue                                                           # subtraction raises; both fail closed below
            except (TypeError, ValueError, AttributeError):
                continue
            doomed.append(key)
            if len(doomed) == RETENTION_DELETE_LIMIT:
                break
        if doomed:
            deleted = requests.delete(f"{base}/storage/v1/object/{WEATHER_BUCKET}", headers=headers, json={"prefixes": doomed},
                                      timeout=_cap(deadline, RETENTION_TIMEOUT_SECONDS))
            if deleted.status_code not in (200, 204):
                logger.warning(f"[Manifest Publish] retention delete of {len(doomed)} copies not acknowledged (HTTP {deleted.status_code})")
    except Exception as exc:
        logger.warning(f"[Manifest Publish] retention after g{generation} deferred: {type(exc).__name__}: {exc}")


def _after_win(store, generation, head_key, merged, deadline=None):
    """Best effort, in this order: retire old unique copies, then refresh the readers' fallback manifest.json. In the exit flush
    (`deadline` set) the refresh is left to the next publish: it is a PUT that retries, and the budget is a promise."""
    _retire_old_copies(generation, head_key, deadline)
    if deadline is not None:
        return
    try:
        with mp.publish_run_keyed_suppressed():
            store._upload_to_supabase("manifest.json", merged)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] legacy manifest.json refresh after g{generation} failed (the pointer win stands): {exc}")


def _publish_old_path(pending):
    """The pointer table is definitely gone (`manifest_pointer` latched on an answer that SAYS so), so there is nothing to
    compare-and-swap: today's path, once. Loud, because pointer-first readers never look at manifest.json."""
    from services.weather_pipeline.schemas import PipelineManifest
    message = ("[Manifest Publish] the pointer table is missing: this snapshot goes to manifest.json only, and pointer-first "
               "readers will NOT see it (nor anything else this process registers from now on)")
    logger.error(message)
    sys.stdout.write(f"::error::{message}\n")
    sys.stdout.flush()
    store_mod = _store_module()
    manifest = PipelineManifest.model_validate_json(pending.snapshot)
    store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=set(pending.excludes))
    pending.store._upload_to_supabase("manifest.json", store_mod.dump_manifest_for_l2(manifest))


_register_exit_flush()
