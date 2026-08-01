# HANDOFF — 2026-08-01 · Two agents, one tree, and a fix that could not fire

**Entry point stays `START-HERE-2026-08-01-THE-ONE-QUEUE.md`.** This is the session record: what
shipped, what was DISPROVEN, and what the next context should not repeat.

Branch `dev` == `origin/dev`. Two agents worked this tree concurrently all session — **stage BY PATH,
never `git add -A`** (standing rule 18; I violated it once and pushed another agent's mutation test).

---

## ⭐ THE ONE THING TO READ FIRST

**#11's guard shipped, and it is STRUCTURALLY INCAPABLE OF FIRING.** Two agents proved this from
opposite directions and the halves only make sense together:

* **me, `50c74e33`** — A/B through the ladder with `__RAW_DISABLE_MASK_NO_SHRINK__=true`:
  guard ON and guard OFF are **byte-identical** on the reproduced path (mask holds 3.1° either way,
  `shrink detected: 0` both). ⇒ the fix does nothing. *Effect measured, cause unknown.*
* **other agent, `3a0987ee`** — telemetry at the mask-commit exits, read live at z8.18:
  `exit:"reached_guard"`, `hasIncumbentTex:true`, **`incumbentSpan:null`**. ROOT:
  `WebGLMarineEngine.js:2354` (the 2026-07-04 Punat stale-overlay clear) **nulls
  `_overlayMaskBounds` below z12 and KEEPS the texture**. The guard needs non-null incumbent bounds,
  and the halo band is **6.74–8.03 — entirely below 12.** *Cause found.*

### ⭐⭐ SUPERSEDED AGAIN, SAME NIGHT — `883c0588` FOUND THE REAL ROOT

The "wrong lane" diagnosis above was itself incomplete. Walking 8.18→8.03 live shows **no mask
commit runs at all** on that path (`maskCommit: null`) ⇒ the guard is never even reached, and any
fix to it changes nothing. **The mask never shrank — THE VIEWPORT OUTGREW A STATIC MASK.**

    rung1 z8.18   view 2.16    _cachedMaskBounds 2.363
    rung2 z8.03   view 2.386   _cachedMaskBounds 2.363    SHRANK: false
    _lastMaskRepatchReason "hysteresis_covered"  |  renderer baseCoversView false / coverage_gap

**ROOT — two predicates on the SAME viewport disagree:**

    rp.box       -81.4430408 … -79.0569592   span 2.386  -> hysteresis COVERS = true
    _cachedMask  -81.5501    … -79.1873      span 2.363  -> renderer   COVERS = false
    gap: east +0.1304, ONE EDGE ONLY

`rp.box` is the viewport we **REQUESTED**; `_cachedMaskBounds` is what the texture **DELIVERED**,
snapped smaller. **The repaint skip is granted on INTENT and the delivery is never re-checked**, so
`hysteresis_covered` latches while the renderer haloes the uncovered edge.
⇒ Textbook coverage class, one level deeper than anyone had looked: *chosen with no requirement that
it CONTAIN what it covers, degrading silently.*
★ **Three successive root claims died to measurement in one night — mine (a shrink guard), the
lane-blindness one, and finally this.** Each was killed by instrumenting the FAILING INSTANCE first.
⚠️ My `7551d511` guard is therefore not merely inert, it was solving **a defect that does not exist**
(nothing shrinks). Leave it (harmless, fails open, A/B-proven byte-identical) or remove it, but do
not "improve" it.

⭐ **THE ORIGINAL JACOBIAN NOTE (kept — it was right about lanes, wrong about the mechanism):**
**THE JACOBIAN VARIABLE IS WHICH LANE THE GUARD READS** — not a threshold, not the hysteresis.
It reads the OVERLAY lane (nulled <z12); the lane that actually paints and haloes is the **CACHED**
mask, whose bounds are live and match the rendered `maskId.mb`.
⛔ **Do NOT fix by removing the :2354 clear** — that clear is itself a proven fix (its own comment
records that clearing the bounds ALONE removed the rectangle block). The fix must give the guard
incumbent bounds that **survive** the clear.

---

## SHIPPED AND VERIFIED

| item | commit | evidence |
|---|---|---|
| **#12 pilot-region starvation** | `7da00ca8` | ✅✅ **production before/after.** Run `74f58951` 20:45→22:57Z: uk_ireland/east_australia **450.1 h EXPIRED → 1.8 h covering**; census **8 EXPIRED → 0**. Attribution SINGULAR via `merge-base` (multi-bbox `2b0e1466` was NOT in that SHA). The pick was **predicted at 22:11Z before the products landed.** |
| **#13+#14 obs gate at hub+sim** | `79e1001a` | 475 tests; measured 999 spot-hours first (binds 6.61%, +72h 9.91%, max drop 24.0) |
| **#18 partitions period gate** | `4246c56d` | 399 tests; threshold calibrated at a natural gap, not chosen |
| **#17 infobox label** | `5ae2d267` | 23 tests — ⚠️ **and it left 7 red elsewhere**, see below |
| ladder kill-switch A/B | `50c74e33` | `ML_WINDOW_FLAGS` + `ML_VIEW_W/H` — no engine guard could be A/B'd through the harness before this |

**Other agent, same session:** `dd6fd934` live `_washOpacityEff` ReferenceError · `974bf284` render
error counter was a LIFETIME total (3 throws an hour apart killed the layer) · `4cd8512c` **nothing
ran ESLint at all**, and the ts/tsx glob had no parser so **21 admin files were never linted** ·
`2fba1eb1` ledger-vs-repo audit over 626 cited SHAs, found one fix that never merged · `8e981d96`
repaired my 7 broken assertions · `ea91b82a` #26 dead levers · `52fec7de` Node 20 runtime.

---

## ⚠️ WHAT I GOT WRONG — read these before trusting a claim of mine

1. **"Merging to `main` is the fix" — asserted THREE times, false.** `gh run list --json headBranch`
   shows every `forecast-ingest-pilots` run on **`branch=dev`**. The fix was live on push.
   `origin/main` is ~905 commits behind. **"Default branch" ≠ "production".** (standing rule 19)
2. **`git add -A` captured another agent's deliberately-broken mutation** and I pushed it to
   `origin/dev` (`7da00ca8`), corrected in `166f4cf1`. One word — `get_pilot_regions` for
   `get_all_pilot_regions` — that defeats the entire fix it sits inside. **I had already detected the
   concurrent process and staged the whole tree anyway: detecting a collision is not containing it.**
3. **My #17 rename left 7 tests red.** I ran `--testPathPattern="forecast-card"` (23 green) and never
   grepped for the string I renamed. Two older suites did `cards.find(c => c.label === 'Height')`.
   ⇒ **a rename's blast radius is every test that looks up the OLD NAME — grep the string, don't just
   run the nearest test file.**
4. **"18.7-day-old data is SERVING"** — measured false. It was **absence**: 0 of 4 products covered
   the present. Product COUNT was the tell (340 covering vs 4 expired).
5. **The queue's #17/#10 framing was wrong and I inherited it** — the infobox ALREADY showed both
   heights; the defect was that the offshore one was labelled `Height` and rendered FIRST.

---

## ⚠️⚠️ FIVE OF MY OWN INSTRUMENTS REPORTED SUCCESS HAVING TESTED NOTHING

Every one was caught by a **known-present control** or an explicit assert. This is the session's
dominant failure mode, not the physics.

1. `npx babel … && echo "OK"` printed **"BABEL TRANSFORM OK"** — the `&&` fired on `tail` succeeding.
   Babel had failed. **A pipeline's exit status is the LAST stage's.**
2. A negative-control mutation written to `/tmp/…` from bash, read by **Windows Python** which cannot
   see MSYS `/tmp` ⇒ the mutation never landed and the control "passed" on unmutated code.
3. A bundle-presence search reported my symbol missing — **but so were `WebGLMarineEngine` and
   `shouldRejectResolutionDowngrade`**, while `__RAW_GPU__` demonstrably existed. The probe couldn't
   see the lazy chunk. **Without the known-present needle I would have reported "my fix isn't live."**
4. `overlayMask: undefined` at every rung — **the pane wasn't compositing**, so no render-path
   telemetry could ever be written. A finding about the PANE, nearly filed as one about the mask lane.
5. **The first ladder run came back completely clean** — `mask=off` at every rung meant the defect's
   PRECONDITION never occurred. ⇒ **A clean run of an experiment that did not reproduce the failure
   is not evidence about the fix.**

---

## THE BROWSER PANE — settled, do not re-litigate

* A **hidden pane SUSPENDS ALL TIMERS** (`setInterval` AND `setTimeout`, not merely rAF-throttling).
  Measured: an installed 700 ms sampler produced **1 sample** — the synchronous one. Every awaited
  probe times out at 30 s because the clock itself is stopped.
* `computer{action:'screenshot'}` is the **cheapest liveness test**: it errors when frozen, returns an
  image when live. **Screenshot FIRST, before any measurement sequence.**
* A single successful screenshot does **not** mean it stays up for a path.
* ⇒ **Use `frontend/scripts/probe_marine_direction_ladder.js` instead.** It is Playwright-driven,
  reads **committed engine state** (event-driven, rAF-independent), and already records
  `overlayMask` + `zoomPath`. **It existed the whole time; I burned five calls fighting the pane.**
* `preview_start({url:'http://localhost:3009'})` opens a read-only TAB against another session's
  server — no competing process. The `{name:}` form fails on port-in-use.

**Ladder recipe that reproduces the halo PRECONDITION** (the first attempt failed because it started
already zoomed in, with the fine tile resident):

    cd frontend && ML_BASE=http://localhost:3009 ML_MODELS=GFS ML_LAYERS=waves \
      ML_ZOOMS=4,6,7.5,8.18,8.03,8.18,8.03 ML_LAT=28.25 ML_LNG=-80.50 \
      node scripts/probe_marine_direction_ladder.js <outdir>

Starting **zoomed OUT** is what makes the world grid (181x82) resident on the way in so
`_rawWideTrigger` fires ⇒ REPLACE engages ⇒ `reason=coverage_gap`. A/B any guard with
`ML_WINDOW_FLAGS='{"__RAW_DISABLE_MASK_NO_SHRINK__":true}'`.

---

## NEXT — in order

1. **#11, now that the root is attributed.** Give the guard incumbent bounds that survive the :2354
   clear (the CACHED-mask lane holds live bounds). Then re-run the A/B above; it must now DIFFER.
2. **#7** — the user's longest-standing report. `a77aeec1` localized #7(a): the partition loss has
   exactly two possible mechanisms and one log tells them apart.
3. **#8** — still only a two-line hypothesis, **no forensics**. Pin it against a failing instance
   before building anything (trap #1).
4. **#5 `SURF_PARTITIONS` flip** — owner decision, 3 lanes together; **blocks #10** (`partitions` is
   `None` at every site measured).
5. **#9 period layer** — the state-of-the-art gap; a feature build, not a fix.

## OPS

* **Census at 2026-08-01 02:13Z: 137 lanes — 0 EXPIRED, 0 CRITICAL, 6 warn, 131 ok.** The 6 are all
  `global_coarse` at 8.2-8.3 h against an 8 h warn / 12 h critical bound (core cron is 4-hourly), all
  still COVERING with ~320 h horizon. Two missed cycles, not a defect — but if it persists past 12 h
  it becomes CRITICAL and the monitor will page.
* **MEMORY.md compacted 2026-08-01:** 22.1 KB -> 15.9 KB, under the 17 KB threshold, by moving the
  2026-07-12→30 index sections verbatim into `ARCHIVE-link-index-2026-07-12-to-30.md`. **Every link
  preserved and verified to resolve.** 264 memory files; the INDEX is the bottleneck, not the files.

* **ERA5**: pid 71096 exited on its own after 21.5 h having banked **nothing** (all-or-nothing,
  pre-`3ae53a5e`). Task is `Ready`; runs now checkpoint every 10 spots.
* **Data Health Monitor** now runs `product_run_age_census.py` and **paged correctly** (red 20:13 +
  21:33, green after the fix). `REGION_HEALTH_PAGING=0` downgrades to a warning. Leave it paging.
* Census is the regional-freshness instrument the two older ones could not be:
  `data_health._is_global()` and `timeline_slot_census.py:54` **both skip regional by construction**,
  and the slot census asks a different question (`valid_time` = COVERAGE). **An 18-day-old run covers
  every lattice slot perfectly.**
