# EXECUTIVE RECOVERY BRIEF 11.0
**Raw Surf — Weather Simulation** · 2026-08-09 · branch `dev` · baseline `3d3ccdc2`

---

## The verdict in one paragraph

**Status: YELLOW. The baseline is safe to build on.** After three months framed as "unstable
development", the evidence does not show a broken architecture. The engine loop is textbook-correct
and holds real time exactly. GPU resources are perfectly balanced. Stale-request cancellation already
works. Land masking is correct at every location tested. What is actually wrong is narrower and far
more fixable: **the system repeatedly presents one label for two different quantities, and its own
instruments lie about it.**

---

## The five things that are actually wrong

> **Every finding below survived an adversarial pass.** One agent per Critical/High finding was
> spawned to *refute* it and told to default to "does not survive" when it could not independently
> reproduce the evidence. **30 attacked · 24 survived · 6 killed · 9 severities corrected downward.**
> **After that pass there are NO Critical findings** — the top severity is High.

| # | Problem | Measured | Severity |
|---|---|---|---|
| 1 | **The map's rating band never enters the mandated forecast chain** | Same coordinate: band height up to **3.04×** the point height; rating up to **56.9 points** apart, signed both ways | **High** *(corrected from Critical)* |
| 2 | **The map shows a stale hour/model under confident labels, silently** | Requested +78 h EURO, rendered +6 h, **≥60 s**, no spinner or badge. The app *computed* `parity:false` and discarded it | High |
| 3 | **The guard built to catch #1 cannot see the band** | It enumerates 3 surfaces; `sim_rating.py:9-11` asserts "exactly three" — false at HEAD | Medium |
| 4 | **Height exceeds its own depth-limited ceiling and is non-monotonic** | H1/10 applied after the γ·d cap: **+25.0 %** breach; 10.00 m → 36.86 ft but 10.25 m → **29.50 ft** | Medium |
| 5 | **The primary engine diagnostic is a frozen snapshot** | Reported a healthy 60 Hz engine as stalled; **23.6 s stale**. It misled this audit through four probes | Medium |

**Two more worth acting on immediately, both cheap:**

- ⭐ **A one-line fix removes an entire "frozen animation" failure mode.** `map.triggerRepaint()` sits
  *inside* the `try` that wraps `engine.render()` — a throw skips it and drops the self-sustaining
  repaint chain, and **MapLibre provides no heartbeat for custom layers**. This is the only code-level
  mechanism this audit found for the most-reported historical symptom.
- 🔑 **Live credentials are committed in TWO tracked files**, not one — `BRAIN_RULES.md` *and*
  `.antigravityrules` (275 of 279 lines identical), the second appearing in no audit or index.
  **Rotate both, then scan all refs.**

---

## The five things that are genuinely good (protect them)

1. **Fixed-timestep single-RAF orchestrator** — 1.00× real time, `dt` exactly 1/60. Three separate
   "duplicate loop" hypotheses were raised against it and **all three were refuted by measurement**.
2. **GPU lifecycle** — 6 layer cycles: 204/204 textures, 1092/1092 VAOs, **0** shader-program churn.
3. **Stale-request cancellation** — model switches abort in-flight requests correctly; last click wins.
4. **Zero-network timeline scrubbing** — 14 rapid clicks, **0** requests, exact hour arithmetic.
5. **The capability contract** — 24 model×layer entries separating dispatch key from upstream
   provider, native from estimated horizons, with explicit `unsupported_reason`.

---

## What we can stop worrying about

Four long-standing suspicions were **actively refuted**, not merely "not found":

- **Geographic dead zones** (New York, Portugal, Morocco) — all render correctly; sea/land colour
  separation 137–152 vs 0–11. **Stale historical description.**
- **Land bleed** — 4–12× channel separation at Cocoa Beach; the coastline registers correctly.
- **Duplicate marine renderers drawing at once** — `GPUMarineLayer` is imported but **never mounts**.
  Code hygiene, not a rendering conflict. *Lowers the urgency of a risky removal.*
- **Upside-down fields / 180° direction errors** — refuted from both ends (grid orientation proof and
  live pixel readback).

---

## What to do, in order

| | Action | Risk | Changes a forecast number? |
|---|---|---|---|
| **1** | Extend the composition-parity guard to cover the rating band | Very low | **No** |
| **1b** | Surface the staleness flag the app already computes (parallel, disjoint files) | Very low | **No** |
| 2 | Convert diagnostic globals to live accessors | Very low | No |
| 3 | **Then** isolate the band-vs-point sub-term | Medium | Yes — gated behind #1 |
| 4 | Land the reusable probe suite as Playwright tests | Low | No |
| 5 | Fix the H1/10-after-cap ordering | Medium | Yes |

**The first two change nothing a user sees except honesty.** That is deliberate: this project's
recurring regression pattern is correcting a number it could not yet measure.

---

## What NOT to do

**Reject / defer all of it — no measured limitation justifies any of these today:** WebGPU, compute
shaders, JAX/GPU backend, neural emulators, Zarr/Kerchunk, OffscreenCanvas, a React memoization pass,
and any rewrite of the engine loop.

The measured bottleneck is **network** — world-sized grid requests (`bbox=-180,-80,180,85`) taking
**3.7–6.3 s** to paint a 2° viewport. That is a request-scope bug, not a format or hardware problem.
**The physics is not the bottleneck. Idle draw calls are zero.**

The one modernization the evidence *does* justify is the cheapest: **a real regression harness.**

---

## Honest limits of this audit

- **No video captured, no cross-browser run, 11 of 12 layers untested**, no historical-baseline
  comparison, no antimeridian or high-latitude test.
- ⚠️ **No CI green has ever proven the marine field paints.** The pixel oracle
  (`weather-simulation.spec.js:578`) **skips on all four browser projects**. But *not* because
  runners lack a GPU — that explanation is refuted: the exact CI config under `--disable-gpu` has
  WebGL and paints via SwiftShader, and the sibling GL test passes on Chrome with and without a GPU.
  The oracle is declared **`test.fixme`** — documented work-in-progress with an explicit exit
  condition. ⇒ **`channel:'chromium'` + GPU flags is the wrong fix; finishing the commit-latch is
  the right one.** *(This bullet was wrong in two earlier drafts — first the cause, then the
  conclusion. The measured version is above.)*
- ⚠️ **10 flaky tests, every one on Desktop Safari (WebKit)** — 6 in booking-flow, 4 in
  weather-simulation. `retries: 2` was silently absorbing them and the old reporter never named
  them. A real WebKit stability problem that had no visible surface until 2026-08-09.
- ⚠️ The binding limit on that lane is different and still stands: it grades the **deployed Netlify
  site, not your working tree**, so it can never gate a local edit.
- ★ **A refusal you cannot read is indistinguishable from a pass.** `--reporter=html` printed only
  `47 passed / 5 skipped`; after switching to `list`, the same suite named every test and
  `weather-simulation` went from **0 mentions to 49** in the CI log.
- Backend capacity **deliberately not load-tested** (the local frontend points at production).
- The science findings were produced by a subagent and **not personally re-run** by the lead auditor.
- `b5bbaa7d` and `f5f6a3d` exist but are **not** known-good baselines — untagged single-concern fixes
  from May, predating the entire current forecast chain.
- **Chat transcripts DO exist** (116 sessions, 482.9 MB). The ten preceding sessions were identified
  and their opening instructions read, but ~0.5 GB of message bodies were **not** read. An earlier
  draft of this brief wrongly said they were missing; that has been corrected.
- The deployed frontend builds on **Node 18.20.2 — end-of-life since 2025-03-27**, ~16 months
  unsupported.

---

## One thing to remember

Every confirmed defect in this audit is a **provenance or composition** problem — *one label covering
two quantities*. **Not one of them is a physics problem.** The forecast science is in better shape
than the bookkeeping around it, and the fastest route forward is to make the system honest before
making it different.
