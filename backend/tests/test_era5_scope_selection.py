"""`--limit` was applied BEFORE the resume filter, so the nightly ERA5 task meant
"the first 150 spots by id" — forever.

MASTER AUDIT 1.0 §3. `_all_spots` pages `order=id`, so the catalogue order is stable. The old
sequence was:

    spots = _all_spots(...)          # 1,773 spots, ordered by id
    spots = spots[:args.limit]       # <- take the first 150 BY ID
    spots = [s for s in spots if s["id"] not in done]     # then drop the ones already done

Once those first 150 are banked, every subsequent run selects the same 150 ids, removes all of
them as done, and fetches NOTHING. The task keeps exiting 0 and printing "spots in scope: 0",
which is indistinguishable from "the catalogue is finished". It never reaches spot 151.

★ THE FAILING INSTANCE IS THE TEST. `test_a_capped_run_ADVANCES_instead_of_freezing` walks a
catalogue in batches the way a nightly job does and asserts it reaches the end. Under the old
ordering that loop never terminates past the first batch — which is exactly the production
symptom, reproduced in-process with no network.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.era5_deepen_climatology import select_scope  # noqa: E402


def _spots(n, start=0):
    """A catalogue in `order=id` form, ids zero-padded so string sort == numeric sort."""
    return [{"id": f"{i:04d}", "name": f"spot-{i}"} for i in range(start, start + n)]


def test_limit_selects_the_next_undone_spots_not_the_first_ids():
    """The whole defect in one assertion: with the first 3 ids already banked, `--limit 3` must
    return ids 3,4,5 — not an empty batch."""
    catalogue = _spots(10)
    done = {"0000", "0001", "0002"}
    batch, remaining = select_scope(catalogue, limit=3, done=done)
    assert [s["id"] for s in batch] == ["0003", "0004", "0005"], (
        "the slice ran before the resume filter — this batch is the frozen head of the catalogue")
    assert remaining == 7


def test_a_capped_run_ADVANCES_instead_of_freezing():
    """⭐ THE PRODUCTION SYMPTOM, reproduced. Walk a 1,773-spot catalogue in nightly batches of
    150 and require that it actually finishes. Under `spots[:limit]` before the resume filter this
    loop stalls at 150 banked and never grows again."""
    catalogue = _spots(1773)
    done, rounds = set(), 0
    while rounds < 100:
        batch, remaining = select_scope(catalogue, limit=150, done=done)
        if not batch:
            break
        assert batch, "a nightly run selected nothing while work remained"
        done |= {s["id"] for s in batch}
        rounds += 1
    assert len(done) == 1773, f"campaign froze after {len(done)} of 1773 spots in {rounds} rounds"
    assert rounds == 12, f"1773/150 should take 12 rounds, took {rounds}"


def test_query_still_scopes_BEFORE_the_resume_filter():
    """`--query` is a scope selector (which spots am I asking about), not a batch size. It must
    keep filtering the catalogue itself, and it composes with the resume filter."""
    catalogue = [{"id": "a", "name": "Padang Padang"}, {"id": "b", "name": "Bingin"},
                 {"id": "c", "name": "Uluwatu"}]
    batch, remaining = select_scope(catalogue, query="bingin,uluwatu", done={"b"})
    assert [s["id"] for s in batch] == ["c"]
    assert remaining == 1, "remaining must count the QUERIED scope, not the whole catalogue"


def test_no_limit_means_everything_that_still_needs_work():
    batch, remaining = select_scope(_spots(5), limit=0, done={"0001"})
    assert [s["id"] for s in batch] == ["0000", "0002", "0003", "0004"]
    assert remaining == 4


def test_remaining_is_reported_so_a_cap_is_never_silent():
    """A capped run and a finished catalogue must not print the same thing. `n_remaining` is what
    lets the caller say how many were deferred — no silent caps."""
    batch, remaining = select_scope(_spots(500), limit=150, done=set())
    assert len(batch) == 150 and remaining == 500

    finished_batch, finished_remaining = select_scope(
        _spots(500), limit=150, done={f"{i:04d}" for i in range(500)})
    assert finished_batch == [] and finished_remaining == 0
    # the discriminator: batch is empty in one case because of a cap, in the other because the
    # work is done — and `remaining` is the ONLY field that tells them apart.
    assert remaining != finished_remaining


def test_a_done_set_that_covers_everything_yields_no_work_rather_than_the_whole_catalogue():
    """Fail-closed: an empty batch must never be re-interpreted as 'do them all'."""
    catalogue = _spots(20)
    batch, remaining = select_scope(catalogue, limit=5, done={s["id"] for s in catalogue})
    assert batch == [] and remaining == 0
