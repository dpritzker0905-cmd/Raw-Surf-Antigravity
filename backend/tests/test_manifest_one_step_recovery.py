"""MANIFEST_PUBLISH_ONE_STEP: two ways a publish can be stuck, and how it gets itself unstuck (round-5 findings 2 and 3).

2. A swap that LANDED but whose answer was lost (a timeout or 5xx after the server applied it) used to be re-published from scratch:
   the retry merged again with the same exclusions, and if another writer had re-registered the pruned key in between, the retry
   erased that registration. Now: (a) the pointer is looked at straight after an unconfirmed swap and again at the start of every
   attempt, and a head that IS one of the objects this publish uploaded is settled as a win (retention, legacy refresh, exclusions
   spent); (b) when the head has already moved past ours, landing can no longer be observed (the row we wrote is overwritten and the
   objects carry no parent link), so the retry treats the swap as not landed EXCEPT for one thing it can see: an excluded id whose
   entry in the head has CHANGED since the unconfirmed attempt saw it is another writer's newer registration, and is kept.

3. A head that is valid JSON but not a manifest (or not JSON at all) stalled every publish for good. After
   UNUSABLE_HEAD_ATTEMPTS consecutive attempts on the SAME such head key it is treated like a definitely-missing one: the merge is
   made against the legacy manifest.json and the swap still names generation g AND that key, so a head that moved wins over us."""
import logging
from datetime import timedelta

import pytest

from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, LATTICE, PILOTS_NEW, RUN_TIME, UNIQUE_KEY, _raw_wind, _snapshot, adding, chain, parked, store, submit,
)

X = BASE[0]                                             # the key this process pruned


def newer_x(products):
    """Another writer registers X again: a NEW entry (a later run), the way a real re-registration looks."""
    return products + [_raw_wind(X, run_time=RUN_TIME + timedelta(hours=6))]


# ── 2. a swap that landed although its answer was lost ───────────────────────────────────────────────────────────────────

def test_a_swap_whose_answer_was_lost_is_settled_as_a_win_and_not_published_a_second_time(chain, store, parked, sleeps):
    chain.cas_faults = ["lost_ack"]                     # the row advances to OUR object; the answer never comes back
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True)], "the landed swap was published again"
    assert chain.generation == 6 and chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert sleeps == [], "looking at the pointer straight away needs no backoff"
    assert len(chain.list_requests) == 1, "a settled win runs retention exactly like a confirmed one"
    assert chain.objects["manifest.json"] == chain.objects[chain.head_key] and chain.nested_publishes == [None]
    assert mps._slot.pending is None and mps._slot.head is not None


def test_the_settled_win_spends_the_exclusion_so_the_next_publish_does_not_carry_it(chain, store, parked):
    chain.cas_faults = ["lost_ack"]
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert X not in chain.head_files()
    chain.foreign_publish(adding(X))                    # a later, legitimate re-registration
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    parked.run()
    assert X in chain.head_files(), "a spent exclusion rode along and erased another writer's registration"


def test_a_pointer_that_cannot_be_read_straight_after_the_lost_answer_is_recognised_at_the_next_attempt(
        chain, store, parked, sleeps):
    chain.cas_faults = ["lost_ack"]
    chain.pointer_faults = [None, "none"]               # the first read (the attempt) works; the one right after the swap fails
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True)] and chain.generation == 6
    assert len(sleeps) == 1


def test_an_unconfirmed_swap_that_did_not_land_is_not_mistaken_for_a_win(chain, store, parked):
    chain.cas_faults = ["error"]                        # a 5xx: nothing was applied
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [c["won"] for c in chain.cas_calls] == [False, True] and chain.generation == 6


def test_ack_lost_then_another_writer_re_registers_the_pruned_key_the_registration_survives(chain, store, parked):
    """The reviewer's P7. Our swap lands (the answer is lost) and, before we can look, another writer registers X again with a NEWER
    entry and moves the head past ours. The head no longer names our object, so landing cannot be observed; the entry in the head is
    not the one the unconfirmed attempt saw, so it is not the entry we pruned."""
    chain.cas_faults = ["lost_ack_then_foreign"]
    chain.after_landing = lambda: chain.foreign_publish(newer_x)
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert X in chain.head_files(), "the other writer's registration of X was erased by an exclusion our landed swap had spent"
    assert chain.head_entry(X)["run_time"] != _raw_wind(X)["run_time"], "the entry in the head must be THEIRS"
    assert set(PILOTS_NEW) <= set(chain.head_files())


def test_ack_lost_then_an_unrelated_write_moves_the_head_past_ours_nothing_is_resurrected_and_nothing_is_lost(chain, store, parked):
    chain.cas_faults = ["lost_ack_then_foreign"]
    chain.after_landing = lambda: chain.foreign_publish(adding(*LATTICE))
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW)
    assert mps._slot.pending is None


def test_a_swap_that_really_lost_still_excludes_the_pruned_key_the_head_still_names_unchanged(chain, store, parked):
    """The refinement must not weaken the exclusion: another writer won the generation, the head still holds the entry we
    pruned (byte for byte what we saw), so it stays out."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    chain.before_cas = lambda: chain.foreign_publish(adding(*LATTICE))
    parked.run()
    assert [c["won"] for c in chain.cas_calls] == [False, True]
    assert chain.head_files() == sorted(BASE[1:] + LATTICE + PILOTS_NEW) and X not in chain.head_files()


def test_after_a_clean_loss_the_exclusion_is_exactly_what_it_was_even_for_a_changed_entry(chain, store, parked):
    """The 'changed entry is another writer's' rule is for a swap that MAY have landed. A swap that answered "precondition lost"
    certainly did not, so the exclusion applies in full: the entry in the head is still the one whose object we deleted."""
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    chain.before_cas = lambda: chain.foreign_publish(lambda products: [p for p in products if p["filename"] != X] + [
        _raw_wind(X, run_time=RUN_TIME + timedelta(hours=6))])
    parked.run()
    assert [c["won"] for c in chain.cas_calls] == [False, True]
    assert X not in chain.head_files()


# ── 3. a head that cannot be parsed ───────────────────────────────────────────────────────────────────────────────────────

BAD_HEADS = {"garbage": b"<html>502 Bad Gateway</html>", "not_a_manifest": b'{"last_manifest_update": "x"}',
             "json_list": b"[1, 2, 3]"}


def legacy(chain, files):
    from tests._manifest_chain_harness import dump_manifest_for_l2
    chain.objects["manifest.json"] = dump_manifest_for_l2(_snapshot(files))


@pytest.mark.parametrize("bad", sorted(BAD_HEADS))
def test_an_unparseable_head_is_merged_against_the_legacy_manifest_after_three_failed_attempts(chain, store, parked, sleeps, caplog, bad):
    assert mps.UNUSABLE_HEAD_ATTEMPTS == 3
    legacy(chain, BASE + LATTICE)
    head = chain.head_key
    chain.objects[head] = BAD_HEADS[bad]
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert [(c["expected"], c["expected_key"], c["won"]) for c in chain.cas_calls] == [(5, head, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    assert len(sleeps) == 3 and len(chain.kinds("fetch_legacy")) == 1
    assert any(r.levelno >= logging.ERROR and head in r.getMessage() for r in caplog.records), "the unusable head's key must be in the ERROR"


def test_transient_failures_between_the_unparseable_reads_neither_count_nor_reset_the_count(chain, store, parked, sleeps):
    legacy(chain, BASE + LATTICE)
    chain.objects[chain.head_key] = BAD_HEADS["garbage"]
    chain.fetch_faults = ["ok", "none", "ok", "none", "ok"]       # garbage, transient, garbage, transient, garbage
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.cas_calls == [] and chain.kinds("fetch_legacy") == [], "a transient failure counted toward the three"
    sleeps_before = len(sleeps)
    submit(store, BASE + PILOTS_NEW + [LATTICE[0]])
    parked.run()
    assert [c["won"] for c in chain.cas_calls] == [True], "the three unparseable reads did not carry over to the next job"
    assert len(sleeps) == sleeps_before, "the next job should fall back on its FIRST attempt: the count was lost between jobs"


def test_an_unparseable_head_that_has_moved_by_the_time_we_swap_is_never_overwritten(chain, store, parked, sleeps):
    legacy(chain, BASE)
    head = chain.head_key
    chain.objects[head] = BAD_HEADS["garbage"]
    submit(store, BASE + PILOTS_NEW)
    real_upload = chain.upload

    def upload(key, data, **kw):
        if len(chain.kinds("fetch_legacy")) == 1 and not chain.cas_calls:
            chain.foreign_publish(adding(*LATTICE), key="unique")      # a healthy head replaces the bad one meanwhile
        return real_upload(key, data, **kw)
    chain.upload = upload
    parked.run()
    assert [(c["expected_key"], c["won"]) for c in chain.cas_calls][0] == (head, False), "the swap must name the key it merged against"
    assert set(LATTICE) <= set(chain.head_files()) and chain.cas_calls[-1]["won"] is True


def test_a_parseable_head_clears_the_count(chain, store, parked, sleeps):
    bad = chain.head_key
    chain.objects[bad] = BAD_HEADS["garbage"]
    legacy(chain, BASE)
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert [c["won"] for c in chain.cas_calls] == [True]
    assert mps._slot.unusable == {bad: 3}, "three unparseable reads of that key, then the fall-back"
    submit(store, BASE + PILOTS_NEW + [LATTICE[0]])                  # the head is our own object now: it parses
    parked.run()
    assert mps._slot.unusable == {}, "a parseable head must clear the count"


def test_an_unparseable_head_and_an_unreadable_legacy_manifest_stay_a_failed_attempt(chain, store, parked, sleeps, caplog):
    chain.objects[chain.head_key] = BAD_HEADS["garbage"]             # and no legacy manifest.json at all
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert chain.cas_calls == [] and chain.uploads == [] and chain.generation == 5
    assert len(chain.kinds("fetch_legacy")) == 2                     # attempts 4 and 5 tried it


# ── a job that ran out of attempts before it could look: the NEXT snapshot inherits what it did not learn ────────────────

def _exhaust_after_an_unheard_landing(chain, store, parked):
    chain.cas_faults = ["lost_ack"]
    chain.pointer_faults = [None] + ["none"] * 5          # the attempt's read works; every look afterwards fails
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert chain.generation == 6 and mps._slot.pending is not None, "the swap landed and its job gave up"


def test_the_next_snapshot_recognises_an_older_snapshots_unheard_landing_and_spends_its_exclusions(chain, store, parked, caplog):
    _exhaust_after_an_unheard_landing(chain, store, parked)
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    with caplog.at_level(logging.WARNING):
        parked.run()
    assert "an older snapshot's swap" in caplog.text
    assert mps._slot.pending is None and X not in chain.head_files()
    assert [c["won"] for c in chain.cas_calls] == [True, True]


def test_the_next_snapshot_keeps_the_changed_entry_when_the_head_has_moved_past_the_unheard_landing(chain, store, parked):
    _exhaust_after_an_unheard_landing(chain, store, parked)
    chain.foreign_publish(newer_x)                         # someone registers X again: a different entry, in a head that is not ours
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    parked.run()
    assert X in chain.head_files(), "the carried exclusion erased another writer's newer registration"
