#!/usr/bin/env python3
"""THE SINGLE SOURCE for which CI lane owns which backend test file.

WHY THIS FILE EXISTS
--------------------
`ci.yml` carried the composition pattern list TWICE — once as a shell `ls` glob for the sim
lane, once as a Python `fnmatch` list for the forecast-chain lane — and that file's own comments
record what the second copy cost:

    "A suite named 'composition guards' was not running the composition guards."
    (45 composition test files were never in the glob at all)
    "The module pattern is now written ONCE and used by both forms. Two copies is how the
     composition glob came to miss 45 of its own files."

The same lesson applied to the lists themselves and had not been taken. Adding a third lane meant
a third copy, so the patterns moved here instead and every lane now reads the same definition.

⚠️ AND FOR FIVE DAYS THAT SENTENCE WAS ASPIRATIONAL. This file was added on 2026-08-06 while ci.yml
KEPT both of its copies, so the repo ran three lists, not one — and `test_flag_lane_parity.py`
pinned only ci.yml's pair, which is why the pair stayed honest and this file went stale. On
2026-08-11 the two ci.yml copies were deleted and all three lanes were pointed here. See the
COMPOSITION block below for what the divergence actually cost.
★ ADDING A SINGLE SOURCE IS NOT THE SAME ACT AS RETIRING THE COPIES. Only the second one works.

THE DEFECT THIS CLOSES
----------------------
Selection was the defect. Both lanes pick files by pattern, and anything neither names runs
NOWHERE. Measured 2026-08-06 by executing both selectors and differencing `git ls-files tests/`:

    tracked 445  ·  guards 122  ·  chain 77  ·  union 199  ·  UNCLAIMED 246 (55.3%)

This repo has adopted orphans BY HAND four separate times — the five ERA5 campaign guards,
`test_sweep_orphaned_l2.py` (5 tests over the predicate `l2-orphan-sweep.yml` runs as
`--delete --yes` against PRODUCTION storage), `test_ecmwf_period_bands_decode.py` and
`test_icon_wind_multi_bbox_fetch.py`. Every one was found by an audit, never by CI. A fifth
hand-adoption is not the fix. `estate` is the COMPLEMENT, so a new file is owned the moment it
is committed and there is no pattern to forget to update.

WHY `git ls-files` AND NOT `ls`
-------------------------------
The sim lane used a shell `ls`, which reads the FILESYSTEM. `ci.yml` records that biting three
times in one session: a floor was calibrated at 41/565 because the working tree held a concurrent
session's UNTRACKED file, making the gate unmeetable by anything that ships. Tracked-only is
immune to that, and in CI's fresh checkout the two are identical (verified 2026-08-06: 0 untracked
and 0 deleted test files, `ls` and `git ls-files` both return 122 for the guards globs; re-verified
2026-08-11 when the `ls` glob was retired, both returning the same 148).
⇒ Retiring `ls` closed that hazard for the guards lane as a side effect: a shared working tree can
no longer inflate what CI selects.

USAGE
-----
    python scripts/ci_test_lanes.py --lane guards|chain|estate   # newline-separated paths
    python scripts/ci_test_lanes.py --assert-partition           # the coverage guard
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------------------------------------
# ⭐ THE ONLY definition of the composition set. All three ci.yml lanes consume it — the guards lane
# via `--lane guards`, the chain lane via `--lane chain` (which subtracts this set from its own
# candidates), the estate lane via `--lane estate` (the COMPLEMENT). Adding a pattern here widens
# the guards lane and narrows the other two by exactly the files it claims.
#
# ⛔⛔ IT WAS NOT ALWAYS THE ONLY ONE, AND THAT COST A DOUBLE-RUN. Until 2026-08-11 ci.yml carried
# its own two copies — a shell `ls` glob for the guards lane and an inline Python `COMPOSITION`
# literal for the chain lane — and `tests/test_flag_lane_parity.py` pinned THOSE TWO equal. So when
# `c7099d0a`/`6e5bf70a` adopted the memory-safety family on 2026-08-10, both ci.yml copies learned
# it, the parity guard stayed green, and THIS tuple silently stayed at 41 patterns against their 47.
#
# ★★★ THE PART THAT MAKES IT MORE THAN A STALE COMMENT: this tuple is not a description of the
# lanes, it IS one of them. `estate_lane` is the complement computed from exactly these patterns,
# and ci.yml runs its output verbatim. Measured at HEAD 2026-08-11 before the fix:
# `tests/test_health_peak_memory.py` (9 tests) was emitted by `--lane estate` AND matched by the
# composition `ls` glob, so it RAN IN BOTH LANES — while `--assert-partition` printed
# "partition OK: every tracked backend test file is claimed by exactly one lane". The double-count
# `c7099d0a` caused and `6e5bf70a` fixed had recurred inside the instrument built to detect it.
# ⇒ A GUARD WHOSE MODEL FEEDS AN EXECUTOR IS NOT A MODEL. Its errors are not mis-descriptions.
#
# The fix DELETED ci.yml's two copies rather than adding a third comparison. Equivalence was
# MEASURED before the swap, never assumed: the `ls` glob and `--lane guards` both resolved to the
# same 148 files, ci.yml's inline chain heredoc and `--lane chain` both to the same 85, diffs empty.
# `test_flag_lane_parity.py` now guards that no copy comes back, and pins the family below by name.
# ---------------------------------------------------------------------------------------------
COMPOSITION = (
    "tests/test_sim_*.py", "tests/test_rating_*.py", "tests/test_surf_*.py",
    "tests/test_spot_*.py",
    # ⚠️ `tests/test_point_*.py` WAS MISSING UNTIL 2026-08-01 and three files were affected, two of
    # them long-standing. The point lane is where `surf_height_m` and the local size reference are
    # PRODUCED (`point_surf_augment` is the single injection point), so its guards belong in a
    # composition suite by any reading.
    # ★ CAUGHT BY COMPARING COUNTS, NOT BY A RED. A new 12-test guard landed and the gate still
    # reported "49 files / 707 passed" — byte-identical to the run before it. A guard that runs
    # nowhere is indistinguishable from a guard that passes.
    "tests/test_point_*.py",
    # ⬆ THE MEMORY-SAFETY FAMILY, 2026-08-10. Found by census while fixing the grid_series OOM
    # (7 oomKilled events in 15 h): of 482 backend test files, 340 were selected by NO lane, and the
    # dark set included EVERY guard on this box's memory bounds — test_series_vector_budget (the
    # end-stage grid_series budget), test_product_cache_vector_budget (the resident product cap) and
    # test_health_peak_memory (the peak-RSS reporting the OOM was diagnosed WITH). The new
    # build-time bound's own guards would have landed dark too, which is how this was noticed.
    # ★ A lane cannot protect what it never selects.
    # ⛔ Deliberately a NAMED FAMILY, never a widening to `test_iteration_*`: those are ~100
    #   unrelated product-feature files, and pulling them in here would be scope, not coverage.
    "tests/test_series_*.py", "tests/test_product_cache_*.py", "tests/test_cold_start_*.py",
    "tests/test_health_peak_memory.py", "tests/test_dyncache_*.py", "tests/test_manifest_*.py",
    "tests/test_coarse_*.py",
    "tests/test_marine_*.py", "tests/test_grid_*.py", "tests/test_weather_*.py",
    "tests/test_wind_*.py", "tests/test_partition_*.py", "tests/test_noaa_*.py",
    "tests/test_ecmwf_euro.py", "tests/test_fetch_common.py", "tests/test_climatology_inbox.py",
    "tests/test_flag_lane_parity.py",
    # ⚠️ NAMED BY FULL FILENAME, and it must stay named. Split out of test_flag_lane_parity.py on
    # 2026-08-11 when that file reached 787 of the 800-LOC cap. No glob here matches `test_ci_*`, so
    # WITHOUT this line the split would have moved 11 tests out of the guards lane into the estate
    # complement — dropping this lane from 1691 passed to 1680 against a floor of 1685, i.e. RED.
    # ★ SPLITTING A TEST FILE IS A LANE CHANGE in this repo; the two are one act and the floors
    #   notice. With this entry the split is a FILE-count change (148 -> 149) and no test moves.
    # ⛔ These guards police THIS FILE — that all three lanes delegate to it, and that no copy of the
    #   list comes back. Letting them drift into the estate lane would put the guard on the
    #   composition lane outside the composition lane.
    "tests/test_ci_lane_single_source.py",
    "tests/test_owner_calibration_anchors.py",
    "tests/test_parity_unification.py", "tests/test_local_size_preview.py",
    "tests/test_enclosed_sea_height_survival.py", "tests/test_gfs_fill_masked_waves.py",
    "tests/test_dominant_swell_anim.py", "tests/test_frame_honesty.py",
    "tests/test_data_health.py", "tests/test_geometry_*.py", "tests/test_provenance_*.py",
    "tests/test_observation_gate_*.py", "tests/test_run_provenance.py",
    "tests/test_resolve_spot_geometry.py", "tests/test_simulation.py",
    "tests/test_forecast_skill.py", "tests/test_forecast_skill_per_model.py",
    "tests/test_forecast_accuracy_monitor.py", "tests/test_height_anchors.py",
    "tests/test_request_telemetry.py",
    "tests/test_product_run_age_census.py", "tests/test_validate_nearshore_transform.py",
    "tests/test_calibration_census.py",
    # ADOPTED 2026-08-05. The FIVE ERA5 campaign guards matched no lane selector and ran NOWHERE —
    # same cause as the two below: they import from `scripts.`, which the chain lane's
    # `services.<mod>` regex cannot see, and no composition pattern covered the name.
    #   test_era5_campaign_instance_guard.py 11 · test_era5_liveness_reaper.py 13
    #   test_era5_interrupt_shield.py         8 · test_era5_peer_from_marker.py 8
    #   test_era5_scope_selection.py          6                    TOTAL 46 defs / 63 tests
    # These guard the campaign that is the CRITICAL PATH for the size reference, the level ladder
    # and the empirical exposure work — and every one of its recorded failure modes (self-blocking
    # instance guard, wedged-not-dead process, Ctrl-C from another session, resume-scope drift) is
    # covered by exactly these files. Measured 2026-08-05: 63 passed in 2.2 s, cheap AND load-bearing.
    "tests/test_era5_*.py",
    # ADOPTED 2026-08-02 (audit v6 §12.2). Both matched NO lane selector and ran NOWHERE.
    #   test_sweep_orphaned_l2.py       5 tests over `is_orphan`, the predicate
    #     `l2-orphan-sweep.yml:46` runs as `sweep_orphaned_l2.py --delete --yes` against PRODUCTION
    #     L2 storage. An unguarded DELETION predicate was the most dangerous of the 245 orphans.
    #   test_map_spots_to_ndbc_buoys.py 9 tests over NDBC WVHT-in-metres parsing and the
    #     nearest-buoy haversine — the observation side of the obs gate.
    "tests/test_sweep_orphaned_l2.py", "tests/test_map_spots_to_ndbc_buoys.py",
)

# fastmcp cannot be installed into this app's pinned stack: every release needs httpx>=0.28.1
# against a pinned 0.27.2, and forcing it lifts starlette until routes/social dies on
# `Router.__init__() got an unexpected keyword argument 'on_startup'`. These two exercise
# startup/dispatch rather than composition, so the sim_mcp_shim stand-in cannot answer for them.
# NAMED here rather than achieved by quietly narrowing a glob — an exclusion that outlives its
# reason is invisible.
FASTMCP_EXCLUDED = (
    "tests/test_weather_sim_mcp.py",
    "tests/test_weather_sim_mcp_server_startup.py",
)

# ⚠️ ESTATE QUARANTINE — files that FAIL ON THE RUNNER while passing locally. Named here with the
# evidence, never achieved by narrowing a selector, and each is asserted below to still exist.
#
# ⛔ THIS IS NOT "THEY WERE ALWAYS BROKEN, SO IGNORE THEM". These files ran in NO CI lane before
# 2026-08-06, so their first-ever cloud execution is what produced these results. Quarantining
# preserves the status quo (they still run nowhere) while making that fact visible instead of
# implicit — a permanently red lane teaches everyone to ignore CI, which costs more than it buys.
#
# ★★★ AND THE LOCAL/CI GAP IS THE LESSON: both original entries PASSED on my workstation minutes
# earlier (`test_debug_consciousness` 6 passed in 1.38 s; `test_websocket_endpoints_auth` 10 passed
# in 7.26 s). A local probe measures the local environment, never the runner — the same mistake
# that shipped an undeclared pytest-timeout one commit earlier.
#
# ✅ RELEASED 2026-08-06 — `tests/test_websocket_endpoints_auth.py`, and the release is what the
# quarantine was FOR. The one unknown it recorded ("did the sibling `_authorized` cases pass on
# that runner?") was measured by re-running the file alone on ubuntu-latest with `-v`
# (CI run 31070627589): **5 failed, 5 passed** — every `_authorized` param PASSED while every
# `_unauthorized` param timed out. That eliminated the app-startup/env reading and left the
# rejection path.
#   · Root cause: `verify_websocket_auth` raised HTTPException from a WEBSOCKET route. Under the
#     versions requirements.txt actually resolves (starlette 0.37.2 / fastapi 0.110.1) that is
#     swallowed by starlette's websocket exception plumbing and the app returns having sent NO
#     ASGI message at all — no accept, no close, no denial response. Driving the ASGI app directly
#     showed `NOTHING SENT` for all three unauthorized variants, while a public route accepted, an
#     unknown route closed with 1000, and an authorized connect accepted.
#   · Fixed by closing the handshake explicitly (1008), which does not depend on any exception
#     handler being registered for the websocket scope.
# ★ THE LOCAL/CI GAP HAD A CAUSE WORTH KEEPING: the workstation runs starlette 1.0.0, which turns
#   that same HTTPException into a websocket DENIAL RESPONSE. The test's `pytest.raises(Exception)`
#   was therefore satisfied locally by a completely different mechanism than the one under test —
#   `starlette` is unpinned (fastapi 0.110.1 allows >=0.37.2,<0.38), so local and CI were never
#   running the same code.
ESTATE_QUARANTINE = {
    # 5 of 6 fail on the runner, all rooted in a missing local artifact. The clearest one says so
    # outright: assert 'Root Cause Summary' in {'error': 'Event Bus DB not found.', ...}; the rest
    # are KeyErrors on 'correlation_id' / 'broken_flows_count' / 'comparison_result' plus an
    # `assert 100.0 < 100.0` (a health score that is perfect only because there is no data).
    # ⇒ FOLLOW-UP, and the right fix is not a quarantine: a test whose PRECONDITION is absent must
    #   SKIP, not fail (standing rule 27). Give it a module-level guard on the Event Bus DB.
    "tests/test_debug_consciousness.py": "needs a local Event Bus DB that a fresh checkout lacks",
}

# Written ONCE and used by both import forms — `from services.<mod>` and `from services import
# <mod>`. A second copy is what made the chain lane blind to the bare form until 2026-08-02.
#
# ⚠️ THE SELECTOR WAS BLIND TO AN IMPORT FORM, NOT TO A MODULE (2026-08-02). It only ever matched
# `services.<mod>` — the DOTTED form — so a test written `from services import
# dwd_icon_wind_fetcher` was invisible and ran in NO lane. Measured: 3 tracked files import that
# way; 2 are genuinely forecast-chain (`test_icon_wind_multi_bbox_fetch.py`, whose own docstring
# says a mis-association would "produce plausible wind at the wrong place, which no smoke test
# would notice", and `test_ecmwf_period_bands_decode.py`), and `test_private_media.py` is media and
# stays out BY MODULE NAME rather than by accident.
# ★ Two copies is how the composition glob came to miss 45 of its own files, and how a sibling test
# file was adopted only because it happened to also import `services.weather_pipeline`.
_CHAIN_MOD = r"(?:weather_pipeline[\w.]*|\w*fetcher\w*|_fetch_common|\w*_service)"
CHAIN_IMPORTS = re.compile(
    r"(?:from|import)\s+services\." + _CHAIN_MOD
    + r"|from\s+services\s+import\s+" + _CHAIN_MOD
)


def tracked_tests() -> list[str]:
    """Every tracked `tests/test_*.py`, repo-relative, forward slashes."""
    out = subprocess.run(["git", "ls-files", "tests/"], capture_output=True, text=True).stdout
    return sorted(
        f.replace("\\", "/") for f in out.split()
        if f.endswith(".py") and os.path.basename(f).startswith("test_")
    )


def guards_lane(tracked: list[str]) -> list[str]:
    """The sim/composition guard set: COMPOSITION minus the two fastmcp modules."""
    excluded = set(FASTMCP_EXCLUDED)
    return sorted(
        f for f in tracked
        if f not in excluded and any(fnmatch.fnmatch(f, p) for p in COMPOSITION)
    )


def chain_lane(tracked: list[str]) -> list[str]:
    """Forecast-chain guards: NOT in COMPOSITION, but importing a chain module."""
    taken = {f for f in tracked if any(fnmatch.fnmatch(f, p) for p in COMPOSITION)}
    out = []
    for f in sorted(set(tracked) - taken):
        try:
            with open(f, encoding="utf-8", errors="ignore") as fh:
                if CHAIN_IMPORTS.search(fh.read()):
                    out.append(f)
        except OSError:
            continue
    return out


def estate_lane(tracked: list[str]) -> list[str]:
    """THE COMPLEMENT — everything no other lane claims, less the named quarantine."""
    claimed = (set(guards_lane(tracked)) | set(chain_lane(tracked))
               | set(FASTMCP_EXCLUDED) | set(ESTATE_QUARANTINE))
    return sorted(set(tracked) - claimed)


def assert_partition() -> int:
    """The coverage guard: the lanes must exactly partition the tracked test estate."""
    tracked = tracked_tests()
    guards, chain, estate = guards_lane(tracked), chain_lane(tracked), estate_lane(tracked)
    excluded = [f for f in FASTMCP_EXCLUDED if f in tracked]
    quarantined = [f for f in ESTATE_QUARANTINE if f in tracked]

    problems = []
    # A stale exclusion is invisible — assert each still names a real file. This is the check that
    # turns a quarantine from a hiding place into a debt with an expiry: delete the file or fix and
    # unquarantine it, and either way this fails until the list is updated.
    for f in FASTMCP_EXCLUDED:
        if f not in tracked:
            problems.append(f"fastmcp exclusion names a file that no longer exists: {f}")
    for f in ESTATE_QUARANTINE:
        if f not in tracked:
            problems.append(f"estate quarantine names a file that no longer exists: {f}")

    # A quarantined file must not ALSO be running in another lane — that would make the quarantine
    # read as "not tested" while it is in fact tested, which is the same confusion in reverse.
    for a, b, an, bn in ((guards, chain, "guards", "chain"),
                         (guards, estate, "guards", "estate"),
                         (chain, estate, "chain", "estate"),
                         (quarantined, guards, "quarantine", "guards"),
                         (quarantined, chain, "quarantine", "chain"),
                         (quarantined, estate, "quarantine", "estate")):
        overlap = sorted(set(a) & set(b))
        if overlap:
            problems.append(f"{an} and {bn} both claim: {', '.join(overlap[:5])}")

    covered = set(guards) | set(chain) | set(estate) | set(excluded) | set(quarantined)
    missing = sorted(set(tracked) - covered)
    if missing:
        problems.append(f"{len(missing)} tracked file(s) claimed by NO lane: {', '.join(missing[:5])}")

    print(f"tracked {len(tracked)}  guards {len(guards)}  chain {len(chain)}  "
          f"estate {len(estate)}  fastmcp-excluded {len(excluded)}  "
          f"quarantined {len(quarantined)}")
    for f in sorted(ESTATE_QUARANTINE):
        print(f"  quarantined: {f} -- {ESTATE_QUARANTINE[f]}")
    if problems:
        for p in problems:
            print(f"::error::{p}")
        return 1
    print("partition OK: every tracked backend test file is claimed by exactly one lane.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lane", choices=("guards", "chain", "estate"))
    ap.add_argument("--assert-partition", action="store_true")
    args = ap.parse_args()

    if args.assert_partition:
        return assert_partition()
    if not args.lane:
        ap.error("pass --lane or --assert-partition")

    tracked = tracked_tests()
    fn = {"guards": guards_lane, "chain": chain_lane, "estate": estate_lane}[args.lane]
    print("\n".join(fn(tracked)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
