"""The shore-normal coverage census must not tell you to burn 4.3 h of NOAA for nothing.

WHY THE CENSUS EXISTS AT ALL
----------------------------
The shore normal is the highest-leverage input in the forecast (a coarse bearing is median 24.7 deg
off; the rating LEVEL differs at 58.1% of spots), and its asset refreshes only by manual
`workflow_dispatch` while every other forecast input refreshes 6x/day. The obvious fix is a cron.

**That was measured and refused.** `build_shore_normals.py` has no RNG and no wall-clock in the fit
(0 matches), so the fit is DETERMINISTIC: re-running reproduces the same accept/reject verdicts. A
spot missing from the asset was REJECTED by the quality gate, not skipped — live-tested 2026-07-30,
Bondi re-fitted in 22.5 s and was rejected `ambiguous_coastline` a second time; of 24 unmatched
spots sampled, 0 were merely missing (62% ambiguous coastline, 38% PLACEMENT, which re-running
cannot fix because the pin must move).

⇒ the rebuild's yield tracks spots that are NEW or MOVED, **not elapsed time**. So the leverage is
in detecting that change, and `assess()` is the detector. These tests pin its verdicts, because a
detector that says "go" when there is nothing to do would reinstate exactly the waste it prevents.

★ PURE — no database, no network. `assess()` was factored out precisely so CI can exercise every
branch; the census's own I/O half needs `dev.db`, which is gitignored, and a test that needs a
gitignored file asserts something about the machine it runs on.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from shore_normal_coverage_census import (  # noqa: E402
    VERDICT_NO_WORK, VERDICT_VOID, VERDICT_YIELD, assess,
)

_ASSET = {"spots_considered": 1820, "count": 1386}


# ── THE REFUSAL: the expensive direction must require evidence ──────────────────────────────────

def test_a_catalogue_the_asset_already_considered_reports_NO_NEW_WORK():
    """THE MEASURED CASE, 2026-08-01: 1,820 considered at build vs 1,587 in the catalogue, and 0
    spots created since. A rebuild would re-derive the same rejections and publish nothing."""
    r = assess(_ASSET, catalogue_count=1587, coarse_count=779, new_since_build=0)
    assert r["verdict"] == VERDICT_NO_WORK
    assert r["newly_workable"] == 0


def test_the_coarse_spots_are_named_as_REJECTED_not_as_pending_work():
    """The wording is load-bearing. 779 spots on a coarse bearing look like a backlog; they are the
    gate's deliberate output. Calling them 'missing' is what justified the 4.3 h plan."""
    r = assess(_ASSET, catalogue_count=1587, coarse_count=779, new_since_build=0)
    assert "REJECTED" in r["reason"] and "deterministic" in r["reason"]


def test_a_large_coarse_count_alone_never_triggers_a_rebuild():
    """CONTROL for the failure mode this whole file guards: coverage is NOT the trigger. Even with
    almost every spot on a coarse bearing, if the asset already considered them there is no work."""
    r = assess(_ASSET, catalogue_count=1587, coarse_count=1580, new_since_build=0)
    assert r["verdict"] == VERDICT_NO_WORK


# ── THE OTHER DIRECTION: it must still fire when there IS work ──────────────────────────────────

def test_spots_the_asset_never_considered_report_REBUILD_WOULD_YIELD():
    """NEGATIVE CONTROL. A detector that can only say 'no' is not a detector."""
    r = assess(_ASSET, catalogue_count=1900, coarse_count=800, new_since_build=80)
    assert r["verdict"] == VERDICT_YIELD
    assert r["newly_workable"] == 80


def test_it_falls_back_to_the_count_difference_and_SAYS_which_basis_it_used():
    """Without `created_at` the estimate is coarser. It must still work, and must disclose that —
    an estimate that hides its basis reads exactly like a measurement."""
    r = assess(_ASSET, catalogue_count=1900, coarse_count=800, new_since_build=None)
    assert r["verdict"] == VERDICT_YIELD
    assert r["newly_workable"] == 80          # 1900 - 1820
    assert "no created_at" in r["basis"]

    r2 = assess(_ASSET, catalogue_count=1587, coarse_count=779, new_since_build=0)
    assert "created_at" in r2["basis"] and "no created_at" not in r2["basis"]


# ── VOID: refuse rather than answer when it cannot know ─────────────────────────────────────────

@pytest.mark.parametrize("meta,count,label", [
    ({}, 1587, "no asset metadata"),
    ({"count": 1386}, 1587, "asset records no spots_considered"),
    (_ASSET, 0, "empty catalogue"),
    (_ASSET, None, "catalogue unavailable"),
])
def test_it_VOIDS_instead_of_reporting_nothing_to_do(meta, count, label):
    """A census that reports NO_NEW_WORK because it could not read anything is worse than none —
    it licenses inaction with a number that measured nothing."""
    r = assess(meta, catalogue_count=count, coarse_count=0)
    assert r["verdict"] == VERDICT_VOID, label
    assert r.get("reason")
