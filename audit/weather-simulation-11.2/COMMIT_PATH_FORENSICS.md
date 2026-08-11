# COMMIT-PATH FORENSICS — the dual-scope race, resolved

**Question chased:** which of two in-flight responses (viewport fetch vs global prewarm) writes
`__MARINE_WIND_DATA__`, and is it order-dependent?

**Answer: NOT last-writer-wins.** The naive race hypothesis is refuted.

## 1. The path

`useMarineWindData.js:459` is the **single writer** of `__MARINE_WIND_DATA__`. It writes `res`,
derived from `marineData`, which is set only after a commit decision.

Every commit passes through **one** arbitrated choke:
`decideMarineCommit(resident, incoming, zoom, viewportBounds, window, nowMs)`
(`marineCommitGate.js`), which is resident-aware. A late-arriving global prewarm response is
therefore evaluated *against what is already displayed* and rejected by the no-downgrade /
subcover rules when a covering regional is resident. Arrival order alone does not decide.

## 2. Where the race genuinely survives

`marineCommitArbiter.js:64` — **rule 1: "Nothing resident (or resident unrenderable/empty) —
commit anything renderable."**

That is the whole remaining window. While a resident exists, the arbiter protects it; while the
resident is **empty**, the first renderable response commits unconditionally.

A layer toggle clears residents. So immediately after `OFF → ON` there is an empty-resident window
in which **arrival order alone decides the field** — and a viewport response and a global prewarm
response are both in flight during exactly that window.

**Jacobian:** ∂(committed field)/∂(arrival order) = 0 while a resident exists, and **≠ 0 only in the
empty-resident window**. That is a precise, bounded statement of the defect — and it is consistent
with the observed 289 ↔ 15,023 flip occurring on layer toggles specifically, never mid-view.

It also explains why the T-2′ step-3 cache fix stabilised the live battery: making the
cache-served candidate deterministic makes the empty-resident window fill deterministically.

## 3. Architecture finding — a transitional dual path in the commit authority

`marineCommitArbiter.js:6-9`: the arbiter is wired at the single decision point but
**the shipped DEFAULT is still the guard chain**; the arbiter runs in SHADOW behind
`__RAW_MARINE_ARBITER__`, ring-logging `arb_shadow_diverge`. Live since 2026-07-18.

Per §23 this is an **Explicitly Coordinated / Transitional Dual Path**, not accidental duplication —
it is declared, flagged, shadowed and differentially tested. It must not be declared complete while
both paths remain active (§26).

## 4. Two hypotheses I raised and measurement refuted

Recorded because the refutations are the useful part:

- **"The arbiter's `ZOOMED_OUT_MAX_ZOOM_DEFAULT = 6.5` diverges from the shipped 7.0."**
  **REFUTED on the live path** — `marineCommitGate.js:183` passes
  `zoomedOutMaxZoom: MARINE_ZOOMED_OUT_MAX_ZOOM` (7.0).
- **"Then the 3000-fixture differential proved agreement at 6.5 while production runs 7.0."**
  **ALSO REFUTED** — the test reaches the arbiter through `decideMarineCommit`
  (`marineCommitArbiter.differential.test.js:80`), so it inherits the same 7.0.

## 5. What survives as a real (small) finding

**F-CP-01 — a stale pre-alignment constant sits as a live fallback default.**
`marineCommitArbiter.js:23` `ZOOMED_OUT_MAX_ZOOM_DEFAULT = 6.5` is dead today on both the
production path and the test path, because every current caller passes the value. But
`marineZoomThresholds.js` documents 6.5-vs-7.0 as the cause of the **z6.4–7.6 "clamp until dwell"**
outage (2026-07-02), fixed by aligning ~8 call sites to 7.0. Any future caller that omits
`zoomedOutMaxZoom` silently re-adopts the outage value.

**And the differential could not catch it if it happened:** `ZOOMS = [9.3, 7.5, 6.4, 5.2, 3.1]`
(`:47`). The two thresholds differ only on **(6.5, 7.0]**, and **no fixture samples that band** —
6.4 sits just below, 7.5 just above. Coverage is silent exactly where the divergence would live.

*Severity: Low today, latent. Two one-line remedies:* import the shared constant as the default
instead of a literal, and add a fixture zoom inside (6.5, 7.0].

## 5b. ✅ MEASURED — the empty-resident window SELF-HEALS. No fix warranted.

Run against **production**, viewport pinned to z9 / (28.35, −80.60), bounds
`-81.22..-79.98, 27.80..28.90` — entirely inside `florida_east_coast`, where production carries a
**0.25°** GFS/waves tile. Layer toggled OFF→ON to open the empty-resident window, then sampled
every 2.5 s for 60 s:

| t after ON | product | resolution | vectors | extent signature |
|---|---|---|---|---|
| **2 509 ms** | `global_mid` | **2°** | 15 023 | `15023\|360\|181\|83` |
| **5 024 ms** | **`florida_east_coast`** | **0.25°** | 289 | `289\|4\|17\|17` |
| 5 024 → 60 430 ms | `florida_east_coast` | 0.25° | 289 | **one signature, 22 consecutive samples** |

`STABLE_AFTER_UPGRADE: true`.

**Conclusion:** the empty-resident window is a **~2.5 s coarse-to-fine transient**, not a stuck
state. Rule 1 fills it with whatever is renderable (correctly — that is the blank-map guard), and
the finer regional product supersedes it 2.5 s later and holds. **There is no suppressor.** The
resolution-blind coverage predicates (`marineRefeedCovers:44`, `marineWarmCommitCovers:35`) gate
the GL upload, not the request, so they never prevented the finer fetch.

**This also retroactively explains the local observation.** The local backend had no
`florida_east_coast` GFS/waves tile (first census: `global_coarse` only, n=112), so `global_mid`
was the *terminal and correct* product there — nothing finer existed to upgrade to. The apparent
"stuck global" was a local product-availability artifact, the same measuring-lane confound already
recorded in `BLIND_FINDINGS_RECONCILIATION.md` §A.

⭐ **Rule 1 must NOT be changed.** Making it reject a coarse fill would reopen the blank-map scar
that `marineGridSeries.js:741-747` keeps global-as-last-resort to prevent — and would trade a
2.5 s transient for a frozen or empty heatmap in regions that only have a global product.

## 6. Status

No code was changed for this investigation. The T-2′ step-3 fix
(`marineController.js`, tightest-containing selection) stands, with the full frontend suite green
at **212 suites / 1968 tests**.
