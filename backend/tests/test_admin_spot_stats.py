"""
Contract test for /admin/spots/stats (2026-07-27).

The owner reported that spot changes were "not reflecting in the admin for surf spots". They were
right, and the cause was not caching: the endpoint only ever counted rows, countries and import
tiers. A correction that moved 1256 spots out of `is_verified_peak` and flagged 158 as
`low_accuracy` produced a byte-identical dashboard, because no number on it was a function of
those columns.

These pin that the accuracy/review state is actually measured and returned.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


class _Result:
    """Minimal stand-in for a SQLAlchemy Result."""

    def __init__(self, scalar=None, one=None, all_=None):
        self._scalar, self._one, self._all = scalar, one, all_ or []

    def scalar(self):
        return self._scalar

    def one(self):
        return self._one

    def all(self):
        return self._all


class _DB:
    """Replays a fixed sequence of results in the order get_spot_stats issues its queries."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = 0

    async def execute(self, *_a, **_kw):
        r = self._results[self.calls]
        self.calls += 1
        return r


def _stub_db(total=1516, active=1516, flagged=158, verified_peak=44, has_verifier=44,
             accuracy=(("unverified", 1314), ("low_accuracy", 158), ("verified", 36),
                       ("admin_verified", 8))):
    return _DB([
        _Result(scalar=total),                                 # total count
        _Result(one=(active, flagged, verified_peak, has_verifier)),   # accuracy aggregate
        _Result(all_=list(accuracy)),                          # by accuracy_flag
        _Result(all_=[("USA", 700), ("Australia", 200)]),      # by country
        _Result(all_=[(1, 900), (3, 616)]),                    # by tier
    ])


@pytest.mark.asyncio
async def test_stats_reports_the_review_workload():
    from routes.surf_spots.admin_spots import get_spot_stats
    out = await get_spot_stats(admin=object(), db=_stub_db())

    # The whole point: these must exist and be driven by the columns.
    assert out["flagged_for_review"] == 158
    assert out["low_accuracy"] == 158
    assert out["unverified"] == 1314
    assert out["by_accuracy_flag"]["low_accuracy"] == 158


@pytest.mark.asyncio
async def test_stats_separates_the_claimed_flag_from_a_real_verifier():
    """`is_verified_peak` was hardcoded True by the bulk import scripts, so it carried no accuracy
    information. Reporting it beside the count with a real `verified_by` is what makes a future
    divergence visible instead of silent."""
    from routes.surf_spots.admin_spots import get_spot_stats
    out = await get_spot_stats(admin=object(), db=_stub_db(verified_peak=1300, has_verifier=44))
    assert out["verified_peak"] == 1300
    assert out["has_verifier"] == 44
    assert out["verified_peak"] != out["has_verifier"]


@pytest.mark.asyncio
async def test_stats_distinguishes_total_rows_from_what_the_map_shows():
    """`total_spots` counts every row; the map and public list filter is_active. They are equal in
    production today, which is exactly why a divergence would go unnoticed."""
    from routes.surf_spots.admin_spots import get_spot_stats
    out = await get_spot_stats(admin=object(), db=_stub_db(total=1600, active=1516))
    assert out["total_spots"] == 1600
    assert out["active_spots"] == 1516


@pytest.mark.asyncio
async def test_stats_keeps_its_original_fields():
    """The dashboard still renders these — the change must be additive."""
    from routes.surf_spots.admin_spots import get_spot_stats
    out = await get_spot_stats(admin=object(), db=_stub_db())
    assert out["total_spots"] == 1516
    assert [c["country"] for c in out["by_country"]] == ["USA", "Australia"]
    assert out["by_tier"] == {"tier_1": 900, "tier_3": 616}


@pytest.mark.asyncio
async def test_an_unset_accuracy_flag_is_labelled_not_dropped():
    from routes.surf_spots.admin_spots import get_spot_stats
    out = await get_spot_stats(admin=object(), db=_stub_db(accuracy=((None, 12), ("unverified", 4))))
    assert out["by_accuracy_flag"]["unset"] == 12
