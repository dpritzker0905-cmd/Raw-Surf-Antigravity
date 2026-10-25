"""MANIFEST_PUBLISH_ONE_STEP, round 8: what a head is, what an unconfirmed swap's view may judge, and how loudly each failure speaks.

1. The view of an unconfirmed swap (the head's entries for the ids it excluded) judges only the exclusions that swap's snapshot or an
   older one named. A LATER prune of the same id is a new fact about a new deletion.
2. A head so deeply nested that json.loads raises RecursionError is a head this interpreter cannot read: the same bucket as bad JSON
   (not a manifest), with the key and the exception TYPE named. A RecursionError raised by the MERGE stays fail-closed.
3. A head with an integer literal longer than Python's limit is unparseable by this interpreter, whatever any other reader makes of
   it: it is treated as not a manifest too (documented, not special-cased).
4. The failure counters behind the ::error:: cadence restart when an attempt succeeds, so a second episode is annotated from its
   first failure.
5. The pins of behaviour that was only implied: an all-junk head is authoritative-empty, filename-only entries survive, a
   KeyboardInterrupt/SystemExit is never a merge failure, and exactly one thread publishes."""
import json
import logging
import sys
from datetime import timedelta

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, LATTICE, PILOTS_NEW, RUN_TIME, _iso, _raw_wind, _snapshot, adding, changing, chain, parked, store, submit,
)

X = BASE[0]


def legacy(chain, files):
    from tests._manifest_chain_harness import dump_manifest_for_l2
    chain.objects["manifest.json"] = dump_manifest_for_l2(_snapshot(files))


def _w_re_registers(chain, name=X):
    chain.foreign_publish(changing(name, run_time=_iso(RUN_TIME + timedelta(hours=6))))


# ── 1. the view judges only the exclusions the swap's snapshot (or an older one) named ───────────────────────────────────────

def test_a_second_prune_of_x_after_w_re_registered_it_is_not_judged_by_the_stale_view(chain, store, parked):
    """The reviewer's P3. A prunes X; A's swap is unconfirmed and did NOT land; A gives up. W re-registers X. C prunes X AGAIN (the
    object W registered is deleted this time): that exclusion is a fresh fact, not 'a re-registration since the swap'."""
    chain.cas_faults = ["error"]
    chain.pointer_faults = [None] + ["none"] * 5
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert len(chain.cas_calls) == 1 and X in chain.head_files(), "the swap did not land: its view is still the slot's memory"
    _w_re_registers(chain)
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]], exclude_keys=[X])
    parked.run()
    assert X not in chain.head_files(), "the second prune of X was dropped: the old view judged it a re-registration"


def test_control_a_fresh_slot_honours_the_same_second_prune(chain, store, parked):
    _w_re_registers(chain)
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]], exclude_keys=[X])
    parked.run()
    assert X not in chain.head_files()


def test_the_view_still_judges_an_exclusion_inherited_from_an_older_snapshot(chain, store, parked):
    """A prunes X and sends nothing; B (newer, inherits X) sends the unconfirmed swap, so the view's sequence is B's and X's is older."""
    chain.pointer_faults = ["none"] * mps.MAX_ATTEMPTS
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert chain.cas_calls == [] and mps._slot.pending is not None
    chain.cas_faults = ["error"]

    def w_registers_x_while_the_swap_is_in_flight():
        chain.foreign_publish(changing(X, run_time=_iso(RUN_TIME + timedelta(hours=6))))
    chain.before_cas = w_registers_x_while_the_swap_is_in_flight
    submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]])
    parked.run()
    assert X in chain.head_files(), "W's registration of X was erased: the view did not cover an exclusion inherited from an older snapshot"


def test_the_views_sequence_is_the_swaps_snapshot_not_the_latest_submit(chain, store, parked, monkeypatch):
    """B arrives DURING A's unconfirmed swap and prunes X itself; W re-registers X afterwards. B's exclusion was named after the swap, so
    that swap's view (taken for A's snapshot) does not judge it: the exclusion stands (the rule the module docstring states)."""
    chain.cas_faults = ["error"]
    chain.pointer_faults = [None] + ["none"] * 5
    chain.before_cas = lambda: submit(store, BASE[1:] + PILOTS_NEW + [LATTICE[0]], exclude_keys=[X])
    landed, real_settle = [], mps._settle

    def settle(slot, current, published):
        if not published and not landed:
            landed.append(1)
            _w_re_registers(chain)
        return real_settle(slot, current, published)
    monkeypatch.setattr(mps, "_settle", settle)
    submit(store, BASE[1:] + PILOTS_NEW, exclude_keys=[X])
    parked.run()
    assert landed and len(chain.cas_calls) == 2 and X not in chain.head_files()


def test_the_view_of_the_newest_unconfirmed_swap_replaces_the_older_one_it_is_not_a_union():
    pending = mps._Pending(None, b"{}", {"a": 1, "b": 2}, 2)
    mps._remember(pending, "manifests/k1", b"x", 6, {"a": {"e": 1}})
    mps._remember(pending, "manifests/k2", b"y", 6, {"b": {"e": 2}})
    assert mps._slot.unconfirmed == (2, {"b": {"e": 2}}), mps._slot.unconfirmed


# ── 2. a head too deeply nested to parse ─────────────────────────────────────────────────────────────────────────────────────

def _parse_failure_lines(out):
    return [line for line in out.splitlines() if line.startswith("::error::") and "could not be read as a manifest" in line]


def test_a_real_deeply_nested_head_is_not_a_manifest_and_self_heals_through_the_legacy_file(chain, store, parked, sleeps, caplog, capsys):
    legacy(chain, BASE + LATTICE)
    head = chain.head_key
    chain.objects[head] = b"[" * 100000                      # json.loads raises RecursionError on this, for real
    submit(store, BASE + PILOTS_NEW)
    with caplog.at_level(logging.WARNING):
        parked.run()
    out = capsys.readouterr().out
    assert [(c["expected_key"], c["won"]) for c in chain.cas_calls] == [(head, True)] and len(sleeps) == 3
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    fallback = next(r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR and "treating it as unusable" in r.getMessage())
    assert head in fallback and "RecursionError" in fallback, fallback
    lines = _parse_failure_lines(out)
    assert len(lines) == 1 and head in lines[0] and "RecursionError" in lines[0] and "failure #1)" in lines[0], lines
    assert "[[[" not in out and not any("[[[" in r.getMessage() for r in caplog.records), "head contents must never be logged"


def test_a_recursion_error_raised_by_the_merge_stays_fail_closed(chain, store, parked, sleeps, capsys, monkeypatch):
    legacy(chain, BASE + LATTICE)
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload",
                        lambda *args, **kwargs: (_ for _ in ()).throw(RecursionError("in the merge")))
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    out = capsys.readouterr().out
    assert chain.cas_calls == [] and chain.uploads == [] and chain.kinds("fetch_legacy") == [] and mps._slot.unusable == {}
    assert any("RecursionError" in line and "merging the snapshot" in line for line in out.splitlines() if line.startswith("::error::"))


@pytest.mark.parametrize("bad,kind", [("garbage", "JSONDecodeError"), ("not_a_manifest", "ValueError"), ("json_list", "ValueError")])
def test_every_kind_of_not_a_manifest_head_is_annotated_with_the_key_and_the_exception_type(chain, store, parked, sleeps, capsys, bad, kind):
    heads = {"garbage": b"<html>502 Bad Gateway</html>", "not_a_manifest": b'{"last_manifest_update": "x"}', "json_list": b"[1, 2, 3]"}
    chain.objects[chain.head_key] = heads[bad]
    legacy(chain, BASE + LATTICE)
    head = chain.head_key
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    out = capsys.readouterr().out
    lines = _parse_failure_lines(out)
    assert len(lines) == 1 and head in lines[0] and kind in lines[0], lines
    assert "502 Bad Gateway" not in out and "last_manifest_update" not in out, "contents must never be annotated"


# ── 3. an integer literal this interpreter refuses ──────────────────────────────────────────────────────────────────────────

def test_a_head_with_an_integer_literal_longer_than_pythons_limit_is_unparseable_here_and_self_heals_through_the_legacy_file(
        chain, store, parked, sleeps, capsys):
    """Documented in KNOWN LIMITS, not special-cased: json.loads raises ValueError, so by this interpreter the head is not a manifest."""
    previous = sys.get_int_max_str_digits()
    sys.set_int_max_str_digits(4300)
    try:
        legacy(chain, BASE + LATTICE)
        head = chain.head_key
        raw = chain.objects[head].decode()
        chain.objects[head] = (raw[:-1].rstrip() + ', "huge": ' + "9" * 5000 + "}").encode()
        with pytest.raises(ValueError):
            json.loads(chain.objects[head])
        submit(store, BASE + PILOTS_NEW)
        parked.run()
    finally:
        sys.set_int_max_str_digits(previous)
    lines = _parse_failure_lines(capsys.readouterr().out)
    assert [(c["expected_key"], c["won"]) for c in chain.cas_calls] == [(head, True)] and len(sleeps) == 3
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)
    assert len(lines) == 1 and "ValueError" in lines[0] and "999999" not in lines[0]


# ── 4. the cadence restarts when an attempt succeeds ────────────────────────────────────────────────────────────────────────

def test_the_merge_failure_cadence_restarts_after_a_successful_merge(chain, store, parked, sleeps, capsys, monkeypatch):
    real = store_mod.reconcile_manifest_products_for_upload
    failing = {"left": 2}

    def flaky(manifest, exclude_keys=None, remote_products=None):
        if remote_products is not None and failing["left"] > 0:
            failing["left"] -= 1
            raise TypeError("boom")
        return real(manifest, exclude_keys=exclude_keys, remote_products=remote_products)
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload", flaky)
    submit(store, BASE + PILOTS_NEW)
    parked.run()                                        # failure #1 (annotated), failure #2, then a success
    first = [line for line in capsys.readouterr().out.splitlines() if "merging the snapshot" in line]
    assert len(first) == 1 and "failure #1)" in first[0] and mps._slot.merge_failures == 0 and len(chain.wins()) == 1
    submit(store, BASE + PILOTS_NEW + LATTICE)          # (its absorb of the published head runs the reconcile on this thread)
    failing["left"] = 1
    parked.run()                                        # a NEW episode: its first failure is annotated again
    second = [line for line in capsys.readouterr().out.splitlines() if "merging the snapshot" in line]
    assert len(second) == 1 and "failure #1)" in second[0], second


def test_the_parse_failure_cadence_restarts_after_a_successful_parse(chain, store, parked, sleeps, capsys, monkeypatch):
    from services.weather_pipeline import manifest_pointer as mp
    good, real, garbage = chain.objects[chain.head_key], chain.fetch_manifest_object, [b"<html>bad</html>"] * 2

    def fetch(key, timeout=None):
        return garbage.pop(0) if garbage else real(key, timeout=timeout)
    monkeypatch.setattr(mp, "fetch_manifest_object", fetch)
    submit(store, BASE + PILOTS_NEW)
    parked.run()                                        # two unparseable reads (#1 annotated, #2), then the real head: a win
    first = _parse_failure_lines(capsys.readouterr().out)
    assert len(first) == 1 and "failure #1)" in first[0] and mps._slot.parse_failures == 0 and len(chain.wins()) == 1 and good
    garbage.append(b"<html>bad again</html>")
    submit(store, BASE + PILOTS_NEW + LATTICE)
    parked.run()
    second = _parse_failure_lines(capsys.readouterr().out)
    assert len(second) == 1 and "failure #1)" in second[0], second


# ── 5. pins of behaviour that was only implied ──────────────────────────────────────────────────────────────────────────────

def test_an_all_junk_head_is_authoritative_empty_the_legacy_file_is_not_consulted(chain, store, parked, sleeps):
    """A head that parses as a manifest is real state even when no entry in it is usable: entries only the legacy file has are absent."""
    legacy(chain, BASE + LATTICE)
    chain.objects[chain.head_key] = json.dumps({"products": [123, "x", None]}).encode()
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.head_files() == sorted(BASE + PILOTS_NEW) and chain.kinds("fetch_legacy") == [] and sleeps == []


def test_an_empty_products_list_is_authoritative_empty_too(chain, store, parked, sleeps):
    legacy(chain, BASE + LATTICE)
    chain.objects[chain.head_key] = json.dumps({"products": []}).encode()
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert chain.head_files() == sorted(BASE + PILOTS_NEW) and chain.kinds("fetch_legacy") == []


def test_filename_only_entries_registered_by_another_writer_survive_a_publish(chain, store, parked):
    """ManifestProduct.product_id is Optional, so older production entries carry only a filename (or product_id null / missing)."""
    def w(products):
        null_id = dict(_raw_wind(LATTICE[0]), product_id=None)
        missing_id = dict(_raw_wind(LATTICE[1]))
        del missing_id["product_id"]
        return products + [null_id, missing_id]
    chain.foreign_publish(w)
    submit(store, BASE + PILOTS_NEW)
    parked.run()
    assert LATTICE[0] in chain.head_files() and LATTICE[1] in chain.head_files()


@pytest.mark.parametrize("interrupt", [KeyboardInterrupt, SystemExit], ids=["KeyboardInterrupt", "SystemExit"])
def test_an_interrupt_raised_in_the_merge_propagates_and_is_not_a_merge_failure(chain, store, parked, monkeypatch, capsys, interrupt):
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload",
                        lambda *args, **kwargs: (_ for _ in ()).throw(interrupt()))
    submit(store, BASE + PILOTS_NEW)
    with pytest.raises(interrupt):
        parked.run()
    assert mps._slot.merge_failures == 0 and "::error::" not in capsys.readouterr().out


def test_the_manifest_executor_has_exactly_one_worker():
    """KNOWN LIMITS (11): the unlocked read in `_effective_excludes` and the two-step read-then-clear in `_adopt_landed` are safe only
    because ONE thread publishes (this executor, then the exit flush after its join). A second worker breaks that: fix those first."""
    assert store_mod._manifest_executor._max_workers == 1
