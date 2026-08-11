# HANDOFF 2026-08-09-C — the five-layer refutation, and what is safe to build on

**Span:** `822a0785..a1971972` (23 commits mine; the tree is shared with session `local_6321aeb8`,
whose commits interleave). **Verified at handoff:** no failures in the last 25 workflow runs; LOC
Governance and Encoding green on `a1971972`; CI/E2E still running at write time.
**Method:** every design in this session was killed or confirmed by a measurement, never by argument.
Five were killed. That is the deliverable.

---

## §1 THE HEADLINE — nothing is wired, and that is the correct outcome

| flag | code default | wired? | verified |
|---|---|---|---|
| `SURF_EXPOSURE_RECONCILED` | `0` | read at exactly ONE site (`surf_transform.py:370`) | ✅ |
| `wave_wrapping.py` | — | **imported by nothing** (grep across `services/` + `routes/`) | ✅ |

Production behaviour is unchanged by this entire session. Everything below is instruments,
measurements, and refutations.

## §2 THE CHAIN — five layers, each closed by measurement

The owner asked to re-cut the rating scale's bucket edges. Five layers of blocker appeared, in order:

| # | the ask | what the measurement said |
|---|---|---|
| 1 | re-cut the edges | **BLOCKED** — the left spike is manufactured by one clamped factor |
| 2 | fix the exposure floor | **BUILT, OFF** — the floor stands in for absent refraction |
| 3 | build a refraction term | **BLOCKED** — needs headland geometry no signal supplies |
| 4 | rebuild the signal as a ray cast | **REFUTED** — it re-measures the cosine |
| 5 | check/ingest the finer asset | **root found** — the coarse mask cannot see the headland |

**1. The distribution (`e7d8545c`).** 13,166 scored spot-hours, 29 valid_times at 6-hourly steps over
exactly 7.0 days, 23 viewports (10 N + 13 S), 667 requests, 0 failures.
`p50 18.6 · p90 46.3 · p99 67.3 · max 69.9` (= the obs-gate cap). Current edges put **85.7% into the
bottom three levels** and 0.00% into good/epic. **The empty top is CORRECT** — the gate caps
unconfirmed spots at 69.9 and the largest *ungated* raw score was 96.0.
⛔ **The left spike is not weather:** 18.9% of served spot-hours are pinned at the `swell_exposure`
floor, binding on **70% of very_poor**. Live: **Jeffreys Bay 9.6 ft / 12 s → score 2.7 "very_poor"**.

**2. The candidate edges are READY** — `E = [7, 22, 42, 56, 70, 84]`, the only data-driven candidate
keeping `test_owner_calibration_anchors.py` at 6/6 *and* preserving "epic unreachable below 9 s"
(equal-population scores 3/6 and breaks it: Tp 7 s reaches 78.7). It turns 40.7/27.1/18.2 into
28.7/27.8/29.5 and leaves the gate arithmetic untouched. ⛔ **Not shipped**: its two new edges are
positioned by the spike, and lead-time drift moves equal-population edges 34% between day 0-1 and
day 5-7.

**3. The dual floor (`da130c41`, `ab547597`).** Quality floors at 0.100, height at 0.595 — and since
`H ~ sqrt(E)`, the height implies **0.354** energy. 3.54× apart. `SURF_EXPOSURE_RECONCILED=1`
replaces the height curve with `sqrt(exposure)` so `height² == exposure` **by construction**: ratio
exactly 1.000 at every angle. Heights move **−46.9% at the floor, 0.0% head-on** — which is why the
owner anchors stay green *and* cannot grade it.
⭐ **The shore-normal audit reversed the conclusion.** Normals at the J-Bay cluster are 102.9–107.6°
and **correct**; the sea (Hs 3.91 m, Tp 11.93 s, FROM 229.5°) is correct. **J-Bay works by
refraction around Cape St Francis**, and the over-generous height floor is *standing in for that
absent term*. Reconcile without adding refraction and every point break is cut ~47%.

**4. Three geometry signals, all refuted.**
- *shore-normal curvature*: J-Bay (wrapping) rotates **6.8°** while New Smyrna (straight beach)
  rotates **17°** and Mavericks **47.8°**. Fit noise plus a 72° asset-fallback discontinuity.
- *land-mask ray cast* (`2067a799` → `a3b21c71`): passed **8/8 controls both directions**, then died
  on its own follow-up — cast from 5 km offshore the shadow vanishes, so it was hitting **J-Bay's own
  shoreline**, i.e. re-measuring `cos Δθ < 0`. ★ The 8/8 matrix could not see it because every
  shadowed control was an inland-pointing bearing: it proved "shadowed vs open", never "adds
  information beyond the cosine".
- *the finer asset* (`2c314ad6`): ETOPO 2022 15s exists but is stored as a **per-spot table**, not a
  raster — `land_present_at` returns `None` at the cape *and* at J-Bay.

**5. The root (`d0ea7f4d`, `fd152d6a`).** The bundled bathymetry is **721×1441 at 0.25° (~28 km)**.
Cape St Francis's latitude row reads **all ocean** — the headland is not in the asset, and it sits
**one diagonal cell** from J-Bay. A live 15s fetch resolves it clearly, even strided to 1.85 km.
⇒ **a data-resolution problem, not an algorithm problem**, which retro-explains all three signal
failures rather than adding a fourth.

## §3 SHIPPED AND USABLE

| commit | what | proof |
|---|---|---|
| `822a0785` | Calibration Census: page on the percentile-invariant claim, `BOUNDS STALE` when the frame is foreign | live run green, margin 1.258×; the same blob at p0.80 still pages |
| `42242bef` | Marine Nightly: warm → classify → REFUSE | control pair, same commit 13 min apart: 30 findings vs 0 |
| `6568d94b` | wind legend derived from the ramp — calm was reading as hurricane | 10 tests; `MapWeatherControls` 957 → 956 |
| `e8f04cc1` | admin map editor: land-override sent `lat/lng` to a model requiring `latitude/longitude` | 422 proven in-process *and* against deployed `/openapi.json` |
| `1738f8fc` | live session harness — video + console + React commits + engine state, per-second JOIN | ran clean; its own refusals caught two of its own bugs |
| `6ce0b2e2` | `build_shore_normals` emits the land mask it always discarded | J-Bay mask decoded, **cape present**; widening costs 0.0 s |
| `04d06d38` | the widened fetch moves nothing | **40/40 entries byte-identical** |

## §4 ⚠️ WHAT IS COMMITTED BUT NOT TRUSTWORTHY

**`wave_wrapping.py` (`a1971972`) — 36 tests pass, and I did not validate its physics.** It is keyed
on shore-normal **rotation**, the premise I refuted in §2.4 — but it measures rotation from the raw
bathymetry mask, a *different source* from the fitted normals I probed. **One of us is measuring the
wrong thing and I could not determine which.** Its 36 tests cannot settle it: they test the
FUNCTION, not whether the input signal discriminates — the exact gap that killed my ray cast.
⇒ **Reconcile those two measurements before touching it.**

## §5 ⭐ THE PATH FORWARD CHANGED AT THE LAST MINUTE

The wrapping workflow's literature agent **refuted the premise I gave it**:
- Snell refraction is **regime-forbidden** past 90° (`Kr → 0` exactly at 90°, no solution beyond).
- Monochromatic edge diffraction — the "~0.5 at the shadow boundary" I specified — is **numerically
  negligible at ocean scale**: `Kd = 0.037` at J-Bay's geometry, **worse** than the current floor in
  the opposite direction.
- ⭐ **What actually works is DIRECTIONAL SPREAD of the spectrum** (Goda/Takayama/Suzuki, ICCE 1978),
  6–13× larger in height. The agent **reproduced Goda's published 0.7 as a control** (0.647–0.707)
  *before* applying it to J-Bay → `Kd_eff` 0.23–0.50, against the shipped 0.595.
- ⭐⭐ **The closed form has NO r/L dependence** — `Kd_eff²` = the fraction of directional energy on
  the lit side of the shadow edge. **It needs no bathymetry raster**, so the asset work I proved
  feasible may not be on the critical path at all.
- ⭐ **The existing `0.10+0.90·cos` form is RIGHT** (a near-constant 1.10× scaling of spectral truth
  over 0–75°). **The whole defect is the flat floor past 90°.**

**Protocol for building it:**
1. Re-run the Goda-0.7 reproduction as the FIRST control. If it does not reproduce, stop.
2. Assert the closed form against the full Fresnel integral across **0–180°**, not the 0–60° it was
   fitted over — J-Bay is at 25.9°, but a straight beach at 120°+ is outside the validated range.
3. Straight-beach constraint at 120/150/180°: must be **no more generous** than today's 0.10.
4. Reconcile against `wave_wrapping.py` (§4). One design is wrong.
5. Only then wire, behind `SURF_EXPOSURE_RECONCILED`.

## §6 THE DEFECT LEDGER — my own errors, all caught by instruments

1. **LOC ratchet red pushed** (`f9066b8d`): I read `| tail -2` output and took the separator for
   success. **The identical truncation defect I fixed in the census that morning** (`tail -40` hiding
   the failing exemplar). Gate is now checked BY EXIT CODE.
2. **Flag shipped unregistered** (`da130c41`): 13 CI failures across 7 SHAs on one missing registry
   line; the sibling session fixed it. ⇒ **register a science switch in the commit that adds it.**
3. **A "fix" that was a regression**: disabling `prewarmMarineSeries` removed 5 of 63 requests and
   made panzoom/scrub *worse*. ⛔ And the A/B was **not attributable at all** — the same config run
   twice differed by 48% (panzoom) and 91% (scrub). ★ **I built an instrument and assigned causes
   before measuring its noise floor.**
4. **A control matrix that could not fail** (the ray cast's 8/8).
5. **Wrong Supabase** — caught before running a full rebuild that would have built from the phantom
   catalogue. Memory written: `the-two-supabase-projects-and-which-lane-reads-which-2026-08-09`.

## §7 OPEN, RANKED

1. **Build the spectral closed form** (§5) — highest value, no asset dependency.
2. **Reconcile the two rotation measurements** (§4) — decides whether `wave_wrapping.py` is live work.
3. **Full `build_shore_normals` rebuild** — protocol in `04d06d38`: dispatch the workflow (live
   creds), and BEFORE accepting its commit diff `entries` for added/**dropped**/changed (my n=40
   sampled only *accepted* spots and cannot see a newly-accepted one), count `masks` coverage, check
   the ~390 KB size delta. ⛔ The workflow `git push`es — never dispatch it to look.
4. **Edge re-cut E** — after the floor resolves.
5. **The perf trio** (admin-slow, scrub lag, pan/zoom clearing) — the *code* findings stand on source
   reads; the attribution does not. Instrument the four suspected paths with **counters** (counts
   spread 34% where timings spread 91%).

---

## §8 CONTEXT CLOSE — what is in flight, and one live breakage to look at first

**⚠️ FLAGGED TO THE SIBLING SESSION, uncommitted in the shared tree at close:**
`frontend/src/components/map/MapWeatherControls.js` will throw at render.
- line 140 `}, [activeLayer, activeModel, timeOffsetHours, surfMode]);`
- line 186 `const activeLayer = activeLayers[0] || null;` — **declared AFTER its use** ⇒ temporal
  dead zone `ReferenceError`
- `timeOffsetHours` appears ONLY at line 140 — never defined in that scope
There is **no `MapWeatherControls` test** (0 matches), so only rendering the map catches it. Fix is
to move the `useMemo` below line 186 and use the real prop name (`currentTimeOffset`).

**IN FLIGHT — cut 2 (`marineGlobalPrewarm.js`).** Dispatched to a fresh-context workflow
(`wf_e24ae4a9-943`) with the complete spec from `3af1ef12`: one builder, then two adversarial
agents (behaviour + mutation). At close it had returned **0 of 3 agents** and the module did not
exist, so **nothing was committed** — correct, because an unfinished refactor of the live marine
fetch path is worse than none.
- results land in that run's `journal.jsonl`, one `{"type":"result"}` line per agent
- ⭐ **read the MUTATION result before the green suite.** If stubbing `prewarmGlobalMarineGrid`
  does not kill `marineController.globalSeriesPrewarm.test.js`, the series warm is not wired to
  anything observable and the move is unsafe no matter what else passes. That test's own header
  records the precedent: it "shipped 2026-07-04 against a cache that was never warmed".
- the seam (`registerPrewarmDeps`) is the new failure surface: a prewarm that silently becomes a
  no-op passes every test that is not specifically watching for it.

**STATE AT CLOSE:** branch green on the last verified SHA; cut 1 landed (853 → 776); nothing wired;
`SURF_EXPOSURE_RECONCILED` OFF and registered; `marineGridSeries.js` sitting at exactly **800/800**,
so the next edit to it needs its own relocation regardless of cut 2.
