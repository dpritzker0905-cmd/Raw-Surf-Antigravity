"""MANIFEST_PUBLISH_ONE_STEP: a publish that exhausted its attempts is not abandoned at interpreter exit (round-4 finding P2).

A job that fails five times leaves its snapshot pending "for the next job", but the last save of a CI run has no next job: the
process exits with the registration (or the prune) unpublished and nothing says so. An `atexit` hook, which CPython runs AFTER
the thread-pool executor's own join, publishes whatever is still pending on the main thread with a bounded extra budget, and
raises a GitHub error annotation if it still cannot."""
import os
import subprocess
import sys
import textwrap
from concurrent.futures import ThreadPoolExecutor


import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import BASE, PILOTS_NEW, _keep_moving, chain, parked, sleeps, store, submit  # noqa: F401,F811

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
    reads_before = len(chain.kinds("read_pointer"))
    now = [1000.0]

    def monotonic():
        now[0] += 50.0                                               # every look at the clock costs 50 s
        return now[0]
    monkeypatch.setattr(mps, "_monotonic", monotonic)
    monkeypatch.setattr(mps, "EXIT_BUDGET_SECONDS", 120.0)
    mps._flush_at_exit()
    extra = len(chain.kinds("read_pointer")) - reads_before
    assert 0 < extra < mps.MAX_ATTEMPTS, "the budget ended the very first round early, not after whole rounds: %d" % extra
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
