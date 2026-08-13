# EXECUTIVE FINISH-LINE BRIEF — Audit 12.1

**One page.** `dev` @ `9febd970` · 2026-08-13 · 59 commits since the 12.0 baseline `3bc776d9`.

---

## Are we still on the right path?

**Yes — with three corrections.** Verdict: **ON PATH WITH CORRECTIONS.**

The direction three consecutive audits reached independently — *composition, reach and measurement,
not new technology* — is unchanged, and this cycle produced the strongest evidence yet that it is
right. **Nothing regressed. No code regression has appeared in three consecutive audits.**

## What actually closed since 12.0

| | |
|---|---|
| ✅ **The accuracy gate now grades the comparison that matters** | Live: `SKILL FLOOR BREACHED at +24h … [pages after 2026-08-22]`. The oldest named-and-unstarted corrective action in the program, open since 2026-08-10 |
| ✅ **The E2E browser lane is fixed and proven** | Five consecutive completed greens, `52 tests · 47 passed · 0 failed`. At the pre-fix 18% rate that has probability ≈ 1 in 5,300 |
| ✅ **A user-visible blank layer was found and fixed** | Water temperature rendered *nothing* on every model — a missing colour-scale key — now fixed, deployed, and guarded at the class level |

Three objectives carry closure certificates: **one forecast composition · the accuracy gate · CI and
E2E lane integrity.** WS-OBJ-705 is the first objective this program has **opened and closed inside a
single cycle.**

## The three corrections

1. **A mission was authorized on work that was already done.** WS-CAN-0026's code was committed
   **52 seconds** before Audit 12.0's own publication commit. 12.0 diagnosed exactly this defect in
   11.4 (22 minutes) and then repeated it. *Fix: run `git log` on a mission's files before
   authorizing it.*
2. **Six findings shipped with no canonical ID** — including a blank layer on every model and the
   worst-latency route in the system — within a day of the register being declared authoritative.
   *Fix: an ID at diagnosis, not at action.*
3. **No dual-path migration has an exit condition.** The arbiter, the settle debounce and the ICON
   blend are in exactly the state 12.0 described. *Fix: a date, and "arm or delete".*

## What blocks each finish line

| Finish line | Status | Binding items |
|---|---|---|
| **A — Reliable production baseline** | ❌ **NOT MET** (6 fail, 4 partial of 18) | every `om://` layer blanks at z2–z3 · `run_time` is the ingest clock · `resolution` is null · degraded geometry reads identical to full · one RAF has no cancel path · one route at a ~1-minute median · **production is 85 days behind** |
| **B — State-of-the-art core** | ❌ **NOT MET** (6 fail, 6 partial of 15) | no runtime video · frame rate unmeasurable · two fabricated status surfaces · no exit conditions · no integrity chain |
| **C — Advanced differentiation** | correctly gated | coverage expansion is one measurement away; everything else is deferred or rejected for stated, still-valid reasons |

## The one number that matters this week

⏰ **2026-08-22 — 9 days.** The paired accuracy gate arms. **On current data it pages**, and the
deficit has *widened* since 12.0: the +24 h persistence gap doubled (Δ +0.007 → +0.015, win 46% →
44%) on a sample that grew 39%. **12.0's "the gap is narrowing" is refuted.** The owner threshold
decision is due before that date; all three options are runtime variables needing no code.

## The next mission

**`WS-CAN-0061` — close the `om://` zoom-floor blank.** Root-caused (`blocked: model_lock`), the
instrument is already deployed, **one value stands between here and the fix**, and it closes
WS-OBJ-101 outright. Then **`WS-CAN-0027`** (Playwright `video: 'retain-on-failure'`) immediately —
~15 minutes, named by five consecutive audits, and its blocker cleared today.

## What must not begin

Zarr/JAX/SWAN-class work · WebGPU · AI correction · any flag flip · any canary · the telemetry
uplink (until `WS-CAN-0063` deletes a `|| 60` that reports a healthy frame rate when the render is
frozen) · **and a seventh broad audit.**

## The honest summary

**The platform's science is stronger than its self-description, and its instruments are now stronger
than both.** Not one item on the failing list is a physics problem. They are: a field carrying the
wrong clock, a string comparison, a missing `cancelAnimationFrame`, one slow route, a missing
disclosure, a config key, and one owner decision.

**None of it needs new technology. All of it needs finishing.**
