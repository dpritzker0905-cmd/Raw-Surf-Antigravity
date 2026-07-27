"""
The admin Import button reported success while importing nothing (2026-07-27).

The owner said: "We added some, and I don't see them visible in the admin yet." Nothing was hidden
— nothing was written. `surf_spots.created_at` has no row newer than 2026-04-23 and
`spot_edit_logs` none newer than 2026-07-13.

Root: `import_curated_spots` reads 358 hardcoded `CURATED_SPOTS` and skips anything already present
by (name, country). The catalogue already contains all of them, so a CORRECT run imports ZERO — and
the handler fired `toast.success(response.data.message)` regardless, where the message read
"Imported 0 spots for All".

The import is idempotent by design and that is fine. Reporting it as a win is not.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


class _Result:
    def __init__(self, existing):
        self._existing = existing

    def scalar_one_or_none(self):
        return self._existing


class _DB:
    """Pretends every spot already exists (the production state) unless told otherwise."""

    def __init__(self, existing=True):
        self.existing = existing
        self.added = []
        self.commits = 0

    async def execute(self, *_a, **_kw):
        return _Result(object() if self.existing else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_import_reports_skipped_count_when_everything_exists():
    """THE regression: a run that adds nothing must say how many it skipped, so the caller can
    tell 'already complete' apart from 'broken'."""
    from scripts.import_global_spots import import_curated_spots, CURATED_SPOTS
    db = _DB(existing=True)
    imported, skipped = await import_curated_spots(db, return_detail=True)
    assert imported == 0
    assert skipped == len(CURATED_SPOTS)
    assert db.added == []


@pytest.mark.asyncio
async def test_import_counts_new_rows_when_they_are_missing():
    from scripts.import_global_spots import import_curated_spots, CURATED_SPOTS
    db = _DB(existing=False)
    imported, skipped = await import_curated_spots(db, return_detail=True)
    assert imported == len(CURATED_SPOTS)
    assert skipped == 0
    assert len(db.added) == len(CURATED_SPOTS)


@pytest.mark.asyncio
async def test_return_detail_is_opt_in_so_existing_callers_keep_working():
    """Other call sites treat the result as a bare int — the signature change must be additive."""
    from scripts.import_global_spots import import_curated_spots
    got = await import_curated_spots(_DB(existing=True))
    assert isinstance(got, int) and got == 0


def test_the_message_does_not_claim_a_win_on_zero():
    """The endpoint's message is what the toast shows. On zero it must not read like an import."""
    import inspect
    from routes.surf_spots import admin_spots
    src = inspect.getsource(admin_spots.trigger_spot_import)
    assert "skipped_existing" in src, "the skipped count must reach the caller"
    assert "No new spots" in src, "zero-import must produce a distinct, non-celebratory message"


def test_osm_leg_is_no_longer_gated_on_a_tier_the_ui_never_sends():
    """`if include_osm and tier > 0` meant the OSM checkbox did nothing in the default UI state
    (AdminSpotsPanel defaults importTier to 0), while the toast still reported success."""
    import inspect
    from routes.surf_spots import admin_spots
    src = inspect.getsource(admin_spots.trigger_spot_import)
    assert "if include_osm and tier > 0:" not in src, (
        "the OSM leg is gated on tier again — it will silently no-op at the UI default")
