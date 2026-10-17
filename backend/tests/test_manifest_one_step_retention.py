"""MANIFEST_PUBLISH_ONE_STEP: the unique create-only manifest objects are retired by the lane's OWN retention (round-4 finding P9).

manifest_immutable.prune_immutable_copies keeps EVERY copy younger than an hour whatever its generation. That is fine for a
writer that publishes every few minutes and ruinous for this lane, which publishes after every coalesced save: 300 copies at 8 s
spacing, none deleted, about 16 MB each. The lane therefore retires its own copies after each WON swap at generation G: ONE bounded
listing, and ONE bounded batch delete of the objects whose generation is <= G-5 AND that are older than a short grace. The chain
fixture does not stub retention: it runs for real against the Chain's Storage and clock."""
import logging
from datetime import timedelta

import pytest

from services.weather_pipeline import manifest_publish_step as mps
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import BASE, PILOTS_NEW, chain, inline, store, submit  # noqa: F401,F811


def copy_key(generation, tag="ab"):
    return "manifests/manifest-g%012d-%s.json" % (generation, tag * 16)


def settle_at(chain, generation):
    """The pointer is at `generation`, naming a unique-named object, as a one-step lane leaves it."""
    chain.generation, chain.head_key = generation, copy_key(generation, "cd")
    chain.objects[chain.head_key] = chain.objects[mps_base_key(chain)]
    chain.created[chain.head_key] = chain.now


def mps_base_key(chain):
    return next(key for key in chain.objects if key.startswith("manifests/"))


def seed(chain, generations, age_seconds, tag="ab"):
    for generation in generations:
        key = copy_key(generation, tag)
        chain.objects[key] = chain.objects[mps_base_key(chain)]
        chain.created[key] = chain.now - timedelta(seconds=age_seconds)


def generations_left(chain):
    return [int(key.split("-g")[1][:12]) for key in chain.copies()]


def publish(store, name="x"):
    submit(store, BASE + PILOTS_NEW + [name])


def test_a_won_swap_lists_once_and_deletes_in_one_batch_with_these_request_shapes(chain, store, inline):
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    publish(store)                                                  # wins generation 21: everything <= 16 is retired
    (list_url, list_body, list_timeout), = chain.list_requests
    assert list_url == "https://storage.invalid/storage/v1/object/list/weather-products"
    assert list_body == {"prefix": "manifests", "search": "manifest-g", "limit": 100, "offset": 0,
                         "sortBy": {"column": "name", "order": "asc"}}
    assert list_timeout == 5
    (delete_url, prefixes, delete_timeout), = chain.delete_requests
    assert delete_url == "https://storage.invalid/storage/v1/object/weather-products" and delete_timeout == 5
    assert sorted(prefixes) == [copy_key(g) for g in range(1, 17)]
    assert generations_left(chain) == [17, 18, 19, 20, 21]


def test_the_head_and_the_newest_generations_survive_however_old_they_are(chain, store, inline):
    """The head is generation G; the rule retires generation <= G-5 only. Even with every object ancient and the clock far
    ahead, the object the pointer names and the four before it are never touched."""
    settle_at(chain, 20)
    chain.created[chain.head_key] = chain.now - timedelta(days=30)
    seed(chain, range(1, 20), age_seconds=30 * 86400)
    publish(store)
    assert chain.head_key in chain.objects and generations_left(chain) == [17, 18, 19, 20, 21]
    assert chain.head_key not in {key for _, prefixes, _ in chain.delete_requests for key in prefixes}


def test_a_copy_touched_within_the_grace_is_kept_even_though_it_was_created_long_ago(chain, store, inline):
    """The age is the NEWER of created_at and updated_at (a reader, or a replaced object, restarts the grace): a fake whose two
    stamps differ, which the default one (created == updated) could never show."""
    settle_at(chain, 20)
    seed(chain, [3, 4], age_seconds=3600)
    chain.updated[copy_key(3)] = chain.now - timedelta(seconds=10)
    publish(store)
    assert 3 in generations_left(chain) and 4 not in generations_left(chain)


def test_a_copy_younger_than_the_grace_is_kept_even_when_its_generation_is_old(chain, store, inline):
    settle_at(chain, 20)
    seed(chain, range(1, 9), age_seconds=3600)
    seed(chain, range(9, 17), age_seconds=10)                       # generation <= 16 but written 10 s ago
    seed(chain, range(17, 20), age_seconds=10)
    publish(store)
    assert generations_left(chain) == list(range(9, 22))


def test_the_grace_is_a_floor_on_age_sixty_seconds_is_old_enough_and_fifty_nine_is_not(chain, store, inline):
    assert mps.RETENTION_GRACE_SECONDS == 60
    settle_at(chain, 20)
    seed(chain, [3], age_seconds=60)
    seed(chain, [4], age_seconds=59)
    publish(store)
    left = generations_left(chain)
    assert 3 not in left and 4 in left


def test_the_generation_rule_keeps_five_numbers_not_five_seconds(chain, store, inline):
    """Generation 17 is G-4 after the win to 21, and 16 is G-5: 16 goes, 17 stays, however old both are."""
    settle_at(chain, 20)
    seed(chain, [16, 17], age_seconds=9999)
    publish(store)
    assert 16 not in generations_left(chain) and 17 in generations_left(chain)


def test_300_back_to_back_publishes_leave_a_handful_of_copies_not_three_hundred(chain, store, inline):
    """P9's own scenario: one publish every 8 s. With the grace at 60 s a copy is retired once it is 8 generations behind."""
    for i in range(300):
        chain.now += timedelta(seconds=8)
        publish(store, "euro_wind_wind_global_mid_2027%04dT000000Z.json" % i)
    assert len(chain.wins()) == 300
    left = generations_left(chain)
    assert 5 <= len(left) <= 8, left
    assert left == list(range(left[0], left[0] + len(left))) and left[-1] == chain.generation
    assert len(chain.list_requests) == 300 and len(chain.delete_requests) <= 300, "one listing per win, at most one delete"


def test_copies_left_by_lost_attempts_are_retired_by_the_same_rule(chain, store, inline):
    chain.upload_faults = ["lost_ack"]                              # attempt 1's object LANDS at generation 6, unacknowledged
    publish(store, "a.json")
    orphan = [key for key in chain.copies() if key != chain.head_key and int(key.split("-g")[1][:12]) == 6]
    assert len(orphan) == 1
    for i in range(10):
        chain.now += timedelta(seconds=100)
        publish(store, "b%d.json" % i)
    assert orphan[0] not in chain.objects


def test_names_retention_does_not_recognise_are_never_deleted(chain, store, inline):
    settle_at(chain, 20)
    keep = ["manifests/manifest-g000000000001.json",                # the deterministic old-path name
            "manifests/readme.txt", "manifests/manifest-g000000000002-not-hex.json", "manifests/manifest-g2-" + "ab" * 16 + ".json"]
    for key in keep:
        chain.objects[key] = b"x"
        chain.created[key] = chain.now - timedelta(days=9)
    publish(store)
    assert all(key in chain.objects for key in keep)


def test_a_copy_whose_age_cannot_be_read_is_kept(chain, store, inline):
    class NotATime:
        def isoformat(self):
            return "some time ago"
    settle_at(chain, 20)
    seed(chain, [2], age_seconds=3600)
    chain.created[copy_key(2)] = NotATime()
    publish(store)
    assert copy_key(2) in chain.objects


@pytest.mark.parametrize("stamps", [{}, {"created_at": "2026-01-01T00:00:00"}, {"created_at": None, "updated_at": ""}],
                         ids=["no-timestamps", "naive-timestamp", "empty-timestamps"])
def test_a_row_without_a_usable_timezone_aware_timestamp_is_kept(chain, store, inline, stamps):
    settle_at(chain, 20)
    key = copy_key(2, "ee")
    chain.extra_rows.append(dict(name=key[len("manifests/"):], **stamps))             # Storage lists it; its age cannot be known
    publish(store)
    assert key not in {k for _, prefixes, _ in chain.delete_requests for k in prefixes}


def test_one_batch_is_capped_and_the_backlog_drains_over_the_next_wins(chain, store, inline):
    assert mps.RETENTION_DELETE_LIMIT == 50 and mps.RETENTION_SCAN_LIMIT == 100
    settle_at(chain, 130)
    seed(chain, range(1, 130), age_seconds=3600)
    publish(store)
    assert [len(prefixes) for _, prefixes, _ in chain.delete_requests] == [50]
    publish(store, "y.json")
    assert [len(prefixes) for _, prefixes, _ in chain.delete_requests] == [50, 50]


def test_a_lost_swap_retires_nothing(chain, store, inline):
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    chain.cas_faults = ["error"] * 5
    publish(store)
    assert chain.list_requests == [] and chain.delete_requests == []


@pytest.mark.parametrize("fault", ["raise", 500])
def test_a_failing_listing_never_undoes_the_win_or_skips_the_legacy_manifest(chain, store, inline, fault):
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    chain.list_fault = fault
    publish(store)
    assert len(chain.wins()) == 1 and chain.generation == 21
    assert chain.objects["manifest.json"] == chain.objects[chain.head_key], "the legacy refresh was skipped"
    assert chain.delete_requests == []


@pytest.mark.parametrize("fault", ["raise", 500])
def test_a_failing_delete_never_undoes_the_win_or_skips_the_legacy_manifest(chain, store, inline, fault):
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    chain.delete_fault = fault
    publish(store)
    assert len(chain.wins()) == 1 and chain.generation == 21
    assert chain.objects["manifest.json"] == chain.objects[chain.head_key]
    assert generations_left(chain) == list(range(1, 22)), "nothing was deleted, so nothing should be gone"


def test_without_storage_configuration_retention_is_skipped_quietly(chain, store, inline, monkeypatch):
    from services.weather_pipeline import manifest_pointer as mp
    monkeypatch.setattr(mp, "_rest_base_and_headers", lambda: (None, None))
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    publish(store)
    assert len(chain.wins()) == 1 and chain.list_requests == []


# ── the gauge: how many unique copies are standing, how many this win deleted (round-5 finding 6) ─────────────────────────

def test_one_info_line_after_retention_says_how_many_copies_stand_and_how_many_were_deleted(chain, store, inline, caplog):
    import re
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    with caplog.at_level(logging.INFO):
        publish(store)
    lines = [r.getMessage() for r in caplog.records if r.levelno == logging.INFO and "retention" in r.getMessage()]
    assert len(lines) == 1, lines
    match = re.search(r"(\d+) unique manifest cop\w+ standing.* (\d+) deleted", lines[0])
    assert match and (int(match[1]), int(match[2])) == (21, 16), lines[0]


def test_the_gauge_says_so_when_the_listing_was_capped_and_when_nothing_was_deleted(chain, store, inline, caplog):
    settle_at(chain, 130)
    seed(chain, range(100, 130), age_seconds=10)                    # nothing old enough
    seed(chain, range(1, 100), age_seconds=10)
    with caplog.at_level(logging.INFO):
        publish(store)
    line = next(r.getMessage() for r in caplog.records if r.levelno == logging.INFO and "retention" in r.getMessage())
    assert "0 deleted" in line and "capped" in line and "100" in line, line


def test_the_gauge_says_its_standing_count_is_taken_before_this_delete(chain, store, inline, caplog):
    """21 standing and 16 deleted reads like a contradiction until you know 21 is the listing BEFORE the delete (5 are left)."""
    settle_at(chain, 20)
    seed(chain, range(1, 20), age_seconds=3600)
    with caplog.at_level(logging.INFO):
        publish(store)
    line = next(r.getMessage() for r in caplog.records if r.levelno == logging.INFO and "retention" in r.getMessage())
    assert "standing before this delete" in line, line
