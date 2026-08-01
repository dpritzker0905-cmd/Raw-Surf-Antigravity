# HANDOFF 2026-08-01 — the region rotation was rationing a cost that was never real

**Audited 2026-08-01 13:18Z.** Everything below is measured, not recalled. 8 commits, all on
`origin/dev` and verified as ancestors of HEAD. 97 tests pass 14 h and 28 commits later.

---

## 0. TL;DR — CLOSED, VERIFIED IN PRODUCTION

The reported defect (Hawaii wind on a 75 h-old run) was the small end of a class. Root cause and
fix are both verified live.

    BEFORE 2026-07-31 21:26Z          AFTER 2026-08-01 13:18Z
    8 EXPIRED lanes                   0 EXPIRED, 137 ok
    uk_ireland / east_australia        all 10 pilot regions at 6.2 h — IDENTICAL age,
      GFS marine run age 450.2 h         because ONE pass refreshed them all
    region ages a staircase            pilot_pass_census: 6/6 lanes = 10 regions, exit 0
      (5.4 / 12.1 / 21.9 / 447.6 h)
    uk_ireland served by global_mid    every region served by its OWN 0.25 deg tile
    east_australia served by
      backend_direct_point  <-- a LIVE per-request upstream fetch on the serve box

★ **The uniform 6.2 h age IS the signature.** Per-region passes produce a staircase; one pass
produces one age. That, and region-count-per-run_time, are the only signals that discriminate.

---

## 1. THE TWO ROOT CAUSES (both were real, and they are different)

### 1a. Selection — a rotation keyed on a clock nothing ticks
`get_pilot_regions()` derived its round-robin position from wall-clock (`now // (3*3600)`, a 3-HOUR
bucket). The only lane consuming it fires **3x/day at 8-HOUR spacing** (`forecast-ingest.yml` runs
`INGEST_PILOTS=skip`), and each stage reads the clock **when that stage runs**, 1-5 h into a
<=200-min job. So the "round robin" never advanced by one — it jumped by an arbitrary amount set by
JOB DURATION.

With `per_cycle=2` over 8 regions the position collapses to `start = 2*(cycle_index mod 4)`: 4
windows, 3 cron fires ⇒ **exactly one adjacent PAIR is never selected**, and which pair depends on
how many minutes into the job the lane runs.

**Proof:** replayed the real selector against every observed ingest in the live manifest —
**76/76 passes fell inside the predicted window, 0 outside.**

✅ Fixed by stale-first selection (`7da00ca8`, another agent). **Verified in production:** the 21:44
GFS marine pass selected exactly `east_australia + uk_ireland` — the two stalest at 449 h.

### 1b. Cost — the rationing was rationing duplication
`WORLDWIDE_REGIONS_PER_CYCLE` existed to bound per-region download cost. **That cost was not real.**
NOAA's byte-range selects a GRIB *message*, and a message is the whole global 0.25 deg field; the
bbox is applied AFTER decode by local nearest-neighbour indexing.

**Measured on the live 20260731 12Z cycle:**

    UGRD 591,525 B + VGRD 572,474 B per step
    BYTE-IDENTICAL for a 609-point Hawaii box and a 2,009-point uk_ireland box

Same property at every upstream: DWD publishes whole-globe files per (var, hour) with no spatial
byte-range; ECMWF ships one whole-globe multi-step file.

✅ Fixed by multi-bbox single-download-pass on all four rotating lanes.

    GFS marine  2,022 -> 1,011 MB/fire, 3,588 -> 1,794 requests, coverage 4 -> 10 regions
    GFS wind      303 ->    76 MB/fire,   780 ->   195 requests, coverage 4 -> 10 regions

⭐ **The pattern already existed in-repo** (`dwd_gwam_fetcher`, 2026-07-13, ICON/EURO marine). The
two lanes that had it showed **0** stale regions in the sweep that found **all 14** in the four that
did not. This was completing a half-done migration, not inventing anything.

---

## 2. WHY NOTHING CAUGHT IT — three instruments, all blind at the same tier

    timeline_slot_census.py   reads valid_time only, AND scopes to global_coarse/global_mid
    data_health.py:56         checks run age but `_is_global()` filters to region_id.startswith("global")
                              — the docstring even says "ignore regional pilots"
    run_time in the payload   surfaced by 2e81bcf5, but no threshold checked it

A product built from a 3-day-old run **fills its slot perfectly**. Coverage and freshness are
different questions and every instrument was answering the first.

---

## 3. WHAT SHIPPED (8 commits, all on origin/dev)

| commit | what |
|---|---|
| `7da00ca8` | stale-first selection + `product_run_age_census.py` (other agent) |
| `166f4cf1` | restore `get_all_pilot_regions` — see §6 incident |
| `2b0e1466` | **GFS marine multi-bbox**, grouped BY HORIZON |
| `45bd8f5a` | **ICON + EURO wind multi-bbox**, shared pass extracted to `wind_pilot_multi.py` |
| `ced6b909` | `tier_resolution_delta.py` — what the coarse tier costs |
| `1c8c92cd` | worldwide marine horizon 3d -> 5d |
| `57496f04` | `pilot_pass_census.py` — did the lane cover every region in one pass? |
| `98ab04ba` | P0 #15 re-measured (§7) |

**Kill switches:** `WIND_PILOT_MULTI_BBOX=0`, `MARINE_PILOT_MULTI_BBOX=0`, each model's existing
`*_DIRECT=0`. `PILOT_REGION_STALE_FIRST=0` restores the clock rotation.

**LOC:** all touched files under the 800 gate (`wind_ingestion.py` 772 — the shared pass was
extracted precisely because three call sites pushed it to 833).

---

## 4. INSTRUMENTS — what each ANSWERS, and what it CANNOT

    scripts/product_run_age_census.py --by-region [--fail-on-stale]
        newest run_time per (model,domain,layer,region), per-TIER thresholds
        (global 8/12 h, flagship 16/24, worldwide 36/72). Distinguishes EXPIRED
        (tier ABSENT -> resolver falls through) from merely stale.

    scripts/pilot_pass_census.py [--fail-on-rotation]
        multi-bbox vs rotation slice. ⚠️ run_time count does NOT discriminate — the legacy
        per-region loop also stamps ONE run_time for all regions. Only REGION COUNT does.
        ⚠️⚠️ mid-write undercounts: measured 22:20Z ICON/marine read as ONE region and
        completed to 10 minutes later. Young + partial => reported SETTLING?, not judged.

    scripts/tier_resolution_delta.py
        what the coarse tier costs, same coord/valid_time/run, tier forced via grid_product_id.
        BREAKING |delta| median 21.0%, max 44.9%, SIGNED BOTH WAYS (no constant corrects it).
        ⚠️ must snap valid_time to the 3-HOURLY LATTICE or the two tiers snap to different
        hours and it silently becomes a TIME comparison.
        ⚠️ a region already falling through has NO fine side — both calls resolve to the same
        file and it scores +0.0%. Reported but NOT scored, else it dilutes the statistic
        (read 16.5% instead of 21.0%).

---

## 5. THE HORIZON DECISION — evidence, and where it stops

3d -> 5d (`1c8c92cd`) rests on two measurements:

    resolution delta (systematic, does NOT shrink with lead):  21.0% median on breaking height
    forecast uncertainty, inter-model spread, TIER HELD CONSTANT:
        24h 24.1%    72h 23.6%    120h 36.0%      => ratio 1.13-1.72x

⭐⭐ **The first version of that second measurement was CONTAMINATED and said the opposite.** At 72h+
the three models resolved to DIFFERENT tiers (0.25 / 2deg / 10deg / live-fetch), so "spread" mixed
model disagreement with tier disagreement: it read 39.7% at 72h (vs 23.6% clean) and 51.3% at 120h
(vs 36.0%) — i.e. "uncertainty dominates, don't bother". **Forcing all three models onto
`global_mid` is what made it honest.**

⛔ **Stops at 5d, not 8 or 14, because past ~day 5 it is UNMEASURED** — ICON and EURO have no
`global_mid` product beyond their native horizons, so the 3-model spread cannot be computed
(168h/240h returned 1 model). **No number, no horizon.** Re-run both instruments before raising it.

**Cost:** download 138 -> 154 steps (+12%, inside what multi-bbox freed); regional marine products
1,704 -> 2,216 per fire (~+4% of the manifest).

---

## 6. ⚠️ AN INCIDENT I CAUSED — mutation-test on a COPY

I mutation-tested by editing tracked files **in the working tree**. A concurrent session ran
`git add -A && commit && push` during a ~26 s mutation window and captured a deliberately-broken
line in `7da00ca8` on origin/dev:

    -   regions_all = get_all_pilot_regions()
    +   regions_all = get_pilot_regions(scheduler.store, "GFS", "wind")

Not an outage — the multi pass still ran, it just covered the rotation slice. Fixed in `166f4cf1`.

★★ **RULE: with a live concurrent writer, mutate a COPY, never the working tree.** Also: stage
explicit paths, never `git add -A` — that is what swept it in.

---

## 7. P0 #15 (ERA5) — re-measured, and the queue was wrong in three ways

1. **The code fixes had already landed** (`3ae53a5e`): `CHECKPOINT_EVERY=10` consumed at line ~297,
   `_another_instance_pid()` called at line 245. Both verified CONSUMED, not merely defined.
2. **The 21:30 collision could not fire at the time** — task was `State=Disabled`. `NextRunTime`
   still displayed `07/31 21:30`: **a disabled task keeps a stale NextRunTime**, which is exactly
   how it reads as armed when it is not.
3. **The "not progressing" call was PREMATURE.** Cumulative counters showed 13:57 cpu 610 s /
   1,105 MB -> 19:27 cpu 738 s / 1,204 MB — it **resumed** after the 13:57 sample. Acting on that
   verdict would have destroyed real work.

★★ **Cumulative counters over hours cannot separate "slow" from "stopped". Measure a WINDOW and
read socket states beside it.** What established the wedge:

    240 s window   d_cpu 0.77 s   d_write 0 MB   234,850 io_ops
    151 s window   d_cpu 0.41 s   d_write 0 MB
    sockets: Bound=3  CloseWait=3  ESTABLISHED=0

A healthy CDS poll is ONE short request every 30-60 s holding no half-closed sockets. ~978 io_ops/s
against sockets the server already closed is a spin loop.

**Status at audit (2026-08-01 13:18Z):** pid 71096 is **gone**. The task is now `State=Ready`,
`LastRun=07/31 21:30:01`, **`LastResult=1`** — ✅ that is `_another_instance_pid()` firing for real
and blocking the collision on its first night. Whether the campaign banked anything needs L2 access.

---

## 8. OPEN — next by Jacobian

1. ⛔ **P1 #7 — the waves arrow disagrees with the infobox. STILL THE USER'S #1 REPORT.** Frontend;
   needs a zoom ladder on **port 3009** (`frontend-verify`), never 3001. The class is
   **PATH-DEPENDENT** — a settled screenshot proves nothing. Order per the queue: find the
   partition-availability loss (ours 0.6449 vs upstream 1.0000, ~35% lost between fetch and stamped
   product — ⛔ FIND THE LOSS, do not lower the `availFrac >= 0.95` gate) -> rank by onshore energy
   flux `P·cos(dtheta)` -> re-measure with the ladder -> ingest cycle -> confirm on screen.
2. **Expose per-lead forecast skill from L2.** `forecast_skill.py` already scores it against NDBC
   into `calibration/skill/scored-*`; nothing exposes it. It gates any horizon past 5d.
3. **Numpy accumulators -> tier unification.** Cost plays only, and cost is no longer binding.
   Measured: global 10deg + mid 2deg + regional 0.25 are THREE passes over identical bytes
   (GFS marine 364 -> 113 steps if unified, 3.2x). Blocker is memory — accumulators are Python
   lists of floats (~32 B/value), so a unified pass is 1,665 MB; numpy takes it to ~416 MB.
   ⚠️ A per-region sampling plan must carry resolution PER ENTRY and compute `half` per region
   (`half = max(1, round(res/0.25/2))` = 20 / 4 / 1 for 10deg / 2deg / 0.25deg). One shared `half`
   would silently wreck the coarse tier's block averaging — and nothing in the suite would catch it.

---

## 9. TRAPS BANKED THIS SESSION

- ⭐ **Prove the rationed cost is per-item BEFORE tuning the schedule.** Three sessions produced
  better *schedules* (clock -> stale-first), which moved the bound from infinity to 32 h but could
  never beat it — throughput was fixed. Removing the duplication moved it to 8 h **and cut fetch**.
- **Attachment != consumption, at every layer.** `ecmwf_opendata_fetcher` had honoured `bboxes`
  since 2026-07-13 — only the WAVES lane was ever wired to it. And 57 tests across four block-mean
  suites stayed GREEN with the fetcher's `energy_mean_*_block` call swapped for a raw centre sample:
  the helpers were tested in isolation, nothing asserted the fetcher CALLS them.
  `test_block_means_are_actually_CONSUMED` now pins it.
- **Check REACHABILITY before calling a surviving mutant a weak test.** One mutation survived
  everything; it mutates DEAD code (`energy_mean_direction_block` is unreachable unless
  `NOAA_PARTITION_DIR_CONFIDENCE=0`).
- **A test that feeds CONSECUTIVE indices to a round-robin proves a property of the FUNCTION, not
  of the SYSTEM.** `test_rotation_covers_every_worldwide_region_over_cycles` passed throughout the
  447 h starvation.
- **Under pytest both pilot selectors return flagship-only**, so a flagship-set assertion cannot
  tell them apart. Lift `is_test_environment` or the test proves nothing — mutation 1 was caught by
  ONLY the test that did.
- **A missing tile does not merely coarsen** — it moves cost onto the REQUEST path
  (`backend_direct_point`, run_time stamped at request time) on a box with three melt incidents.
