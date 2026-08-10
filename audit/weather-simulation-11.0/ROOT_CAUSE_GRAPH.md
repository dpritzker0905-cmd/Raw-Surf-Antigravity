# ROOT CAUSE GRAPH — Weather Simulation 11.0

Three causal chains explain every confirmed finding in this audit. Symptoms are consolidated under
the deepest supported cause rather than listed separately.

---

## CHAIN A — "One label, two quantities" *(the dominant chain)*

```
ROOT: a published field name does not determine which quantity it holds
  |
  +-- the RATING BAND composes a value outside the mandated chain
  |     (rating_transform_grid bypasses resolve_surf_geometry + estimate_surf_at + compute_surf_rating)
  |     => E1-01  band vs point at the SAME coordinate: height up to 3.04x, rating up to 56.9 pts, signed both ways
  |     => F-04   RUNTIME SHADOW: rendered value at a FIXED coordinate drifts with zoom (dR +28 / dG -27, z5->z10)
  |     => J-02   served grid tier NON-MONOTONIC in zoom: 25 cells @z8, 306 @z9, 25 @z10
  |     => corroborates the project's own open QUEUE E#1 (band vs glyph, 2.3-2.7x)
  |
  +-- `wave_period` carries THREE period statistics under one name + one unit
  |     (peak / mean-inverse-moment / per-value fallback across four fetchers)  => E1-04
  |
  +-- requested hour vs rendered hour share one on-screen label
  |     => F-01  "+78 h / EURO / Thu 12 AM" over hour-6 GFS-era pixels, >=60 s
  |
  +-- (previously recorded, same class) `quality_rating` meaning gated vs ungated
        across sibling MCP tools => Codex review section 2

WHY IT SURVIVED  -> see CHAIN B
FIRST REPAIR     -> Mission 1: put the band inside the parity registry (changes no number)
```

**Consolidation note:** E1-01, F-04 and J-02 are **not three findings**. They are one defect observed
from three directions — a Python composition comparison, a WebGL pixel readback, and a grid-metadata
sweep. Treating them separately is what has previously produced 17-item "critical" lists that
collapse under checking.

---

## CHAIN B — "The guard cannot see the defect, and the instrument lies"

```
ROOT: verification surfaces are not wired to the thing they claim to verify
  |
  +-- the composition-parity guard ENUMERATES three surfaces
  |     `sim_rating.py:9-11` asserts "exactly three surfaces compose a rating" -- FALSE at HEAD
  |     => E1-02  the band is structurally invisible to the guard that exists to catch CHAIN A
  |
  +-- `window.__SIM_DIAGNOSTICS__` is a DATA property, not an accessor
  |     => F-02  reports a healthy 60 Hz engine as frozen; measured 23.6 s stale
  |     => cost THIS audit four probes and two false hypotheses
  |     => `window.__RAW_GPU__` additionally changed TYPE mid-session (function -> object)
  |
  +-- counters live OUTSIDE the guard they describe
  |     `_evolutionTicks++` at SimulationLoop.js:226 is outside the `shouldEvolve` block
  |     => reported 304 field evolutions that did not occur
  |
  +-- boot telemetry describes gated code as running
        "[SimLoop] Simulation started -- RK4 particles + field evolution active"
        => F-03  with __IN_SIMULATION_SANDBOX__ undefined, evolveField / windParticles.update /
                 marineParticles.update NEVER execute in the shipped path

CONSEQUENCE: this project keeps re-diagnosing itself through broken instruments.
             Four hypotheses were raised and refuted DURING THIS AUDIT for exactly this reason.
FIRST REPAIR -> Mission 1 (guard) + Mission 2 (accessors)
```

---

## CHAIN C — "Silent fail-safes and incomplete migrations left reachable"

```
ROOT: the system protects itself correctly and then discards the evidence
  |
  +-- renderer refuses an unusable grid and RETAINS the previous field  <-- CORRECT behaviour
  |     `{parity:false, reason:"retained_previous"}` computed, stored, and never surfaced
  |     => F-01 (the disclosure half of CHAIN A's labelling half)
  |
  +-- three composition tiers coexist and all are reachable
  |     (1) direct React->engine path  = AUTHORITATIVE
  |     (2) FieldCompositionEngine     = reachable, populated:false, diagnostics-only at 4 Hz,
  |                                      authority marked Superseded by the repo's own report,
  |                                      3 stale "single source of truth" comments remain
  |     (3) SimulationLoop physics kernel = reachable, INERT (sandbox-gated)
  |     => F-03, and the ambiguity "is this a simulation?" that this audit had to resolve by measurement
  |
  +-- a second marine renderer imported for 81 days
  |     GPUMarineLayer / MarineParticleCanvas imported at MapWebGL.js:7
  |     => RUNTIME CHECK: never mounts. No MarineParticleCanvas in the DOM; only 2 custom layers.
  |     => "two renderers draw concurrently" is REFUTED -> downgrade to code hygiene
  |
  +-- unreachable prototypes retained
  |     wave_wrapping.py (489 lines, diffraction): zero non-test references  => E1-11
  |     FieldEvolutionEngine.js:36 holds a forbidden truncated KNOTS_TO_MS -- dormant behind the
  |     same sandbox gate                                                    => E1-12
  |
  +-- eager allocation regardless of need
        235,072 particles + both custom layers allocated at boot with ZERO layers active  => F-07
```

---

## Findings that belong to NO chain (independent, low severity)

| ID | Finding |
|---|---|
| F-05 | World-sized grid requests (`bbox=-180,-80,180,85`) to paint a 2° viewport — 3.7–6.3 s. **The largest measured latency cost in the session** |
| E1-03 | H1/10 applied after the γ·d cap ⇒ +25.0 % ceiling breach, non-monotonic in offshore Hs. *Ordering defect, its own root* |
| E1-08 | Linear-in-latitude mask uploaded into a slot sampled with a mercator `mask_v` — up to 17.1° of latitude error on a global frame |
| E1-05 | `units` / `value_unit` assigned at 20 sites, read at **0** — every display conversion is hardcoded |
| F-06 | Event listeners net +5.4 per layer-toggle cycle |
| F-09 | Diagnostic overhead in the dev bundle: React Scan overlay, **two** FPS counters, 88 debug globals, a 0×0 canvas |
| F-10 | `ne_50m_land.json` fetched 3× per page load |
| F-12 | Live credential committed in `BRAIN_RULES.md` — **rotate** |

---

## Refuted — do not spend effort here

| Claim | Status | Evidence |
|---|---|---|
| Duplicate / competing RAF loops | **CONTRADICTED** | one `frame` callback per vsync (29.6/s vs 29.6 Hz) |
| Duplicate engine module instances | **CONTRADICTED** | webpack cache: exactly one of each engine module |
| Subscriber churn destabilising the sim | **CONTRADICTED** | 150 samples, 0 transitions, constant 1/1/3 |
| Two marine renderers drawing concurrently | **CONTRADICTED** | second renderer never mounts |
| Geographic dead zones (NY / Portugal / Morocco) | **NOT REPRODUCIBLE** | sea G−R 137–152, land 0–11 |
| Land bleed | **NOT REPRODUCIBLE** | 4–12× separation at z9 |
| Transient texture recreation | **NOT REPRODUCIBLE** | 204/204 balanced over 6 cycles |
| Upside-down field / 180° direction error | **REFUTED both ends** | grid-orientation proof + pixel readback |
| Frame-rate-dependent motion | **CONTRADICTED** | sim clock 1.00× real time, `dt` exactly 1/60 |
| CLAUDE.md height sweep is stale | **CONTRADICTED** | reproduces exactly once wind dir 045° is supplied |

---

## Leverage summary

**Fixing CHAIN B first unblocks CHAIN A**, because CHAIN A cannot be measured while its guard is blind
and its instruments lie. CHAIN C is mostly cleanup whose urgency **dropped** once the second renderer
was proven inert.

> One sentence: **every confirmed defect is a provenance or composition problem — not one is a
> physics problem.**
