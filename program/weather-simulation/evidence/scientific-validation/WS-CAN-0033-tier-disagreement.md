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
