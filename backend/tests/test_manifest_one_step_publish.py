"""MANIFEST_PUBLISH_ONE_STEP: the manifest's merge and its compare-and-swap happen in ONE step, on one thread.

WHY (2026-10-16). manifest.json is rewritten whole by several concurrent CI writers (core ingest, pilots, precompute). Every
upload used to be three separate moments: reconcile (fold the head's entries in, on the CALLER's thread), dump, then a queued PUT
whose publish_run_keyed read the pointer at PUBLISH time and CASed from that fresh generation. A snapshot merged against
generation g0 but published after another writer committed g1 therefore erased that writer's registrations (14 EURO wind
estimated frames, 2026-10-16). The previous attempt (PR #344) patched the old path and two independent reviews found a new
"fall back to the old publish path" corner in each patch.

THE DESIGN HERE HAS NO SUCH CORNER. With the flag on, a save only serializes its snapshot into a coalescing slot; ONE job on the
manifest executor then reads the pointer (generation g), GETs the object the pointer names, merges with the existing reconcile
semantics, uploads a UNIQUE create-only object and CASes from g (and from the key it merged against). Nothing that fails ever
publishes the snapshot unmerged: it is retried, and after five attempts it stays pending for the next job.

This file: the publish scenarios (the reviewers' defects included). `Chain` (tests/_manifest_chain_harness.py) is production-faithful
where it matters; the merge, serializer, publish_run_keyed and the call sites are the real code; any real HTTP request fails the test.
"""
import logging
from datetime import timedelta

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from services.weather_pipeline.store import dump_manifest_for_l2
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, LATTICE, PILOTS_NEW, RUN_TIME, UNIQUE_KEY, _files, _iso, _keep_moving, _raw_wind, _snapshot, adding,
    chain, changing, inline, parked, removing, sleeps, store, submit,
)


def test_the_original_lost_update_a_snapshot_serialized_before_another_writers_commit_does_not_erase_it(
        chain, store, parked):
    """Pilots serializes its snapshot against generation 5. Before its queued upload runs, core registers 14 estimated
    frames and commits generation 6. Pilots' job then runs: the head must keep BOTH. (Before: the PUT's
    publish_run_keyed read the pointer NOW, swapped 6 -> 7 and the head lost core's 14 frames.)"""
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    assert chain.generation == 6
    parked.run()
    lost = sorted(set(LATTICE) - set(chain.head_files()))
    assert not lost, "the published head lost %d of core's 14 registered frames: %s" % (len(lost), lost[:3])
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


@pytest.mark.parametrize("failing_read", ["pointer", "head_object"])
def test_a_transient_read_failure_is_retried_and_never_published_unmerged(chain, store, parked, sleeps, failing_read):
    """Another writer committed 14 frames, and the first read of the head fails (HTTP 5xx / timeout). The job backs off
    and reads again; every candidate that ever reaches the CAS already carries core's frames."""
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    (chain.pointer_faults if failing_read == "pointer" else chain.fetch_faults).append("none")
    parked.run()
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    assert chain.cas_calls, "nothing was published"
    assert all(set(LATTICE) <= set(call["files"]) for call in chain.cas_calls), "an unmerged candidate reached the CAS"
    assert len(sleeps) == 1 and 0 < sleeps[0] <= 3, sleeps


@pytest.mark.parametrize("failing_read", ["pointer", "head_object"])
def test_five_failed_reads_leave_the_head_untouched_and_the_snapshot_pending_for_the_next_job(
        chain, store, parked, sleeps, caplog, failing_read):
    """Never a fall-back to publishing: after five attempts the pointer, the unique objects and the legacy manifest.json
    are all untouched, the log says so at ERROR, and the snapshot AND its exclude_keys wait for the next job."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])                  # this process pruned BASE[0]
    chain.foreign_publish(adding(*LATTICE))
    (chain.pointer_faults if failing_read == "pointer" else chain.fetch_faults).extend(["none"] * 5)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + LATTICE)
    assert chain.cas_calls == []
    assert [u for u in chain.uploads if u[0] == "manifest.json" or u[0].startswith("manifests/")] == []
    assert any(r.levelno >= logging.ERROR for r in caplog.records), "five failures must be loud"
    assert len(sleeps) == 4
    later = "euro_wind_wind_global_mid_20261026T000000Z.json"
    submit(store, BASE[1:] + PILOTS_NEW + [later])                                # the next save, with no excludes of its own
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW + [later]), \
        "the failed job's snapshot or its exclude_keys were lost"


def test_five_create_only_uploads_failing_with_429_publish_nothing_unmerged_and_the_snapshot_stays_pending(
        chain, store, parked, sleeps):
    """The reviewers' second confirmed defect: five failed uploads, core lands meanwhile, and the old code then ran the
    single-read publish over a head it had never merged. Here: no CAS, no legacy PUT, and a later job publishes it."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    chain.upload_faults = ["429"] * 5
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE))            # core lands during our first attempt
    parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + LATTICE)
    assert chain.cas_calls == []
    assert [u for u in chain.uploads if u[0] == "manifest.json"] == [], "the legacy manifest.json was touched"
    assert len([u for u in chain.uploads if u[0].startswith("manifests/")]) == 5
    later = "euro_wind_wind_global_mid_20261026T000000Z.json"
    submit(store, BASE[1:] + PILOTS_NEW + [later])
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW + [later])


@pytest.mark.parametrize("head", ["garbage", "not_a_manifest"])
def test_a_head_that_cannot_be_merged_against_is_a_failed_attempt_not_a_licence_to_publish(
        chain, store, parked, sleeps, caplog, head):
    submit(store, BASE + PILOTS_NEW)
    chain.objects[chain.head_key] = b"<html>502 Bad Gateway</html>" if head == "garbage" else b'{"last_manifest_update": "x"}'
    before = chain.objects[chain.head_key]
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.cas_calls == [] and chain.generation == 5 and chain.objects[chain.head_key] == before
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert len(sleeps) == 4


@pytest.mark.parametrize("generation", [None, "5", True, 0, 999999999999], ids=repr)
def test_a_pointer_row_with_an_unusable_generation_is_a_failed_attempt(chain, store, parked, sleeps, generation):
    """The same bounds publish_immutable enforces: an int in 1 .. 999999999998, so the 12-digit object name stays valid.
    (The fake pointer row really holds this generation, so only the guard stands between it and an upload.)"""
    chain.generation = generation
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.cas_calls == [] and chain.uploads == []
    assert len(sleeps) == 4


@pytest.mark.parametrize("foreign_key", [None, "unique"], ids=["old-path-name", "unique-name"])
def test_a_writer_that_commits_during_our_upload_is_never_overwritten_and_both_survive(chain, store, parked, foreign_key):
    """P10 (reviewer, confirmed): core commits generation 6 as `manifest-g000000000006.json`, the name EVERY old-path
    writer uses, while our upload is in flight. A deterministic name for our attempt would land on top of core's committed
    object. Ours is unique and create-only: core's object is untouched and the retry merges against it."""
    submit(store, BASE + PILOTS_NEW)
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE), key=foreign_key)
    core_key = mp.run_keyed_manifest_key(6) if foreign_key is None else "manifests/manifest-g000000000006-" + "f0" * 16 + ".json"
    parked.run()
    assert core_key not in [key for key, _, _ in chain.uploads], "our attempt wrote to the name core committed under"
    core_files = _files(chain.objects[core_key])
    assert set(LATTICE) <= set(core_files) and not set(PILOTS_NEW) & set(core_files), "core's committed object changed"
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, False), (6, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_every_attempt_uploads_a_unique_create_only_acknowledged_object(chain, store, parked):
    """manifest_immutable.publish_immutable's contract: `manifests/manifest-g<N+1:012d>-<uuid4 hex>.json`, strict, not
    overwriting, and a NEW name for every attempt (an object whose acknowledgment we lost may be sitting on the old one)."""
    submit(store, BASE + PILOTS_NEW)
    chain.upload_faults = ["lost_ack"]                  # the first object LANDS, the answer does not come back
    parked.run()
    lane = [u for u in chain.uploads if u[0].startswith("manifests/")]
    assert len(lane) == 2, lane
    assert all(strict and not overwrite for _, strict, overwrite in lane), lane
    for key, _, _ in lane:
        assert UNIQUE_KEY.fullmatch(key), "not a unique manifest name: %s" % key
    assert [int(UNIQUE_KEY.fullmatch(k)[1]) for k, _, _ in lane] == [6, 6]
    assert lane[0][0] != lane[1][0]
    assert [c["key"] for c in chain.cas_calls] == [lane[1][0]], "the unacknowledged object was swapped in"
    assert chain.head_key == lane[1][0] and chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_an_upload_that_is_not_acknowledged_with_true_is_never_swapped_in(chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.upload_faults = ["none_ack"]                  # the object landed and the call returned None, not True
    parked.run()
    lane = [u for u in chain.uploads if u[0].startswith("manifests/")]
    assert len(lane) == 2 and [c["key"] for c in chain.cas_calls] == [lane[1][0]]


def test_a_head_that_moves_inside_three_casts_is_remerged_each_time_and_the_final_head_has_every_writer(
        chain, store, parked, sleeps):
    submit(store, BASE + PILOTS_NEW)
    _keep_moving(chain, 3)
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, False), (6, False), (7, False), (8, True)]
    foreign = ["euro_wind_wind_global_mid_20261026T%02d0000Z.json" % k for k in (1, 2, 3)]
    assert chain.head_files() == sorted(BASE + PILOTS_NEW + foreign)
    for attempt, call in enumerate(chain.cas_calls):
        assert len([f for f in call["files"] if "20261026" in f]) == attempt, \
            "attempt %d was not merged against the head it read" % (attempt + 1)
        assert set(BASE + PILOTS_NEW) <= set(call["files"])
    assert len(sleeps) == 3 and all(0 < wait <= 3 for wait in sleeps)


def test_each_retry_remerges_the_ORIGINAL_snapshot_not_the_previous_attempts_result(chain, store, parked):
    """Another writer registered X (generation 6) and then prunes it (generation 7) while we publish. Our first attempt
    merged X in; the second must NOT carry it over: it starts again from the snapshot we were handed."""
    x = "euro_wind_wind_global_mid_20261027T000000Z.json"
    chain.foreign_publish(adding(x))
    submit(store, BASE + PILOTS_NEW)                                           # our snapshot has never heard of X
    chain.before_cas = lambda: chain.foreign_publish(removing(x))
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(6, False), (7, True)]
    assert x in chain.cas_calls[0]["files"] and x not in chain.cas_calls[1]["files"]
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_a_head_that_never_settles_is_never_overwritten_unmerged_and_the_snapshot_stays_pending(
        chain, store, parked, sleeps, caplog):
    submit(store, BASE + PILOTS_NEW)
    _keep_moving(chain, 9)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert mps.MAX_ATTEMPTS == 5
    assert [c["won"] for c in chain.cas_calls] == [False] * 5
    assert chain.generation == 5 + 5, "nothing of ours advanced the pointer"
    assert not set(PILOTS_NEW) & set(chain.head_files())
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert [u for u in chain.uploads if u[0] == "manifest.json"] == []
    submit(store, BASE + PILOTS_NEW)                                           # a later save: the head has settled
    parked.run()
    assert set(PILOTS_NEW) <= set(chain.head_files()) and len(chain.wins()) == 1


def test_the_lost_ack_of_a_cas_that_landed_is_harmless(chain, store, parked):
    """cas_advance answered False although the row advanced to OUR object. The next attempt reads that head, merges our
    snapshot into our own object (nothing to add) and publishes one more, identical, generation."""
    submit(store, BASE + PILOTS_NEW)
    chain.cas_faults = ["lost_ack"]
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True), (6, True)]
    assert chain.generation == 7
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert chain.objects[chain.head_key] != b"" and _files(chain.objects[chain.cas_calls[0]["key"]]) == chain.head_files()


def test_an_entry_this_process_pruned_does_not_come_back_from_a_head_that_still_holds_it(chain, store, parked):
    """BASE[0] was pruned here (its object deleted). Another writer publishes in between and the head still names it:
    folding it back would mint a dangling manifest entry (audit #28)."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys={BASE[0]})
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW)


def test_without_exclude_keys_the_same_entry_is_folded_back_so_the_test_above_is_not_vacuous(chain, store, parked):
    submit(store, BASE[1:] + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert BASE[0] in chain.head_files()


@pytest.mark.parametrize("excludes", [[BASE[0]], (BASE[0],), {BASE[0]}, frozenset({BASE[0]}), iter([BASE[0]])],
                         ids=["list", "tuple", "set", "frozenset", "iterator"])
def test_exclude_keys_may_be_any_iterable(chain, store, parked, excludes):
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=excludes)
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + PILOTS_NEW)


def test_coalescing_carries_the_union_of_every_submits_exclude_keys(chain, store, parked):
    """Two prunes, each followed by a save, all before the job runs. Only the newest snapshot is published, and it lacks
    BOTH pruned entries, so BOTH exclusions must apply to it or the older prune comes back from the head."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    submit(store, PILOTS_NEW, exclude_keys=[BASE[1]])
    assert len(parked.queue) == 1, "one job, not one per submit"
    parked.run()
    assert chain.head_files() == sorted(PILOTS_NEW)


def test_a_prune_that_follows_a_queued_save_does_not_resurrect_the_entry(chain, store, inline):
    """Save S (queued), then prune S (its object deleted). The first job publishes S; the second snapshot lacks it and
    its exclusion must win over a head that now holds it."""
    s = "euro_wind_wind_global_mid_20261026T030000Z.json"
    chain.during_upload = lambda: submit(store, BASE + PILOTS_NEW, exclude_keys=[s])      # the prune, during job 1
    submit(store, BASE + PILOTS_NEW + [s])
    assert len(chain.wins()) == 2
    assert s in chain.cas_calls[0]["files"], "the first publish should have carried S"
    assert chain.head_files() == sorted(BASE + PILOTS_NEW), "a pruned entry (object deleted) came back"


def test_exclude_keys_do_not_outlive_the_publish_they_belong_to(chain, store, parked):
    """After a successful publish the exclusions are spent: a writer that registers the same key again later keeps it."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    parked.run()
    assert BASE[0] not in chain.head_files()
    chain.foreign_publish(adding(BASE[0]))                                   # core re-registers it (a new object)
    submit(store, BASE[1:] + PILOTS_NEW)
    parked.run()
    assert BASE[0] in chain.head_files()


def _both_changed(chain, store, parked, ours_fields, theirs_fields):
    """We change BASE[1] (freshness 111 marks ours) and core changes it too (222), then the job merges."""
    submit(store, [BASE[0], (BASE[1], dict(ours_fields, freshness_sec=111))] + PILOTS_NEW)
    chain.foreign_publish(changing(BASE[1], freshness_sec=222, **theirs_fields), adding(*LATTICE))
    parked.run()
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    return {111: "ours", 222: "theirs"}[chain.head_entry(BASE[1])["freshness_sec"]]


@pytest.mark.parametrize("ours_hours,theirs_hours,winner", [(1, 6, "theirs"), (6, 1, "ours"), (3, 3, "ours")],
                         ids=["head-newer", "ours-newer", "same-run"])
def test_an_entry_both_sides_changed_keeps_the_newer_run(chain, store, parked, ours_hours, theirs_hours, winner):
    got = _both_changed(chain, store, parked, {"run_time": RUN_TIME + timedelta(hours=ours_hours)},
                        {"run_time": _iso(RUN_TIME + timedelta(hours=theirs_hours))})
    assert got == winner


@pytest.mark.parametrize("theirs_cycle,ours_cycle,theirs_receipt,winner", [
    (-6, 0, 1, "ours"), (0, -6, -1, "theirs"), (0, 0, 1, "theirs"), (0, 0, -1, "ours")],
    ids=["older-cycle-received-later", "newer-cycle-received-earlier", "same-cycle-received-later",
         "same-cycle-received-earlier"])
def test_with_verified_cycles_the_merge_ranks_by_cycle_like_reconcile(
        chain, store, parked, monkeypatch, theirs_cycle, ours_cycle, theirs_receipt, winner):
    """INGEST_PRUNE_VERIFIED_CYCLES=1: a later receipt of an OLDER verified cycle must not undo the prune."""
    monkeypatch.setenv("INGEST_PRUNE_VERIFIED_CYCLES", "1")
    got = _both_changed(
        chain, store, parked,
        {"model_run_time": RUN_TIME + timedelta(hours=ours_cycle), "model_run_time_status": "known"},
        {"model_run_time": _iso(RUN_TIME + timedelta(hours=theirs_cycle)), "model_run_time_status": "known",
         "run_time": _iso(RUN_TIME + timedelta(hours=theirs_receipt))})
    assert got == winner


def _order(chain):
    return [e[0] if e[0] != "upload" else e[1] for e in chain.events]


def test_a_won_cas_runs_retention_then_puts_the_merged_bytes_to_the_legacy_manifest_without_republishing(
        chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    parked.run()
    won = chain.wins()
    assert len(won) == 1 and chain.generation == 7
    order = _order(chain)
    assert order.index("cas") < order.index("list") < order.index("manifest.json"), order
    assert len(chain.list_requests) == 1, "one retention listing per won swap"
    assert chain.objects["manifest.json"] == chain.objects[chain.head_key], "the legacy copy holds the MERGED bytes"
    assert chain.nested_publishes == [None], "the legacy PUT must not publish a second generation"
    assert chain.deleted == []


def test_a_lost_cas_neither_runs_retention_nor_touches_the_legacy_manifest(chain, store, parked):
    submit(store, BASE + PILOTS_NEW)
    chain.before_cas = lambda: chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert len(chain.list_requests) == 1, "retention runs after the swap that WON, not after the one that lost"
    order = _order(chain)
    assert order.count("manifest.json") == 1 and order.index("manifest.json") > max(
        i for i, kind in enumerate(order) if kind == "cas")


def test_a_failing_legacy_put_does_not_undo_the_pointer_win_and_raises_nothing(chain, store, parked):
    chain.fail_manifest_json_put = True
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert "manifest.json" not in chain.objects
    assert len(chain.wins()) == 1


def test_a_failing_retention_does_not_undo_the_pointer_win_or_skip_the_legacy_put(chain, store, parked):
    chain.list_fault = "raise"
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.generation == 6 and chain.objects["manifest.json"] == chain.objects[chain.head_key]


def test_a_pointer_lane_that_is_disabled_for_good_runs_the_old_path_once(chain, store, parked, monkeypatch):
    """The pointer table is missing (read_pointer disables the lane and answers None). That is permanent, so the job runs
    today's path ONCE: reconcile (it fetches the head itself), dump, PUT manifest.json. No retry, no CAS."""
    state = {"enabled": True}
    monkeypatch.setattr(mp, "pointer_enabled", lambda: state["enabled"])
    monkeypatch.setattr(mp, "read_pointer", lambda: chain.events.append(("read_pointer",)) or state.update(enabled=False))
    remote = [_raw_wind(name) for name in LATTICE]
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: chain.events.append(("fetch_remote",)) or remote)
    submit(store, BASE + PILOTS_NEW)
    assert chain.events == [], "the caller's thread must do no I/O"
    parked.run()
    assert [e for e in chain.events if e[0] != "fetch_remote"] == [("read_pointer",), ("upload", "manifest.json", False, True)]
    assert chain.kinds("fetch_remote") == [("fetch_remote",)]
    assert _files(chain.objects["manifest.json"]) == sorted(BASE + PILOTS_NEW + LATTICE)
    assert chain.cas_calls == []


# ── an exclusion belongs to the publish that applied it (round-4 findings P1, P1b) ───────────────────────────────────────

LATER = "euro_wind_wind_global_mid_20261026T000000Z.json"


def test_an_exclusion_does_not_outlive_its_publish_when_a_save_lands_during_that_publish(chain, store, inline):
    """P1. The prune of x is published; the NEXT ordinary save lands while that publish uploads, so it is coalesced into the
    pending slot with the old exclusion still on it. Another writer then re-registers x (a NEW object under the same key). The
    exclusion was spent by the publish that applied it: carrying it into the next publish erases that writer's registration."""
    x = BASE[0]
    chain.during_upload = lambda: submit(store, BASE[1:] + PILOTS_NEW + [LATER])
    chain.during_legacy_put = lambda: chain.foreign_publish(adding(x))                 # job 1 has won; x comes back, legitimately
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[x])
    assert len(chain.wins()) == 2
    assert x in chain.head_files(), "the other writer's re-registration of x was erased by a spent exclusion"
    assert LATER in chain.head_files()


def _exclusions_each_publish_carried(monkeypatch):
    seen = []
    real = mps._attempt_once
    monkeypatch.setattr(mps, "_attempt_once", lambda pending: seen.append(sorted(pending.excludes)) or real(pending))
    return seen


def test_one_exclusion_rides_on_one_publish_not_on_every_publish_while_saves_keep_landing(chain, store, inline, monkeypatch):
    """P1b. Every publish sees one more save land during it, six times over. The single prune's exclusion must be applied
    by the first publish and by no other."""
    x = BASE[0]
    seen = _exclusions_each_publish_carried(monkeypatch)
    rounds = {"n": 0}

    def next_save():
        rounds["n"] += 1
        if rounds["n"] <= 6:
            chain.during_upload = next_save
            submit(store, BASE[1:] + PILOTS_NEW + ["euro_wind_wind_global_mid_202610%02dT000000Z.json" % (26 + rounds["n"])])
    chain.during_upload = next_save
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[x])
    assert len(chain.wins()) == 7
    assert seen[0] == [x] and all(carried == [] for carried in seen[1:]), seen


def test_an_id_named_again_by_a_later_submit_keeps_its_exclusion_for_the_publish_that_follows(chain, store, inline, monkeypatch):
    """Dropping is by SEQUENCE: the exclusion a submit made BEFORE the winning snapshot is spent, the one a later submit
    made for the same id is not (that prune has not been applied by anyone yet)."""
    x = BASE[0]
    seen = _exclusions_each_publish_carried(monkeypatch)

    def two_more():
        submit(store, BASE[1:] + PILOTS_NEW + [LATER])                                    # a save: no exclusions of its own
        submit(store, BASE[1:] + PILOTS_NEW + [LATER], exclude_keys=[x])                  # x pruned AGAIN after job 1's snapshot
    chain.during_upload = two_more
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[x])
    assert seen == [[x], [x]], seen
    assert x not in chain.head_files()


def test_a_failed_publish_keeps_its_exclusions_for_the_next_one(chain, store, parked, sleeps, monkeypatch):
    seen = _exclusions_each_publish_carried(monkeypatch)
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    chain.pointer_faults.extend(["none"] * 5)
    parked.run()
    assert chain.cas_calls == []
    submit(store, BASE[1:] + PILOTS_NEW + [LATER])
    parked.run()
    assert seen[-1] == [BASE[0]] and BASE[0] not in chain.head_files()


# ── ABA: the swap names the head it merged against, not just its generation number (round-4 finding P3) ─────────────────

def test_a_pointer_rolled_back_and_re_advanced_to_the_same_generation_number_does_not_let_our_swap_win(chain, store, parked):
    """P3. We read generation 5 and merge against its object. An operator restores the pointer to generation 4, and another
    writer commits generation 5 AGAIN, under a different key and with different content. A CAS on the generation number alone
    would win with bytes that never saw that head. The swap also names the key it merged against, so it loses and the retry
    merges against the head that really is there."""
    old_key = "manifests/manifest-g000000000004.json"
    chain.objects[old_key] = chain.objects[chain.head_key]

    def rollback_then_foreign_commit():
        chain.generation, chain.head_key = 4, old_key
        chain.foreign_publish(adding(*LATTICE), key="unique")
    submit(store, BASE + PILOTS_NEW)
    chain.during_upload = rollback_then_foreign_commit
    parked.run()
    assert set(LATTICE) <= set(chain.head_files()), "won a CAS from g5 with bytes merged against a DIFFERENT g5"
    assert [c["won"] for c in chain.cas_calls] == [False, True]


def test_the_swap_names_the_key_of_the_head_it_merged_against(chain, store, parked):
    chain.foreign_publish(adding(*LATTICE))
    merged_against = chain.head_key
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [(c["expected"], c["expected_key"]) for c in chain.cas_calls] == [(6, merged_against)]


# ── a head object that is definitely missing must not wedge the lane (round-4 finding P7) ────────────────────────────────

def _legacy_manifest(chain, files):
    """What an old-path writer left in the legacy manifest.json."""
    chain.objects["manifest.json"] = dump_manifest_for_l2(_snapshot(files))


def test_a_missing_head_object_is_merged_against_the_legacy_manifest_and_swapped_from_the_same_generation(
        chain, store, parked):
    """P7. The pointer names an object that is not there (an old-path writer whose non-strict upload failed committed it, or
    it was deleted). Before: every attempt of every job failed at the fetch, for ever. Now a definite miss merges against the
    legacy manifest.json, and the swap still names generation g and the missing key, so a concurrent writer wins over us."""
    _legacy_manifest(chain, BASE + LATTICE)
    missing = chain.head_key
    chain.objects.pop(missing)
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [(c["expected"], c["expected_key"], c["won"]) for c in chain.cas_calls] == [(5, missing, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_the_lane_keeps_publishing_after_the_missing_head_is_replaced_by_our_own_object(chain, store, parked):
    _legacy_manifest(chain, BASE)
    chain.objects.pop(chain.head_key)
    for i in range(3):
        submit(store, BASE + PILOTS_NEW + ["euro_wind_wind_global_mid_202611%02dT000000Z.json" % (1 + i)])
        parked.run()
    assert [c["won"] for c in chain.cas_calls] == [True, True, True]


def test_a_writer_that_commits_while_we_merge_against_the_legacy_manifest_wins_over_us(chain, store, parked):
    """The legacy manifest.json may be stale; what makes the fallback safe is the swap's key filter."""
    _legacy_manifest(chain, BASE)
    missing = chain.head_key
    chain.objects.pop(missing)
    submit(store, BASE + PILOTS_NEW)
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert [(c["expected_key"], c["won"]) for c in chain.cas_calls] == [(missing, False), (chain.cas_calls[1]["expected_key"], True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_a_transient_failure_fetching_the_head_is_never_taken_for_a_missing_object(chain, store, parked, sleeps):
    """The legacy manifest.json is STALE (it lacks core's frames). A 5xx or a timeout on the head GET is not 'the object is
    gone': merging against the legacy file here would publish a snapshot that erases them."""
    chain.foreign_publish(adding(*LATTICE))
    _legacy_manifest(chain, BASE)
    chain.fetch_faults.extend(["none"] * 5)
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.kinds("fetch_legacy") == [] and chain.cas_calls == []
    assert chain.head_files() == sorted(BASE + LATTICE)


def test_a_missing_head_object_and_an_unreadable_legacy_manifest_is_a_failed_attempt(chain, store, parked, sleeps, caplog):
    chain.objects.pop(chain.head_key)                                  # and there is no legacy manifest.json either
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.cas_calls == [] and chain.uploads == []
    assert len(chain.kinds("fetch_legacy")) == 5 and len(sleeps) == 4
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
