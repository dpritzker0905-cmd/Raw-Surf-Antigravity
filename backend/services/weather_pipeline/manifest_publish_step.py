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
publish path, whatever failed, EXCEPT the one case where there is no pointer lane at all: only an answer that SAYS the relation
does not exist (42P01) latches the lane off for the process, loudly (`::error::`); any other 404 (PGRST205, a proxy page, an
empty body) is a transient failure like a 5xx (`manifest_pointer._table_missing`).

WHAT THE HEAD IS, AND WHEN THE LEGACY manifest.json MAY STAND IN FOR IT (the rule):
  (a) A head that PARSES as a manifest (a JSON object with a products list) is REAL STATE, whatever is in it. Entries that cannot be
      reconciled (not an object, or no string id) are left out of the merge, counted and logged (never quoted); every other entry,
      the ones other writers registered above all, is kept. One writer's junk can neither raise in the merge nor cost another
      writer a registration.
      A head with no usable entry at all (an empty products list, or only junk) is therefore AUTHORITATIVE-EMPTY: the legacy file is not
      consulted, and entries only the legacy file has are absent from the head that is published.
  (b) The legacy file is the base ONLY for a head that is DEFINITELY missing (`manifest_pointer.MISSING`, never a 5xx or a timeout) or
      that is not a manifest at all on UNUSABLE_HEAD_ATTEMPTS consecutive attempts of the same key. "Not a manifest" means that THIS
      interpreter cannot read it as one: not JSON, not an object, no products list, an integer literal over Python's limit
      (ValueError), or nested so deeply that json.loads raises RecursionError. Every such failure is annotated (`::error::`, see c).
  (c) ANY OTHER exception while merging a head that parses FAILS CLOSED: nothing is published, the legacy file is not consulted, and
      it does not count toward (b). A defect of OUR OWN reconcile (RecursionError in the merge included) is the same case: loud, and
      the head is never replaced by something stale. Both kinds of failure (a head that cannot be read, a merge that raised) write
      a `::error::` naming the key and the exception TYPE (never its message, which can quote an entry) on the 1st, 6th, 11th ...
      failure in a row (MERGE_FAILURE_ERROR_EVERY), a WARNING in between; each counter restarts when an attempt succeeds.
  (d) MemoryError and anything else that is not (b)'s failure to read never counts toward (b); neither does a transient fetch failure.
      An interrupt (KeyboardInterrupt, SystemExit) is not an Exception: it propagates and is never a merge failure.

After a WON CAS the job retires old unique copies (`_retire_old_copies`: this lane's OWN retention, generation <= G-5 and older
than a short grace, one listing and one batch delete), then PUTs the merged bytes to the legacy manifest.json (the readers'
fallback) with publish_run_keyed suppressed on this thread, so that PUT cannot publish a second generation. Both are best
effort: the pointer win is the commit. The merged bytes are also kept in the slot, and the caller's next call (a save, or a
prune helper about to decide what to delete) folds them into its in-memory manifest (`absorb_published_head`): the merge
moved off the caller's thread, and without this the manifest the prune helpers decide from would stay the restore-time view.

Exclusions (the ids a prune deleted) carry the sequence of the submit that named them; a publish drops those it has applied
from whatever is pending behind it, so one prune is never applied to a later publish that would erase a legitimate
re-registration by another writer.

A swap whose ANSWER is lost (a timeout or 5xx after the server may have applied it; `manifest_pointer.last_cas_answer()` says
"unknown", as opposed to a clean "lost") is the one case where we cannot know whether we are the head. The memory of such swaps
(`_Slot.attempted`, `unconfirmed`, `adopted`) belongs to the SLOT: it describes the pointer, which every snapshot shares, so it
survives a save arriving before, during or after the swap and any number of coalesced saves, with no copy to go stale. It ends at a
confirmed win (the pointer has moved, no older swap can land any more). THE RULE, using only what can be observed: (1) straight
after such a swap, and again at the start of every attempt, the pointer is read; if its head key IS an object this publish
uploaded (KEY EQUALITY alone, never a generation number: a foreign object can sit at ours), the swap landed and is settled
exactly like a confirmed win (retention, legacy refresh, the books; if the object belongs to an OLDER snapshot only that
snapshot's exclusions are spent and the head is merged against normally; either way `adopted` records that the head is this process's
own object, so no later message calls it untouched). The last ATTEMPTED_KEEP such keys are remembered, because an
earlier unconfirmed swap can land after a later attempt has already lost; a clean "lost" forgets nothing, and a swap is remembered
only once its request was actually issued (an attempt the exit budget stopped before the swap leaves nothing behind). (2) If
the head has already moved past ours, landing can no longer be observed: the row we wrote is overwritten and the objects carry no
parent link. The retry then treats the swap as NOT landed (so an entry whose object we deleted is never resurrected), with one
refinement: an excluded id whose entry in the head differs from the entry the unconfirmed attempt saw is another writer's newer
registration and is kept. That view judges only the exclusions named at or before the sequence of the snapshot whose swap saw it:
an id a LATER submit prunes again is a new deletion, and the entry in the head is what it must keep out. The view is the newest
swap's, replaced and never unioned. A re-registration byte-identical to the entry we pruned is indistinguishable from it and is excluded
once; that window is the swap's own timeout plus the backoff, and it closes at the next ingest of that frame.

The exit flush gives every network call min(its own timeout, what is left of EXIT_BUDGET_SECONDS), makes none when nothing is left,
and does not start the (retrying) legacy refresh; it bounds the flush at the budget plus at most one in-flight call.

Flag off, or the lane unavailable (pointer disabled, MANIFEST_IMMUTABLE_PUBLICATION=1, MANIFEST_MERGE_ON_UPLOAD=0, not
the designated writer): `submit_manifest_publish` is exactly the three lines it replaced at the six call sites, and
`absorb_published_head` does nothing.

Where to flip it: the L2 writers' workflow env together (forecast-ingest, forecast-ingest-pilots, precompute), not Render.

KNOWN LIMITS. (1) The pointer ROW must already exist: `read_pointer` answers None both for "no row" and for "unreadable", so an
empty table is a failed read for ever and the lane never bootstraps it (one flag-off publish creates the row). (2) THE LANE MUST BE
FLIPPED ON ALL L2 WRITERS TOGETHER (forecast-ingest, pilots, precompute): a writer still on the old path names its objects
`manifest-g<N>.json` and overwrites in place, which can land on a winner's object. (3) A head object that cannot be fetched for a
reason other than a definite miss blocks publishing until it can (fail closed: an unmerged snapshot is never published over it).
(4) RECENT POSTGREST (12+) ANSWERS A MISSING TABLE WITH 404 PGRST205, the very answer of a schema-cache reload, so the 42P01 arm
of `manifest_pointer._table_missing` is nearly dead in production and the lane treats the answer as transient. The consequence: with the
flag ON and a pointer table that genuinely does not exist, the lane FREEZES ALL PUBLISHING, manifest.json included (every attempt
fails, the snapshot stays pending, the exit flush annotates), while with the flag OFF the old path falls back to the legacy file at
once. BEFORE FLIPPING THE FLAG, verify the weather_manifest_pointer table (and its row, see 1) exists in the TARGET project. The
operator's signal is the ERROR cadence of `[Manifest Pointer] ... HTTP 404 that does not say the pointer table is gone` (1st, 6th,
11th ...; AMBIGUOUS_404_ERROR_EVERY) plus the exit annotation; the fix is the migration, never the lane, and the lane cannot
create the row or the table itself.
(5) Two caller threads can race: the snapshot is dumped BEFORE the lock and its sequence assigned INSIDE it, so thread A's older
bytes can be sequenced after thread B's newer ones and be the ones published (for instance after a prune). The window is
microseconds; the old single queue had the same inversion; a later save republishes the truth.
(6) A key that two writers update with EQUAL run_time keeps the snapshot's (possibly older) copy of the entry: reconcile only
prefers a strictly NEWER remote run, exactly as with the flag off.
(7) THE BASE OF A MERGE AGAINST A MISSING OR NON-MANIFEST HEAD IS THE LEGACY manifest.json, WHICH CAN LAG THE POINTER. When the pointed
head is missing, or is not a manifest at all (UNUSABLE_HEAD_ATTEMPTS in a row; see the rule above), the merge is made against manifest.json, and
that file is refreshed only after a win outside the exit flush (the exit flush leaves the refresh to the next publish) and by whoever
last wrote it. It can therefore carry entries another writer has since pruned (they come back) or lack recent registrations (they
are left out of THIS head; their writers' next save re-registers them). A better base exists in principle (the newest retained unique
copy that parses) but finding it needs a listing, a fetch per candidate and a rule for generations written by the other lanes; that
is more surface than this fallback, which only ever runs after the pointed head has failed UNUSABLE_HEAD_ATTEMPTS times, deserves.
It is documented, logged at ERROR with the key and the exception type, and left to the operator (repair the head object).
(8) THE GAUGE'S `standing` IS THE LISTING BEFORE THIS DELETE (at most RETENTION_SCAN_LIMIT, oldest generation first): what is left
after the delete is standing - deleted.
(9) "sent a swap whose answer never came back: whether the head moved is UNKNOWN" is OVER-CONSERVATIVE on purpose: any swap whose
answer is not a clean win or a clean "precondition lost" counts, so it is also said after a 401/404/409 answer (the swap certainly
did not apply, but nothing says so) and when the Supabase base URL is missing (cas_advance sent nothing). It can call a head that
did not move unknown; it can never call one that may have moved untouched.
(10) A head this interpreter cannot read is "not a manifest" to it, whatever another reader would make of the bytes: an integer
literal longer than Python's int-string limit (4300 digits by default) makes json.loads raise ValueError, and a head nested deeply
enough raises RecursionError. After UNUSABLE_HEAD_ATTEMPTS attempts either self-heals through the legacy file, loudly; neither is
special-cased.
(11) ONE THREAD PUBLISHES, and two things depend on it: `_effective_excludes` reads `_Slot.unconfirmed` without the lock, and
`_adopt_landed` reads the memory and clears it under two separate lock acquisitions. Both are safe only because the manifest
executor has max_workers=1 and the exit flush runs after the executor join (tests/test_manifest_one_step_head.py fails if the
executor ever gets a second worker). Fix those two before adding one.
(12) A LANE STUCK FAILING CLOSED re-downloads the head on every attempt: 5 per save-triggered job (the head is about 15.6 MB in
production), with no upload, no swap and no breaker, until the defect is fixed or the flag is turned off. It is bounded (the
attempts are backed off, the jobs coalesce) and loud (`::error::` on failures 1, 6, 11 ...), not free.
(13) The test harness (tests/_manifest_chain_harness.py) is a model, and does not exercise: PostgREST decoding of the %2F in the
`manifest_key=eq.` filter (the fake compares strings), a listing whose created_at and updated_at differ except where a test sets
them, Storage's real listing order (the fake sorts by Python string order), the timing of a 429 (stubbed), real multi-process
contention (concurrency is hook-injected in one process, plus threads in a few tests). NEVER EXAMINED: real PostgREST / Storage
behaviour, SIGTERM and cancelled runs (a cancelled GitHub run kills the process before atexit), and a real `requests` call inside
`atexit` after `threading._shutdown` (the subprocess tests prove the ORDER, with an in-memory pointer).
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
UNUSABLE_HEAD_ATTEMPTS = 3   # consecutive attempts that fetch the SAME head key and cannot parse or merge it, before it is treated like a missing one
ATTEMPTED_KEEP = 4           # swaps whose answer was lost that the slot remembers (bytes only for the newest): any of them may land late
UNTOUCHED_AT_EXIT = "never reached the pointer; the head is untouched"
UNTOUCHED_AT_GIVE_UP = ("the pointer and the legacy manifest.json are untouched (unique create-only objects left by lost attempts may "
                        "remain until retention removes them)")
MERGE_FAILURE_ERROR_EVERY = 5   # a head that cannot be read as a manifest, or a merge that raised against one that can, is annotated
                                # (::error::) the 1st, 6th, 11th ... time in a row; the counters restart when an attempt succeeds
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
    """Flag on AND this process can use the lane. Anything else is today's path, unchanged. The predicate lives in manifest_pointer
    (`one_step_lane_active`) so that the 404 standard and the dispatcher can never disagree about whether the lane is the lane."""
    return mp.one_step_lane_active()


class _Pending:
    """The newest snapshot not yet published, with the exclusions no publish has applied yet.

    `excludes` maps product id -> the submit SEQUENCE that named it. A publish of snapshot s has applied every exclusion with
    sequence <= s (the head it wrote no longer names those ids), so those are dropped from whatever is pending behind it; an id a
    LATER submit names again keeps its newer sequence and rides on. Without this an exclusion would ride on every publish for as
    long as saves keep landing during publishes, and erase another writer's later re-registration of the same key."""
    __slots__ = ("store", "snapshot", "excludes", "sequence", "merged")

    def __init__(self, store, snapshot, excludes, sequence):
        self.store, self.snapshot, self.excludes, self.sequence = store, snapshot, excludes, sequence
        self.merged = None                  # the bytes this snapshot was published as, once it has been


class _Head:
    """The last PUBLISHED (merged) manifest bytes, until the caller's in-memory manifest has absorbed them."""
    __slots__ = ("data", "absorbed")

    def __init__(self, data):
        self.data, self.absorbed = data, False


class _Slot:
    """Process-level state of the lane. The memory of swaps that may have landed unheard (`attempted`, `unconfirmed`, `adopted`) lives
    HERE and not on a snapshot: it describes the POINTER, which every snapshot shares. Kept on the pending snapshot and copied to a
    newer one at submit time it went stale whenever a save arrived before or during the swap (the copy was taken before `_remember`
    ran) and again whenever a later attempt rebound the dict on the snapshot it was running. One owner, guarded by `lock`, has no
    copy to forget. It is cleared by a confirmed win (after which an older swap can no longer land: the pointer has moved)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.pending = None                 # _Pending or None
        self.head = None                    # _Head or None
        self.sequence = 0                   # submits so far
        self.unusable = {}                  # {head key: consecutive attempts that fetched it and it was not a manifest at all}
        self.scheduled = False              # a job is queued or running on the manifest executor
        self.attempted = {}                 # {unique key: (merged bytes or None, target generation, submit sequence)} of swaps that may land
        self.unconfirmed = None             # (sequence of the newest such swap's snapshot, {excluded id: the head's entry for it, or None})
        self.adopted = False                # a swap of this process was recognised as the head without a confirmed answer (until a win)
        self.merge_failures = 0             # consecutive merges that raised against a parseable head, for the annotation cadence
        self.parse_failures = 0             # consecutive heads that could not be read as a manifest, for the same cadence


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
        slot.pending = _Pending(store, snapshot, excludes, slot.sequence)    # the swaps' memory is the slot's: nothing to carry
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
                   f"{len(left.excludes)} exclusions) {_whether_the_head_moved(UNTOUCHED_AT_EXIT)}; "
                   f"the next run must republish it")
        logger.error(message)
        sys.stdout.write(f"::error::{message}\n")
        sys.stdout.flush()


def _register_exit_flush():
    atexit.register(_flush_at_exit)


def _whether_the_head_moved(untouched: str) -> str:
    """What can honestly be said about the pointer when the pending snapshot is not published. `untouched` is the wording for the case
    where this process has sent nothing that could have moved it.

    A swap that was SENT and whose answer never came back may have landed: the head is UNKNOWN. A swap recognised as the head after the
    fact (`adopted`) means the head is this process's own earlier object. Neither is 'untouched'. Over-conservative on purpose: the
    UNKNOWN wording is also produced for a 401/404/409 answer (the swap certainly did not apply, but nothing says so) and when the
    base URL is missing (nothing was sent at all). It can say 'unknown' about a head that did not move, never the reverse."""
    with _slot.lock:
        sent, adopted = bool(_slot.attempted), _slot.adopted
    if sent:
        return ("sent a swap whose answer never came back: whether the head moved is UNKNOWN (it may carry an earlier snapshot "
                "already; a republish merges against whatever is there)")
    if adopted:
        return "never reached the pointer; the head was moved by an earlier swap of this process that landed unheard (and was recognised)"
    return untouched


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
        outcome = _whether_the_head_moved(UNTOUCHED_AT_GIVE_UP)
        logger.error(f"[Manifest Publish] NOT published after {MAX_ATTEMPTS} attempts: {outcome}; "
                     f"the snapshot and its exclude_keys stay pending for the next job.")
    except Exception as exc:
        logger.error(f"[Manifest Publish] NOT published, the job failed unexpectedly: {type(exc).__name__}: {exc}")
    return False


def _attempt(pending, number, deadline=None) -> bool:
    try:
        return _attempt_once(pending, deadline)
    except Exception as exc:
        logger.warning(f"[Manifest Publish] attempt {number}/{MAX_ATTEMPTS} failed: {type(exc).__name__}: {exc}")
        return False


def _entry_id(raw):
    """The id reconcile reads from a raw entry (`product_id`, else `filename`), or None when that is not a non-empty string."""
    pid = raw.get("product_id") or raw.get("filename") if isinstance(raw, dict) else None
    return pid if isinstance(pid, str) and pid else None


class _NotAManifest(ValueError):
    """The bytes are not a manifest this interpreter can read. `kind` is the exception TYPE to name in a log or an annotation."""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


def _head_products(head_bytes, source="the head"):
    """The raw product list of a manifest object. `_NotAManifest` (a ValueError) when the bytes are not a manifest AT ALL: not JSON,
    not an object, no products list, an integer literal over Python's limit, or nested so deeply that json.loads raises RecursionError
    (a head this interpreter cannot read is not a manifest to it). That is the only case the legacy file may stand in for. Anything
    that parses as a manifest is real state, and an empty or all-junk products list is authoritative-empty. Entries that cannot be
    reconciled (not an object, or no string id) are left out of the merge, counted and logged (never quoted), and every other entry is
    kept, so one writer's junk can neither raise in the merge nor cost another writer its registrations."""
    try:
        doc = json.loads(head_bytes)                 # (a ValueError, JSONDecodeError and an over-long integer literal included, passes through)
    except RecursionError:                           # (MemoryError and anything else is a failed attempt that counts for nothing)
        raise _NotAManifest("RecursionError", "the head object is nested too deeply to parse") from None
    products = doc.get("products") if isinstance(doc, dict) else None
    if not isinstance(products, list):
        raise _NotAManifest("ValueError", "the head object is not a manifest")
    usable = [raw for raw in products if _entry_id(raw)]
    if len(usable) != len(products):
        logger.warning(f"[Manifest Publish] {len(products) - len(usable)} of {len(products)} entries in {source} are not usable "
                       f"(not an object, or no string id) and were left out of the merge")
    return usable


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
        return _head_products(reply.content, "the legacy manifest.json") if reply.status_code == 200 else None
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
    slot = _slot
    key = row.get("manifest_key") if isinstance(row, dict) else None
    with slot.lock:
        landed = slot.attempted.get(key)
    if landed is None:
        return False
    merged, generation, sequence = landed
    if sequence != pending.sequence:
        # An OLDER snapshot's swap landed (its job ran out of attempts before it could look). Nothing of THIS snapshot is published,
        # so there is nothing to settle; what that swap applied is spent, and the head is an ordinary one to merge against. The head
        # IS this process's own object, though (`adopted`): until a win says otherwise, 'untouched' is not a thing to claim about it.
        logger.warning(f"[Manifest Publish] the head {key} is an older snapshot's swap, which landed unconfirmed; its exclusions are spent")
        pending.excludes = {k: n for k, n in pending.excludes.items() if n > sequence}
        with slot.lock:
            slot.attempted, slot.unconfirmed, slot.adopted = {}, None, True
        return False
    if merged is None:                                                   # an earlier attempt of THIS snapshot: its bytes were let go ...
        got = mp.fetch_manifest_object(key, **_timeout_kw(deadline, 30))  # ... and the head object IS those bytes
        merged = got if isinstance(got, (bytes, bytearray)) else None
    logger.warning(f"[Manifest Publish] the swap to g{generation} -> {key} landed although its answer was lost; settling it as a win")
    pending.merged = merged
    with slot.lock:
        slot.attempted, slot.unconfirmed, slot.adopted = {}, None, True
    _after_win(pending.store, generation, key, merged, deadline)
    return True


def _remember(pending, key, merged, generation, view):
    """A swap was SENT and its answer is unknown: it may land at any time from now on. Remember its key (by key equality alone, never
    by generation) next to the last few earlier ones, and the entries of the excluded ids as that attempt saw them. Only the newest
    attempt keeps its bytes; a clean loss never reaches here, so it can neither forget an earlier unknown swap nor reset `view`.
    The memory is the SLOT's, so it does not matter which snapshot is pending, or was submitted when, relative to this call. The view
    is the NEWEST unknown swap's (replaced, never unioned with an older one) and carries the sequence of the snapshot that sent it:
    see `_effective_excludes` for what that bounds."""
    with _slot.lock:
        kept = {k: (None, g, n) for k, (_, g, n) in _slot.attempted.items()}
        kept[key] = (merged, generation, pending.sequence)
        while len(kept) > ATTEMPTED_KEEP:
            del kept[next(iter(kept))]
        _slot.attempted, _slot.unconfirmed = kept, (pending.sequence, view)


def _effective_excludes(pending, head_products):
    """The ids to keep out of this merge. After a swap that MAY have landed (its answer was lost), an excluded id whose entry in the
    head has CHANGED since that attempt saw it is another writer's newer registration of the same key, not the entry whose object we
    deleted: it is kept, and its exclusion is spent. Everything else stays excluded. (After a swap that certainly did not land there
    is nothing to refine: `unconfirmed` is None.)

    The view judges ONLY exclusions named at or before the sequence of the snapshot whose swap saw it. An id named by a LATER submit
    is a later prune: its object was deleted AFTER that swap, so a different entry in the head is not 'a re-registration since the
    swap' but exactly what that prune must keep out. (Unlocked read: safe only because one thread publishes; see KNOWN LIMITS 11.)"""
    excludes = set(pending.excludes)
    memory = _slot.unconfirmed
    if not memory or not excludes:
        return excludes
    swap_sequence, seen = memory
    judged = {pid for pid in excludes if pid in seen and pending.excludes[pid] <= swap_sequence}
    now = _entries_by_id(head_products, judged)
    changed = {pid for pid, entry in now.items() if entry != seen.get(pid)}
    if changed:
        logger.warning(f"[Manifest Publish] {len(changed)} excluded id(s) were registered again since the unconfirmed swap "
                       f"(e.g. {sorted(changed)[0]}): kept")
        excludes -= changed
        pending.excludes = {k: n for k, n in pending.excludes.items() if k not in changed}
    return excludes


def _merge(pending, head_products):
    """The ORIGINAL snapshot merged into `head_products`: (merged bytes, the ids excluded, the head's entries for them)."""
    from services.weather_pipeline.schemas import PipelineManifest
    store_mod = _store_module()
    excludes = _effective_excludes(pending, head_products)
    manifest = PipelineManifest.model_validate_json(pending.snapshot)
    store_mod.reconcile_manifest_products_for_upload(manifest, exclude_keys=excludes, remote_products=head_products)
    merged = store_mod.dump_manifest_for_l2(manifest)
    return merged, excludes, (_entries_by_id(head_products, excludes) if excludes else {})


class _MergeFailed(Exception):
    """The merge raised against a head that parses. Carries the exception TYPE only: a message can quote an entry."""


def _annotate(count, message):
    """A failure that repeats: a WARNING, and the 1st, 6th, 11th ... time in a row also an ERROR and a GitHub `::error::` annotation."""
    if count % MERGE_FAILURE_ERROR_EVERY == 1:
        logger.error(message)
        sys.stdout.write(f"::error::{message}\n")
        sys.stdout.flush()
    else:
        logger.warning(message)


def _merge_closed(pending, products, source):
    """`_merge` for a head that is real state (it parsed as a manifest) or the legacy base. Any exception FAILS CLOSED: nothing is
    published, the legacy manifest.json does not stand in for a head that parses, and it does not count toward that fallback. Loud:
    a `::error::` naming the source and the exception type (never its message) the 1st, 6th, 11th ... time."""
    try:
        merged = _merge(pending, products)
    except Exception as exc:                    # (KeyboardInterrupt and SystemExit are not Exceptions: they propagate, uncounted)
        _slot.merge_failures += 1
        _annotate(_slot.merge_failures, f"[Manifest Publish] merging the snapshot against {source} raised {type(exc).__name__}: failing "
                  f"closed, nothing is published until this is fixed (failure #{_slot.merge_failures}); the legacy manifest.json is "
                  f"not a base for a head that parses")
        raise _MergeFailed(f"the merge raised {type(exc).__name__}") from None
    _slot.merge_failures = 0                    # a merge that works ends the episode: the next failure is annotated as the first
    return merged


def _attempt_once(pending, deadline=None) -> bool:
    """One read-merge-CAS. True = published (or, with no pointer lane at all, written the old way). False = try again.
    `deadline`: set only by the exit flush; every network call is then capped by what is left of it (see `_timeout_kw`)."""
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
    legacy = merge = None
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
            products = _head_products(head_bytes, head_key)
        except ValueError as exc:                                        # NOT A MANIFEST AT ALL (see `_head_products`)
            kind = getattr(exc, "kind", type(exc).__name__)              # (MemoryError and anything else: a failed attempt that counts
            _slot.parse_failures += 1                                    # for nothing; a transient fetch failure never gets here)
            _annotate(_slot.parse_failures, f"[Manifest Publish] the head object {head_key} could not be read as a manifest ({kind}; "
                      f"failure #{_slot.parse_failures}); after {UNUSABLE_HEAD_ATTEMPTS} attempts on the same key the publish merges "
                      f"against the legacy manifest.json")
            failures = _slot.unusable.get(head_key, 0)
            if failures < UNUSABLE_HEAD_ATTEMPTS:
                _slot.unusable = {head_key: failures + 1}
                raise
            legacy = f"the head object {head_key} is not a manifest ({kind}) in {failures} consecutive attempts"
            logger.error(f"[Manifest Publish] {legacy}; treating it as unusable and merging against the legacy manifest.json instead "
                         f"(which can lag the pointer: see KNOWN LIMITS)")
        else:
            _slot.unusable, _slot.parse_failures = {}, 0
            merge = _merge_closed(pending, products, head_key)
            del products
    del head_bytes
    if legacy is not None:
        legacy_products = _legacy_products(deadline)
        if legacy_products is None:
            logger.warning("[Manifest Publish] the legacy manifest.json could not be read either")
            return False
        merge = _merge_closed(pending, legacy_products, "the legacy manifest.json")
        del legacy_products
    merged, excludes, seen = merge
    key = f"manifests/manifest-g{generation + 1:012d}-{uuid4().hex}.json"
    if pending.store._upload_to_supabase(key, merged, strict=True, overwrite=False, **_timeout_kw(deadline, 30)) is not True:
        logger.warning(f"[Manifest Publish] {key} was not acknowledged; it is never swapped in")
        return False
    if not mp.cas_advance(generation, key, os.environ.get("GITHUB_RUN_ID"), store_mod._l2_writer_identity(),
                          expected_key=head_key, **_timeout_kw(deadline, 8)):
        if mp.last_cas_answer() == "lost":                               # a clean "precondition missed": it certainly did not apply
            logger.warning(f"[Manifest Publish] CAS from generation {generation} lost to another writer; merging again")
            return False
        _remember(pending, key, merged, generation + 1, {pid: seen.get(pid) for pid in excludes})      # the swap WAS sent: it may land
        logger.warning(f"[Manifest Publish] CAS from generation {generation} was not confirmed; looking at the pointer")
        return _adopt_landed(pending, mp.read_pointer(**_timeout_kw(deadline, 8)), deadline)
    pending.merged = merged
    with _slot.lock:                                                     # a confirmed win: the pointer moved, no older swap can land now
        _slot.attempted, _slot.unconfirmed, _slot.adopted = {}, None, False
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
        removed = 0
        if doomed:
            deleted = requests.delete(f"{base}/storage/v1/object/{WEATHER_BUCKET}", headers=headers, json={"prefixes": doomed},
                                      timeout=_cap(deadline, RETENTION_TIMEOUT_SECONDS))
            if deleted.status_code in (200, 204):
                removed = len(doomed)
            else:
                logger.warning(f"[Manifest Publish] retention delete of {len(doomed)} copies not acknowledged (HTTP {deleted.status_code})")
        # The gauge: storage growth (about 16 MB a copy) is otherwise invisible until a quota says so. `standing` is the listing as it
        # was BEFORE this delete (what is left is standing - removed).
        standing = sum(1 for row in rows[:RETENTION_SCAN_LIMIT] if isinstance(row, dict) and isinstance(row.get("name"), str)
                       and _COPY_NAME.fullmatch(row["name"]))
        capped = f" (listing capped at {RETENTION_SCAN_LIMIT}: there may be more)" if len(rows) >= RETENTION_SCAN_LIMIT else ""
        logger.info(f"[Manifest Publish] retention at g{generation}: {standing} unique manifest copies standing before this delete{capped}, "
                    f"{removed} deleted")
    except Exception as exc:
        logger.warning(f"[Manifest Publish] retention after g{generation} deferred: {type(exc).__name__}: {exc}")


def _after_win(store, generation, head_key, merged, deadline=None):
    """Best effort, in this order: retire old unique copies, then refresh the readers' fallback manifest.json. In the exit flush
    (`deadline` set) the refresh is left to the next publish: it is a PUT that retries, and the budget is a promise. Without the
    merged bytes (an older attempt adopted whose object could not be fetched) there is nothing to refresh it with either."""
    _retire_old_copies(generation, head_key, deadline)
    if deadline is not None or merged is None:
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
