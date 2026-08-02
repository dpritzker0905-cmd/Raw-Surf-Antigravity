# HANDOFF 2026-08-02 — audit v5, and the eight defects it found in the same day's work

**Branch:** `dev` · **Base at handoff:** `904f50cf` · **18 commits shipped** (`6d8376f3..904f50cf`,
excluding a concurrent session's `a74f66a6` / `ed84e537`).
⚠️ A **concurrent session** held 9+ files uncommitted throughout (`point_resolution.py`,
`sim_rating.py`, `spot_conditions.py`, routes/…). **Stage BY PATH. I broke CI once by not doing
that — see §5.**

---

## §1 — READ FIRST

| doc | what it is |
|---|---|
| `docs/research/AUDIT-2026-08-02-v5-forensic-audit-of-the-shipped-work.md` | **START HERE.** 42 findings from 7 lenses, each attacked by an independent verifier: **19 survived, 23 struck**. §4 names the lying instrument in each strike. |
| `docs/research/AUDIT-2026-08-01-MASTER-…-sync-upgrade-path.md` | still the authority for M1–M13. **Supersedes v4**, which it partly retracts. |

---

## §2 — THE SHAPE OF THE DAY, AND IT IS THE POINT

Every audit finding, and every defect found while fixing them, was **provenance or composition —
never physics**. Nothing shipped today changed a formula. What changed is what numbers can say
about themselves, and which guards actually run.

★★★ **FOUR TIMES A GUARD I WROTE WAS GREEN AND RAN NOWHERE:**
1. **untracked** — a new test file is invisible to a `git ls-files`-based selector
2. **declared in a lane that cannot read it** — `ECMWF_PERIOD_BANDS` in `precompute.yml`; an
   import-graph walk settled it (`precompute_ci.py` reaches NO ecmwf module across 57 files;
   `ingest_forecast_ci.py` reaches it across 81). I had reasoned "the wave service spawns the
   fetcher as a subprocess, so both lanes reach it" — **true of the SERVICE, false of the LANE**
3. **matched by no selector** — the chain selector knew only the DOTTED `services.x` import form,
   so `from services import dwd_icon_wind_fetcher` was invisible and a **6-test ICON guard whose
   own docstring warns a mis-association "would produce plausible wind at the wrong place, which
   no smoke test would notice" had been running nowhere**
4. **importing a script**, which no selector covers

**EVERY ONE WAS CAUGHT BY THE COUNT, NEVER THE COLOUR.** The suite was green all four times. What
exposed them was `len(files)` failing to move after adding a file.
⇒ **After adding any guard, assert the NUMBER THAT RAN changed. If you cannot name that number, you
have not verified the guard exists.**

---

## §3 — WHAT SHIPPED (all mutation-proven, every mutation asserted to have LANDED)

| commit | what | proof |
|---|---|---|
| `ff94cb7d` | **`429fd0fc` guarded NOTHING** — deleting the flag it added left the suite at 13 passed. `INGEST_LANES` holds only the two ingest files. Also: **every published count was 2.5x high**, taken on a `dev.db` stale since 07-12 whose coordinate drift (p90 **3.470 km**) EXCEEDS the 3 km effect it measured | 5/5 + negative control |
| `7ff69cbc` | **a borrowed bearing said it was measured** — 231/231 shared a (verdict, missing) cell; the envelope discriminated for ZERO. The distance was computed in `_scan` and thrown away | 6/6 + control |
| `9553991d` `6d8376f3` `4b895c94` | M4 ingest: band-closure probe run **where the decoder already lived** (`BANDS_CLOSE`, n=20,494, max 1.0012, 0.0% exceed) → fetch → **the ON path executed for the first time** | 6/6 + 2 controls |
| `03d7841b` `640db2a9` `c65c5eed` | the chain selector's **import-form blindness**; both CI ratchets raised **from the gate's own run**, never a checkout | counts reconcile exactly |
| `36e8d75e` | `surf_transform.py` called two SHIPPED physics terms "phase-2" — **and M5 is queued off that line**; anyone fitting Kr would double-count direction by up to 40.5% | 5/5 + control |
| `67a68265` | **the ensemble priced before building: 50.07x, 12.0 GB/cycle** | 5 unit tests |
| `a562f67e` | four descriptions I invalidated the same day, now **AST-guarded** | 6/6 + control |
| `e8b38e42` | **the frontend dropped the ENTIRE provenance envelope** — 3 mappers x 3 fields | 4/4 + control |
| `851d2500` | the undeclared-switch guard **saw 17 of 35** — two escape routes, and it missed `SURF_HEIGHT_H110` | 6/6 + control |
| `0868152a` | the ledger auditor **mangled two names, then read its own comment as evidence** | before/after counts |
| `904f50cf` | **M4 COMPOSITION** — bands reach the rating at **zero extra point cost** | 9 tests, 4/4 |

---

## §4 — M4 IS DONE EXCEPT ONE HOOK, AND THE BLOCKER I REPORTED WAS WRONG

I reported M4 as blocked on `point_resolution.py` for several turns — **inherited from the audit and
repeated without measuring.** The composition point is `point_surf_augment.py:138`, which is FREE.

**Shipped:** `NormalizedPointDetail.wave_bands` (additive, Optional) + the composition-point wiring.
Bands compose ONLY when the injected resolver returns nothing — two sources for one sea state is the
ONE FORECAST COMPOSITION rule broken.

★ **Why bands and not more CMEMS partitions:** `_resolve_partitions` samples THREE MORE LAYERS per
point (**4x**, 0.17–0.77 s each) — the reason `SURF_PARTITIONS` is off by default on a 1-CPU box.
The bands ride in the SAME wave product, so the split costs **zero extra point resolutions**. And
the gap it fills is the common case, because the resolver returns None on nearly every point while
that flag is off.

### ⛔ THE ONE REMAINING HOOK
`point_resolution.py`'s point sampler must populate `point.wave_bands` from the `wave_band_h1012…`
series the fetcher emits into the product's `hourly`. **That file is held by a concurrent session.**
Everything either side of it is shipped and tested against a hand-built response.
Then: flip `ECMWF_PERIOD_BANDS` to `'1'` in **forecast-ingest.yml AND forecast-ingest-pilots.yml**
(precompute cannot read it — measured), A/B census, treat as a **product event**.

---

## §5 — MY OWN ERRORS, BECAUSE THEY COST MORE THAN THE FINDINGS

* ⛔ **I BROKE CI.** `git add -A backend/tests/` swept in a concurrent session's uncommitted work —
  a 319-line untracked test plus 34 lines of their modifications. Seven failures. Reverted in
  `c53949ca`, their files byte-identical (sha-verified). **I staged by path for eight commits, then
  reached for `-A` on the ninth because "it's just a rename" — and `git mv` had already staged it.**
* **The audit read its own comment as evidence.** Writing a flag name into a comment inside
  `ledger_audit.js` gave that flag a "read in code". Caught only because the COUNT moved 14→11 when
  the fix should have changed two NAMES and no total.
* **A guard that read SOURCE TEXT was hollow.** My first M4 composition guard checked that
  `bands_to_partitions` is called and appears after the resolver. Making the branch unconditional
  AND disabling it entirely both left it green. **I predicted both as green and recorded them as
  GAPS rather than passes — that is the only reason they were fixed instead of shipped.**
* **A vacuous test** — my wind-leak test supplied no band messages, so nothing could leak.
* **A detector that cried wolf** — blind to a ternary, it reported a mapped field as missing. I
  verified all four of its claims by hand: three real, one my regex.
* **Quoted the trigger phrase in a historical note TWICE** (`surf_transform`, `_nearest`). Both
  times the guard was right and the prose had to change.
* ⚠️ **An EXCEPTION scoped wider than the fact it documents is a HOLE.** Adding a flag to
  `LANE_EXCEPTIONS` to excuse an ABSENCE silently excused real DRIFT.

---

## §6 — QUEUE

**Immediate:**
1. **The one M4 hook** (§4) the moment `point_resolution.py` frees.
2. ✅ **DONE `8d714c23`** — composition floor ratcheted 103 → **107 / 1210**, from the gate's own run
   on `origin/dev @ 904f50cf` ("1282 tests across 107 files -> 1216 passed"). Four files had
   accumulated below it. **Read it off the GATE, never a checkout** — a clean worktree at the same
   sha read 104/1204 where the gate read 102/1178.
   ★ Fourth ratchet of the day (chain 63→65→67, composition 96→102→103→107). **A ratchet not raised
   in the same change that grows the count silently becomes slack, and slack in a coverage gate is
   indistinguishable from coverage.**
3. **Set `SHORE_NORMAL_BEARING_RADIUS_KM` in Render** — it runs 3.0 by code default either way, but
   an undeclared Render means a future rollback to `1.0` in the three git lanes leaves it at 3.0.

**Standing:**
* **M3** — re-scope to a member SUBSET. Full fidelity is **12 GB/cycle (50.07x)**; cost scales
  linearly in members x params x steps. *How many members estimate the spread within tolerance* is
  the next measurement and is deliberately unasserted.
* **M5 (Kr)** — `surf_transform.py` is now truthful. **A/B against `_height_exposure_factor`'s
  0.595–1.0, NEVER against 1.0**, or direction is double-counted.
* **M7** before M5, so Kr does not absorb bathymetry error.
* **#7 waves-arrow** — still the user's #1 report, still open.
* **Selector gaps still open:** script-backed tests have no selector of their own; **246 of 420**
  tracked test files match neither forecast lane (most are product tests that correctly belong to
  neither, but the forecast-relevant subset is unenumerated — `test_map_spots_to_ndbc_buoys.py` and
  `test_sweep_orphaned_l2.py` are visible candidates).
* **#26 needs no documentation work** — the queue already classifies all twelve levers with a
  removal SHA or a "never existed" marker. `RATING_PARTITION_AWARE` never existed: route any
  partition A/B through `SURF_PARTITIONS` (live, 22 files).

---

## §7 — WORKING RULES THAT EARNED THEIR KEEP TODAY

1. **Read the NUMBER, not the colour.** Four guards were green and running nowhere.
2. **Read from the GATE, never from a checkout.** They disagree, and only one is the gate.
3. **A guard that reads SOURCE can see that a call exists, never which value wins.**
4. **Predict each mutation's result BEFORE running it.** A "green" you predicted is a gap; a
   "green" you did not is a finding.
5. **Walk the import graph.** "The service can reach it" is not "the lane can reach it".
6. **An audit must exclude itself from its own evidence.**
7. **Never `git add -A` in a shared tree.** Stage by path, every time.
8. **A guard with false positives teaches the reader to skip it** — which is the failure the guard
   exists to prevent.
