# WS-CAN-0033 — the tiers disagree by 2.4×, and nothing says which one answered

**Date** 2026-08-14 · **Severity** Critical (11.2) · **Gate 1** · **Objectives** WS-OBJ-001, 004, 205, 401
· **and it lands on WS-OBJ-506**

Selected by a program-Jacobian pass: highest row-sum in the register (4 open objectives), Critical,
on the current gate, and **carried unmeasured through three consecutive audits** ("not re-verified by
12.1", "not independently re-measured by this audit").

---

## 1. Selection is deterministic — the original framing is partly refuted

The register describes *"non-monotonic z8/z9/z10 tier selection changes the served value at a fixed
coordinate"*, from a UI layer off-on ×3 giving `0.64/6.8 → 0.44/3.1 → 0.64/6.8`.

Perturbing the tier lever directly — `grid_bbox`, the client's viewport — at a **fixed** coordinate,
across a **240× range** in span (±0.25° to ±60°):

| coordinate | result |
|---|---|
| Cocoa Beach 28.36,−80.60 | `0.2737 / 8.88 / 87.3°` — **identical at all 9 spans** |
| Portugal 38.70,−9.40 | `1.4377 / 8.93 / 297.83°` — identical at all 4 spans |
| Open Atlantic 40,−40 | `1.5376 / 8.11 / 280.64°` — identical at all 4 spans |

**Positive control** (a 0% result is worthless without one): Cocoa Beach vs Portugal returned clearly
different values on the same probe, so the instrument discriminates.

⇒ **The backend serving path is viewport-invariant.** Whatever is non-deterministic, it is not the
backend's bbox→tier mapping.

## 2. But the CONSEQUENCE is severe, and that is the finding

Same coordinate, same hour, tier passed **explicitly** via `grid_product_id`:

| tier | Hs (m) | period (s) | direction |
|---|---|---:|---:|
| `gfs_marine_waves_global_coarse` | **0.6684** | 7.35 | 110.67° |
| `gfs_marine_waves_global_mid` | 0.2494 | 6.89 | 95.42° |
| `gfs_marine_waves_florida_east_coast` | 0.2737 | 8.88 | 87.3° |

> **coarse vs regional: +144% on wave height (2.4×), −17% on period, 23.4° apart in direction.**

⚠️ **`0.6684` against the 11.2 symptom `0.64`.** The recorded defect is consistent with the client
having been served the **coarse** tier on those toggles. That is the first time the 11.2 numbers have
been tied to a mechanism.

⇒ Selection determinism is not a hygiene issue. Whatever chooses the tier is choosing between
forecasts that differ by more than a factor of two.

## 3. Who chooses — it is the CLIENT, and the mechanism is documented

`/api/weather/point` takes `grid_product_id` — *"the exact grid product to sample from"* — and the
frontend supplies it (`backendWeatherServiceClientPoint.js:403`, `backendWindServiceClient.js:260`,
`backendCopernicusServiceClient.js:550`). The backend samples what it is told.

And `CLAUDE.md` already records the path by which a close-zoom coordinate can receive a world grid:

> *"the global-grid cache guard is caller-aware: normal close-zoom reuse rejects world grids, while
> the **429 cooldown fallback may reuse a covering one**."*

with a test named `marineGlobalCoarseCooldown.test.js`.

**So the fallback is deliberate availability engineering, and it is defensible.** What was never
established is its **cost** — now measured at 2.4× on height and 23° on direction — and the fact that
it is **silent**: the payload carries no statement of which tier answered.

## 4. Where this actually belongs

This stops being "make selection deterministic" and becomes **disclosure**, which is the register's
own second clause (*"disclose the tier"*) and the same shape as WS-CAN-0062:

> A value served from a 2.4×-different tier, with nothing on the wire saying so, is a number reported
> without saying what it is — **WS-OBJ-506, measure-or-refuse on every status surface**.

WS-OBJ-506 is one of the **eight orphan columns** the Jacobian found (open objectives that no
unstarted task names). This gives it a task, and it is the *third* independent route into 506 today —
the others being the HUD's false `Raster Source: LOADED` through an 18-second blank ocean (12.2 V1).

## 5. What this does NOT establish

- **I did not reproduce the flip.** I proved the tiers disagree and that backend selection is
  viewport-stable. Whether the cooldown fallback fires in normal use, and how often, is unmeasured —
  it needs the client, and the client's value is gated by `WS-CAN-0039` (frozen frontend).
- Three coordinates, one model (GFS), one layer (waves), one hour. The 2.4× is a measurement at
  Cocoa Beach, not a population statistic.
- `grid_product_id` was echoed on the Florida response but **absent** on Portugal and open Atlantic —
  a provenance gap noticed in passing, not investigated.

## 6. Recommended disposition

**Re-scope WS-CAN-0033 from "make selection deterministic" to "disclose the tier, and measure how
often the coarse fallback serves a close-zoom coordinate".** The backend half — stamping the tier and
its resolution on the point response — is unblocked, reaches production today, and is the same
additive-disclosure pattern that closed WS-OBJ-207. The client half is gated behind `WS-CAN-0039`.

---

# PART 2 — the backend half was ALREADY DONE, and guarded. No code was written.

Mission 4 opened to "stamp the tier on the point response". **The first forensic step killed it.**

## The disclosure already exists

Full point responses at one coordinate, tier passed explicitly, diffed field by field:

| field | `global_coarse` | regional (florida) |
|---|---|---|
| `product_id` | `gfs_marine_waves_global_coarse_…` | `gfs_marine_waves_florida_east_coast_…` |
| **`resolution`** | **10.0** | **0.25** |
| `surf_height_m` | **0.9258** | **0.4661** |
| `run_time` | 2026-08-14T05:54:07Z | 2026-08-14T05:40:34Z |

Both halves of the register's Remaining Work — *"make selection deterministic; disclose the tier"* —
are satisfied on the backend:

1. **Deterministic**: selection is viewport-invariant (Part 1 — 240× span, 3 coordinates, positive control).
2. **Disclosed**: `product_id` **and** `resolution` are stamped on every point response, a **40×**
   difference between tiers, shipped by **WS-CAN-0014 at `172f66aa`**.

## And the disclosed number is MEASURED, not asserted

`sampler.deduce_grid_resolution` derives it from the served grid itself — `lats[1] - lats[0]` over the
actual vectors — with one producer. So `10.0` measures a real 10° cell. **Not** a measure-or-refuse violation.

## And it is already guarded

`tests/test_point_resolution_is_stamped.py`, 5 tests passing, including
`test_a_coarse_grid_is_distinguishable_from_a_tiled_one`:

```python
assert resolution_or_none(_grid(10.0)) == pytest.approx(10.0)
assert resolution_or_none(_grid(0.25)) != resolution_or_none(_grid(10.0))
```

⇒ **Nothing to build. Nothing to guard. The work is done.**

## What remains, and where it lives

Entirely client-side, therefore gated by `WS-CAN-0039`:

1. The **client** passes `grid_product_id` — it chooses the tier, and under the documented 429
   cooldown it may reuse a covering world grid at close zoom.
2. **Nothing renders `resolution`.** Per `sampler.resolution_or_none`'s own docstring the frontend
   *re-derives* its own value from served grid bounds (`backendWeatherServiceClientDiag.js:203-210`)
   instead of reading the stamped one.

Both are the shape `geometry_readiness` had before WS-CAN-0062: **on the wire, unread.**

## Disposition

**WS-CAN-0033 backend half → COMPLETE on evidence, no code.** A Critical leaves the Gate 1 board.
The client half should be re-filed against the frontend block rather than left on Gate 1 implying
backend work.

⚠️ Governance rule 16 — what this does **not** establish: I never reproduced the flip itself. The
2.4× tier disagreement and the ~2× `surf_height_m` gap are measured and real, so if the cooldown
fallback fires at close zoom the user sees roughly double the surf. **How often that happens is
unmeasured**, and measuring it needs the client.

★ Third time this session the answer was *"it already exists and nobody read it"* — after the
`/api/health` telemetry and the `geometryReadiness` mapping.
