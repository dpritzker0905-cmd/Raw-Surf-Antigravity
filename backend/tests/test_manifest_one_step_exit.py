"""MANIFEST_PUBLISH_ONE_STEP: a publish that exhausted its attempts is not abandoned at interpreter exit (round-4 finding P2).

A job that fails five times leaves its snapshot pending "for the next job", but the last save of a CI run has no next job: the
process exits with the registration (or the prune) unpublished and nothing says so. An `atexit` hook, which CPython runs AFTER
the thread-pool executor's own join, publishes whatever is still pending on the main thread with a bounded extra budget, and
raises a GitHub error annotation if it still cannot."""
import logging
import os
import subprocess
import sys
import textwrap
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, LATTICE, PILOTS_NEW, RUN_TIME, UNIQUE_KEY, _keep_moving, _raw_wind, _snapshot, chain, parked, sleeps, store, submit,
)

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _exhaust_one_job_on_a_real_executor(chain, store, monkeypatch, exclude=None):
    """Another writer commits inside each of the job's five CAS windows, then the executor is joined (what exit does)."""
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="probe_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    _keep_moving(chain, 5)
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=exclude)
    executor.shutdown(wait=True)


def test_an_exhausted_final_publish_is_published_by_the_exit_hook(chain, store, monkeypatch, capsys):
    """P2. Five lost CASes, no later save. The executor's join leaves the snapshot pending; the exit hook publishes it, with its
    exclusion, once the head has settled."""
    _exhaust_one_job_on_a_real_executor(chain, store, monkeypatch, exclude=[BASE[0]])
    assert len(chain.wins()) == 0 and mps._slot.pending is not None and BASE[0] in chain.head_files()
    mps._flush_at_exit()
    assert len(chain.wins()) == 1 and mps._slot.pending is None
    assert BASE[0] not in chain.head_files() and set(PILOTS_NEW) <= set(chain.head_files())
    assert "::error::" not in capsys.readouterr().out


def test_the_exit_hook_with_nothing_pending_does_nothing(chain, capsys):
    mps._flush_at_exit()
    assert chain.events == [] and capsys.readouterr().out == ""


def test_the_exit_hook_gives_up_loudly_after_its_extra_rounds_and_leaves_the_head_alone(chain, store, parked, sleeps, capsys):
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    chain.pointer_faults.extend(["none"] * 200)                      # the pointer row stays unreadable
    parked.run()                                                     # the job: 5 attempts
    assert len(chain.kinds("read_pointer")) == mps.MAX_ATTEMPTS
    assert mps.EXIT_ROUNDS == 3 and mps.MAX_ATTEMPTS == 5
    mps._flush_at_exit()                                             # 3 more rounds of 5 attempts
    assert len(chain.kinds("read_pointer")) == 5 + 3 * 5
    assert chain.cas_calls == [] and chain.generation == 5
    assert mps._slot.pending is not None
    out = capsys.readouterr().out
    assert out.startswith("::error::[Manifest Publish]") and "NOT published" in out and out.count("::error::") == 1


def test_the_exit_hook_stops_at_its_wall_clock_budget(chain, store, parked, sleeps, capsys, monkeypatch):
    submit(store, BASE[1:] + PILOTS_NEW)
    chain.pointer_faults.extend(["none"] * 200)
    parked.run()
    reads_before, sleeps_before = len(chain.kinds("read_pointer")), len(sleeps)
    now = [1000.0]

    def monotonic():
        now[0] += 50.0                                               # every look at the clock costs 50 s
        return now[0]
    monkeypatch.setattr(mps, "_monotonic", monotonic)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 120.0)
    mps._flush_at_exit()
    extra = len(chain.kinds("read_pointer")) - reads_before
    assert 0 < extra < mps.MAX_ATTEMPTS, "the budget ended the very first round early, not after whole rounds: %d" % extra
    assert len(sleeps) == sleeps_before, "a backoff sleep was taken after the budget was spent"
    assert mps._slot.pending is not None and capsys.readouterr().out.startswith("::error::[Manifest Publish]")


def test_the_exit_hook_is_registered_with_atexit(monkeypatch):
    import atexit
    registered = []
    monkeypatch.setattr(atexit, "register", lambda fn, *a, **k: registered.append(fn))
    mps._register_exit_flush()
    assert registered == [mps._flush_at_exit]


# ── the real thing: a subprocess, to prove the ORDER (the executor's join first, then atexit) ───────────────────────────────

SCRIPT = textwrap.dedent('''
    import atexit, os, sys
    os.environ.update(TESTING="1", MANIFEST_PUBLISH_ONE_STEP="1", MANIFEST_RETENTION_DAYS="36500")
    sys.path.insert(0, @BACKEND@)
    state = {}
    atexit.register(lambda: print("RESULT wins=%d pending=%s head_has_pruned=%s" % (
        len(state["chain"].wins()), state["mps"]._slot.pending is not None, state["pruned"] in state["chain"].head_files()), flush=True))
    from concurrent.futures import ThreadPoolExecutor
    from tests import _manifest_chain_harness as H
    from services.weather_pipeline import manifest_pointer as mp, manifest_publish_step as mps, store as store_mod, manifest_immutable
    chain = H.Chain(H.BASE)
    for name, fn in (("pointer_enabled", lambda: True), ("read_pointer", chain.read_pointer), ("cas_advance", chain.cas_advance),
                     ("fetch_manifest_object", chain.fetch_manifest_object), ("_rest_base_and_headers", lambda: (None, None))):
        setattr(mp, name, fn)
    store_mod._l2_pipeline_writes_allowed = lambda: True
    store_mod._fetch_remote_manifest_products = chain.fetch_legacy_products
    mps._sleep = lambda seconds: None
    store_mod._manifest_executor = ThreadPoolExecutor(max_workers=1)
    state.update(chain=chain, mps=mps, pruned=H.BASE[0])
    if @FOREVER@:
        chain.pointer_faults.extend(["none"] * 500)
    else:
        H._keep_moving(chain, 5)                       # another writer commits inside each of the job's five CAS windows
    mps.submit_manifest_publish(H.FakeStore(chain), H._snapshot(H.BASE[1:] + H.PILOTS_NEW), [H.BASE[0]])
''')


def _run_script(forever):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONPATH=BACKEND)
    return subprocess.run([sys.executable, "-c", SCRIPT.replace("@BACKEND@", repr(BACKEND)).replace("@FOREVER@", repr(forever))],
                          cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)


def test_at_real_interpreter_exit_the_pending_snapshot_is_published_after_the_executor_join():
    done = _run_script(forever=False)
    assert done.returncode == 0, done.stderr[-800:]
    assert "RESULT wins=1 pending=False head_has_pruned=False" in done.stdout, done.stdout + done.stderr[-800:]
    assert "::error::" not in done.stdout


def test_at_real_interpreter_exit_a_publish_that_cannot_happen_is_annotated_and_does_not_hang():
    done = _run_script(forever=True)
    assert done.returncode == 0, done.stderr[-800:]
    assert "::error::[Manifest Publish]" in done.stdout and "RESULT wins=0 pending=True" in done.stdout, done.stdout


# ── the budget bounds every call, not just every attempt (round-5 finding 7) ─────────────────────────────────────────────
# One attempt can run 100+ s (30 s head GET + 30 s upload + a retrying legacy PUT), so a deadline checked only BETWEEN attempts
# bounds the flush at about 300 s, not 120. Inside the flush every network call now gets min(its own timeout, what is left), is not
# made at all when nothing is left, and the legacy manifest.json refresh (a retrying PUT, best effort) is left to the next publish.

def test_the_documented_exit_budget_and_rounds_are_what_the_code_uses():
    """Pinned WITHOUT overriding the constants asserted on (a mutant that made 120 s into 1200 s survived a test that set it)."""
    assert mps.EXIT_BUDGET_SECONDS == 120 and mps.EXIT_ROUNDS == 3 and mps.MAX_ATTEMPTS == 5


def _pending_after_a_failed_job(chain, store, parked, files=None):
    submit(store, files or (BASE[1:] + PILOTS_NEW), exclude_keys=[BASE[0]])
    chain.pointer_faults.extend(["none"] * mps.MAX_ATTEMPTS)
    parked.run()
    assert mps._slot.pending is not None
    chain.timeouts.clear()


def test_outside_the_exit_flush_no_network_call_is_given_a_timeout(chain, store, parked):
    """A normal job keeps every call's own timeout (the lane's calls are identical to before this fix)."""
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.timeouts and all(timeout is None for what, timeout in chain.timeouts if what not in ("list", "delete")), chain.timeouts
    assert dict(chain.timeouts)["list"] == 5, "retention keeps its own 5 s"


def test_in_the_exit_flush_each_call_is_capped_by_its_own_default_when_the_budget_is_ample(chain, store, parked, sleeps, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    mps._flush_at_exit()
    assert chain.wins() and mps._slot.pending is None
    assert dict(chain.timeouts) == {"read_pointer": 8, "fetch": 30, "upload:unique": 30, "cas": 8, "list": 5}, chain.timeouts
    assert not [u for u in chain.uploads if u[0] == "manifest.json"], "the exit flush must not start a retrying legacy PUT"


def test_in_the_exit_flush_each_call_is_capped_by_what_is_left_of_the_budget(chain, store, parked, sleeps, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 4.0)
    mps._flush_at_exit()
    assert chain.wins()
    assert dict(chain.timeouts) == {"read_pointer": 4, "fetch": 4, "upload:unique": 4, "cas": 4, "list": 4}, chain.timeouts


def test_a_call_that_eats_the_budget_stops_the_attempt_before_the_next_call(chain, store, parked, sleeps, monkeypatch, capsys):
    """Every call takes 50 s of a 120 s budget: the 8 s read, the 30 s head GET, then the upload with the 20 s that is left, and the
    swap is NOT attempted (nothing is left to spend on it)."""
    _pending_after_a_failed_job(chain, store, parked)
    clock = [1000.0]
    monkeypatch.setattr(mps, "_monotonic", lambda: clock[0])
    chain.on_call = lambda: clock.__setitem__(0, clock[0] + 50.0)
    mps._flush_at_exit()
    assert [what for what, _ in chain.timeouts] == ["read_pointer", "fetch", "upload:unique"], chain.timeouts
    assert dict(chain.timeouts)["upload:unique"] == 20
    assert chain.cas_calls == [] and mps._slot.pending is not None
    assert capsys.readouterr().out.startswith("::error::[Manifest Publish]")


def test_no_call_at_all_is_made_once_the_budget_is_spent(chain, store, parked, sleeps, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 0.0)
    mps._flush_at_exit()
    assert chain.timeouts == [] and chain.cas_calls == []


# ── round 6, finding 5: the annotation must not claim "head untouched" when a swap may have landed ───────────────────────────

def test_a_swap_that_landed_unheard_followed_by_a_spent_budget_is_annotated_as_unknown_not_as_untouched(
        chain, store, parked, monkeypatch, capsys):
    """The reviewer's P8. The swap lands, its answer is lost, and its wait ate the whole budget, so the flush cannot even look at the
    pointer. The snapshot is (correctly) still pending, but 'never reached the pointer; the head is untouched' would be false."""
    _pending_after_a_failed_job(chain, store, parked)
    clock = [1000.0]
    monkeypatch.setattr(mps, "_monotonic", lambda: clock[0])
    chain.cas_faults = ["lost_ack"]
    real_cas = chain.cas_advance

    def cas(*args, **kwargs):
        outcome = real_cas(*args, **kwargs)
        clock[0] += 500.0
        return outcome
    monkeypatch.setattr(mp, "cas_advance", cas)
    mps._flush_at_exit()
    out = capsys.readouterr().out
    assert chain.generation == 6, "the swap landed"
    assert mps._slot.pending is not None
    assert out.startswith("::error::[Manifest Publish]") and "UNKNOWN" in out
    assert "untouched" not in out and "never reached the pointer" not in out, out


def test_when_no_swap_was_ever_sent_the_annotation_still_says_the_head_is_untouched(chain, store, parked, capsys):
    _pending_after_a_failed_job(chain, store, parked)
    chain.pointer_faults.extend(["none"] * 100)
    mps._flush_at_exit()
    out = capsys.readouterr().out
    assert "untouched" in out and "UNKNOWN" not in out, out


def test_a_job_that_gave_up_after_swaps_it_could_not_confirm_does_not_claim_the_pointer_is_untouched(chain, store, parked, sleeps, caplog):
    """The same wording problem one level up: `_publish`'s ERROR said 'the pointer ... untouched' after five unconfirmed swaps."""
    chain.cas_faults = ["error"] * mps.MAX_ATTEMPTS
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.ERROR):
        parked.run()
    gave_up = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR and "NOT published after" in r.getMessage()]
    assert len(gave_up) == 1 and "UNKNOWN" in gave_up[0] and "untouched" not in gave_up[0], gave_up


def test_a_job_that_never_sent_a_swap_still_says_the_pointer_is_untouched(chain, store, parked, sleeps, caplog):
    chain.pointer_faults.extend(["none"] * mps.MAX_ATTEMPTS)
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.ERROR):
        parked.run()
    gave_up = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR and "NOT published after" in r.getMessage()]
    assert len(gave_up) == 1 and "untouched" in gave_up[0] and "UNKNOWN" not in gave_up[0], gave_up


# ── round 6, finding 6: the budget caps on the calls the flush makes after the swap and in the fallbacks ─────────────────────

def test_the_pointer_read_after_an_unconfirmed_swap_is_capped_by_the_exit_budget_too(chain, store, parked, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 4.0)
    chain.cas_faults = ["lost_ack"]
    mps._flush_at_exit()
    assert [timeout for what, timeout in chain.timeouts if what == "read_pointer"] == [4, 4], \
        "the attempt's read and the look after the swap are both capped by what is left: %s" % chain.timeouts
    assert mps._slot.pending is None and chain.generation == 6


def test_that_same_read_keeps_its_own_default_when_the_budget_is_ample(chain, store, parked, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    chain.cas_faults = ["lost_ack"]
    mps._flush_at_exit()
    assert [timeout for what, timeout in chain.timeouts if what == "read_pointer"] == [8, 8]


def test_the_retention_delete_is_capped_by_the_exit_budget_too(chain, store, parked, monkeypatch):
    from datetime import timedelta
    _pending_after_a_failed_job(chain, store, parked)
    old = "manifests/manifest-g000000000001-" + "ab" * 16 + ".json"
    chain.objects[old] = b"{}"
    chain.created[old] = chain.now - timedelta(days=1)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 4.0)
    mps._flush_at_exit()
    assert chain.deleted == [old]
    assert dict(chain.timeouts)["list"] == 4 and dict(chain.timeouts)["delete"] == 4, chain.timeouts


def _head_gone_legacy_in_place(chain):
    chain.objects.pop(chain.head_key)                                         # the pointer names an object that does not exist
    chain.objects["manifest.json"] = store_mod.dump_manifest_for_l2(_snapshot(BASE))


def test_the_legacy_manifest_read_is_capped_by_the_exit_budget_too(chain, store, parked, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    _head_gone_legacy_in_place(chain)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 4.0)
    mps._flush_at_exit()
    assert chain.wins() and dict(chain.timeouts)["legacy_get"] == 4, chain.timeouts


def test_the_legacy_manifest_read_keeps_its_own_default_when_the_budget_is_ample_and_outside_the_flush(chain, store, parked, monkeypatch):
    _pending_after_a_failed_job(chain, store, parked)
    _head_gone_legacy_in_place(chain)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    mps._flush_at_exit()
    assert dict(chain.timeouts)["legacy_get"] == 15
    chain.timeouts.clear()
    assert mps._legacy_products(None) is not None
    assert dict(chain.timeouts)["legacy_get"] == 15


# ── round 6, mutation survivors: the exact contract of the cap, the clock, the real upload's timeout, the message ───────────────

def test_the_cap_gives_a_call_its_default_or_what_is_left_and_refuses_a_call_when_nothing_is_left(monkeypatch):
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    assert mps._timeout_kw(None, 8) == {}
    assert mps._timeout_kw(2000.0, 8) == {"timeout": 8}
    assert mps._timeout_kw(1003.0, 8) == {"timeout": 3.0}
    for deadline in (1000.0, 999.0):                                   # exactly nothing left is nothing left
        with pytest.raises(mps._OutOfBudget):
            mps._timeout_kw(deadline, 8)


def test_the_budget_is_measured_on_the_monotonic_clock_not_the_wall_clock():
    import time
    assert mps._monotonic is time.monotonic, "a wall-clock step (NTP, a manual change) must not stretch or collapse the exit budget"


def test_a_job_that_never_sent_a_swap_says_what_it_left_untouched_in_the_old_words(chain, store, parked, sleeps, caplog):
    chain.pointer_faults.extend(["none"] * mps.MAX_ATTEMPTS)
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.ERROR):
        parked.run()
    gave_up = next(r.getMessage() for r in caplog.records if "NOT published after" in r.getMessage())
    assert "the pointer and the legacy manifest.json are untouched" in gave_up, gave_up
    assert "unique create-only objects left by lost attempts may remain until retention removes them" in gave_up, gave_up
    assert "unique manifest objects" not in gave_up, "the old wording claimed objects were untouched that lost attempts leave behind"


def test_the_give_up_wording_is_true_after_five_lost_attempts_that_each_left_a_unique_object_behind(chain, store, parked, caplog):
    """The reviewer's b2: five clean losses, five unreferenced unique objects in storage, and the message must not call them untouched."""
    _keep_moving(chain, 10)
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.ERROR):
        parked.run()
    gave_up = next(r.getMessage() for r in caplog.records if "NOT published after" in r.getMessage())
    assert len(chain.copies()) == mps.MAX_ATTEMPTS and "may remain until retention removes them" in gave_up, (chain.copies(), gave_up)


@pytest.fixture
def real_upload(monkeypatch):
    """The REAL ProductStore._upload_to_supabase over a recording requests.post (the harness's Chain replaces this method everywhere else)."""
    from types import SimpleNamespace
    import requests
    calls = []
    monkeypatch.setattr(store_mod, "_get_supabase_storage", lambda: object())
    monkeypatch.setenv("SUPABASE_URL", "https://storage.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setattr(store_mod.ProductStore, "_last_upload_time", None, raising=False)
    monkeypatch.setattr(requests, "post", lambda url, **kwargs: calls.append((url, kwargs)) or SimpleNamespace(status_code=200, text="{}"))
    return calls


@pytest.mark.parametrize("overwrite", [False, True], ids=["create-only", "overwrite-with-retry"])
def test_the_real_upload_keeps_its_30_second_default_and_honours_the_exit_flushs_cap(real_upload, overwrite):
    key = "manifests/manifest-g000000000006-" + "ab" * 16 + ".json"
    assert store_mod.ProductStore._upload_to_supabase(None, key, b"{}", strict=True, overwrite=overwrite) is True
    assert store_mod.ProductStore._upload_to_supabase(None, key, b"{}", strict=True, overwrite=overwrite, timeout=7) is True
    assert [kwargs["timeout"] for _, kwargs in real_upload] == [30, 7]


# ── round 7, finding 2: after an adoption the head HAS moved; the wording must not call it untouched ─────────────────────────

X = BASE[0]


def _first_key(chain):
    return next(key for key, _, _ in chain.uploads if UNIQUE_KEY.fullmatch(key))


def _b_cannot_fetch_any_head(chain):
    chain.fetch_faults = ["fine"] + ["none"] * 400           # A's one head read works; after that no head object can be fetched


def test_after_an_older_snapshots_swap_landed_unheard_a_snapshot_that_cannot_send_one_does_not_call_the_head_untouched(
        chain, store, parked, capsys, caplog):
    """The reviewer's P3. A's swap is unconfirmed and A gives up; B is queued; A's swap lands; B reads the pointer, recognises the head
    as A's object (so nothing is 'unknown' any more) and then cannot fetch it, so it sends nothing. The head is THIS PROCESS's own
    earlier object: 'untouched' is false."""
    chain.cas_faults = ["error"]
    chain.pointer_faults = [None] + ["none"] * 5
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert len(chain.cas_calls) == 1
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    chain.generation, chain.head_key = chain.generation + 1, _first_key(chain)
    chain.fetch_faults = ["none"] * 400
    import logging
    with caplog.at_level(logging.ERROR):
        parked.run()
        mps._flush_at_exit()
    out = capsys.readouterr().out
    assert len(chain.cas_calls) == 1 and mps._slot.pending is not None
    give_up = [r.getMessage() for r in caplog.records if "NOT published after" in r.getMessage()]
    assert give_up and all("untouched" not in line for line in give_up), give_up
    assert "untouched" not in out and "earlier swap of this process" in out, out


def test_after_a_swap_was_settled_by_adoption_a_newer_snapshot_that_cannot_send_one_does_not_call_the_head_untouched(
        chain, store, parked, capsys):
    """Same, for the snapshot's OWN landed swap: A is settled as a win by the look at the pointer; B (queued during the swap) is next."""
    chain.cas_faults = ["lost_ack"]
    chain.before_cas = lambda: submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    chain.fetch_faults = ["fine"] + ["none"] * 400
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    mps._flush_at_exit()
    out = capsys.readouterr().out
    assert chain.generation == 6 and len(chain.cas_calls) == 1 and mps._slot.pending is not None
    assert "untouched" not in out and "earlier swap of this process" in out, out


def test_a_confirmed_win_ends_the_moved_by_us_state_so_a_later_failure_is_not_blamed_on_it(chain, store, parked, capsys):
    chain.cas_faults = ["lost_ack"]
    chain.before_cas = lambda: submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()                                              # A settled by adoption, B won normally
    assert mps._slot.pending is None and not mps._slot.adopted
    submit(store, BASE[1:] + PILOTS_NEW + LATTICE)
    chain.pointer_faults.extend(["none"] * 400)
    parked.run()
    mps._flush_at_exit()
    assert "head is untouched" in capsys.readouterr().out


# ── round 7, finding 4: the adoption's object fetch is capped by the exit budget too ─────────────────────────────────────────

def _two_unknown_swaps_then_the_first_lands_late(chain, store, parked):
    """Only the newest unconfirmed swap keeps its bytes, so adopting the FIRST one fetches its object."""
    chain.cas_faults = ["error", "error"]
    chain.pointer_faults = [None, "none", None, "none", "none", "none", "none"]
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert len(chain.cas_calls) == 2 and mps._slot.pending is not None
    first = _first_key(chain)
    chain.generation, chain.head_key = chain.generation + 1, first
    chain.timeouts.clear()
    return first


def test_the_adoption_fetch_in_the_exit_flush_is_capped_by_what_is_left_of_the_budget(chain, store, parked, monkeypatch):
    first = _two_unknown_swaps_then_the_first_lands_late(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 4.0)
    mps._flush_at_exit()
    assert [timeout for what, timeout in chain.timeouts if what == "fetch"] == [4], chain.timeouts
    assert mps._slot.pending is None and chain.generation == 6 and chain.head_key == first


def test_the_adoption_fetch_keeps_its_own_30_second_default_when_the_budget_is_ample(chain, store, parked, monkeypatch):
    _two_unknown_swaps_then_the_first_lands_late(chain, store, parked)
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    mps._flush_at_exit()
    assert [timeout for what, timeout in chain.timeouts if what == "fetch"] == [30]
    assert mps._slot.pending is None


def test_no_adoption_fetch_is_made_once_the_look_at_the_pointer_has_eaten_the_budget(chain, store, parked, monkeypatch):
    _two_unknown_swaps_then_the_first_lands_late(chain, store, parked)
    clock = [1000.0]
    monkeypatch.setattr(mps, "_monotonic", lambda: clock[0])
    real_read = chain.read_pointer

    def read_pointer(timeout=None):
        row = real_read(timeout=timeout)
        clock[0] += 500.0
        return row
    monkeypatch.setattr(mp, "read_pointer", read_pointer)
    mps._flush_at_exit()
    assert not [what for what, _ in chain.timeouts if what == "fetch"], "a call was made with no budget left"
    assert mps._slot.pending is not None


# ── round 7, finding 1 (threads): the memory is the slot's, so the exit flush (main thread) sees what the executor thread learned ──

def test_the_memory_of_an_unconfirmed_swap_crosses_from_the_executor_thread_to_the_exit_flush_on_the_main_thread(chain, store, monkeypatch):
    """The job runs on the manifest executor's thread: swap A unconfirmed, a save B arrives DURING it (also on that thread), both give
    up. The executor is joined (what interpreter exit does first). Then A's swap lands, W re-registers X, and the flush on the main
    thread publishes B: it must know about A's swap, or B's exclusion of X erases W's registration."""
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="probe_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    chain.cas_faults = ["error"]
    chain.pointer_faults = [None] + ["none"] * 10                    # A's six reads fail from the second one on, then B's five
    chain.before_cas = lambda: submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    executor.shutdown(wait=True)
    assert len(chain.cas_calls) == 1 and mps._slot.pending is not None and mps._slot.attempted
    chain.generation, chain.head_key = chain.generation + 1, _first_key(chain)
    chain.foreign_publish(lambda products: products + [_raw_wind(X, run_time=RUN_TIME + timedelta(hours=6))])
    mps._flush_at_exit()
    assert mps._slot.pending is None and X in chain.head_files(), "the flush on the main thread did not know about the swap"


# ── round 8: the adoption fetch reads the HEAD's key ─────────────────────────────────────────────────────────────────────────

def test_the_adoption_fetch_reads_the_head_key_not_the_newest_remembered_one(chain, store, parked, monkeypatch):
    """Both objects exist in storage, so a fetch of the wrong key would answer with bytes: only the key shows it."""
    first = _two_unknown_swaps_then_the_first_lands_late(chain, store, parked)
    newest = list(mps._slot.attempted)[-1]
    assert newest != first and newest in chain.objects
    chain.events.clear()
    monkeypatch.setattr(mps, "_monotonic", lambda: 1000.0)
    mps._flush_at_exit()
    assert chain.kinds("fetch") == [("fetch", first)], chain.kinds("fetch")
    assert mps._slot.pending is None
