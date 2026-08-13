# CURRENT ARCHITECTURE CONVERGENCE MAP — Audit 12.1

`dev` @ `9febd970` · 2026-08-13 · compared against Audit 12.0's map at `3ec3fd13`

**Trend vocabulary:** Converged · More Converged · Stable · Transitional · More Duplicated ·
New Bypass · Diverged · Unknown

---

## 1. Data plane

| Responsibility | 12.0 Authority | Current Intended | Current Runtime | Duplicate / Bypass | Trend |
|---|---|---|---|---|---|
| Ingestion | Decoupled GH Actions runner | same | same — green today | in-process scheduler (broken fallback) | **Stable** |
| Model normalization | `WeatherNormalizer.normalize` | same | same | none | **Converged** |
| Grid orientation / units / direction | `WeatherNormalizer` + `_fetch_common` | same | same | none | **Converged** |
| Spatial interpolation | `point_resolution._selection_key` | same | same | none | **Converged** |
| Temporal interpolation | per-hour lane | same | same | ICON >168 h blend | **Transitional** |
| **Product selection z8/z9/z10** | ⚠️ Authority Unknown | deterministic ladder | non-deterministic | — | **Stable (still unknown)** — not re-measured since 11.2 |
| **Model-run identity** | ⚠️ Bypass | `cycle_dt` | **ingest wall clock** | `_pick_cycle` discards `cycle_dt` | **Stable (bypass persists)** — 12.1 strengthens the proof (LV-05) |
| **Resolution disclosure** | ⚠️ Bypass | backend stamps it | **client derives it** | `backendWeatherServiceClientDiag.js:203-210` | **Stable (bypass persists)** |
| Storage / manifest | `ProductStore` + manifest + CAS | same | same | anti-clobber guard fails open | **Stable** |
| Integrity verification | **absent** | end-to-end checksum | none | — | **Stable (absent)** |

## 2. Physics plane

| Responsibility | 12.0 | Current Runtime | Duplicate / Bypass | Trend |
|---|---|---|---|---|
| Nearshore breaking height | Single Verified Authority | `surf_point.resolve_surf_geometry` → `estimate_surf_at` | none | **Converged** ✅ LV-06 |
| Quality score 0–100 | Single Verified Authority | `surf_rating.compute_surf_rating` | none | **Converged** ✅ LV-06 |
| `surf_height_m` write | one site `point_surf_augment.py:204` | same | none | **Converged** ✅ |
| Sim physics | delegates to production | same | none | **Converged** |
| Constants | `science_registry.py` + ratchet | same | none | **Converged** |
| JS rating mirror | Explicitly Coordinated | same | hand-maintained | **Stable** |
| **Rating band vs spot glyph** | ⚠️ Accidental Duplicate (2.3–2.7×) | unchanged | — | **Stable** — sub-term still not isolated |
| **ICON > 168 h composition** | ⚠️ Transitional Dual Path | unchanged | `backendWeatherServiceClient.js:272` still the unconditional per-hour path | **Stable** — 0 post-12.0 commits |
| **Geometry-quality disclosure** | *not mapped by 12.0* | `geometry_readiness` on the wire | **`confidence` does not read it** | ⚠️ **NEW BYPASS SURFACED** (WS-CAN-0062, LV-06) |

## 3. Client state plane

| Responsibility | 12.0 | Current Runtime | Trend |
|---|---|---|---|
| Forecast hour | Single Unverified Authority (6 one-way mirrors) | unchanged | **Stable** |
| **Hour zero** | ⚠️ Accidental Duplicate (3 owners) | unchanged | **Stable** |
| Model / layer selection | Single Verified Authority | unchanged | **Stable** |
| Marine fetch + commit | Single Verified Authority | unchanged | **Stable** |
| **Commit arbitration** | ⚠️ Transitional Dual Path | `arbiterDecide` still dark behind `__RAW_MARINE_ARBITER__` | **Stable — and now overdue**: no exit condition written |
| Async cancellation | Single Verified Authority | unchanged | **Stable** |
| Data / SW cache | Single Verified Authority | unchanged | **Stable** |
| Worker lifecycle | Single Verified Authority | unchanged | **Stable** |

## 4. Render plane

| Responsibility | 12.0 | Current Runtime | Trend |
|---|---|---|---|
| Projection | Single Verified Authority | unchanged — LV-05 re-confirms antimeridian + 64°N | **Converged** |
| MapLibre repaint | Single Verified Authority | unchanged | **Stable** |
| GPU texture / buffer lifecycle | Single **Unverified** Authority | unchanged; live `textureCount: 2`, `framebufferCount: 1` | **Stable** |
| Ocean mask | Single Authority + bounded LRU | unchanged | **Stable** |
| **Animation scheduling** | ⚠️ Accidental Duplicate | unchanged — **`activeRafCount: 1` with `activeLayers: []`** (LV-04) | **Stable — now runtime-confirmed** |
| Particle integration | Explicitly Coordinated, knowingly divergent | unchanged | **Stable** |
| Cursor / infobox values | Single Verified Authority | unchanged | **Stable** |
| Legends | ⚠️ Transitional (2 of 7) | unchanged | **Stable** |
| **Colour-scale resolution** | *not mapped by 12.0* | `colorScales.js` + a class guard over every raster **and** marine layer | ✅ **MORE CONVERGED** — new authority created post-12.0 (WS-CAN-0060) |
| **`om://` protocol model lock** | *not mapped by 12.0* | `isModelMatch` blocks every tile at z2–z3 | ⚠️ **NEW BYPASS SURFACED** (WS-CAN-0061) |

## 5. Observability plane

| Responsibility | 12.0 | Current Runtime | Trend |
|---|---|---|---|
| Backend request metrics | Single Verified Authority | live, 38 routes this window | **Stable** |
| **Backend status endpoints** | ⚠️ Bypass (`system.py:208`) | unchanged | **Stable** |
| Frontend truth lineage | Single Verified Authority | unchanged | **Stable** |
| Frontend↔backend parity | Single Verified Authority | unchanged | **Stable** |
| **Client→server transport** | ⚠️ Absent (one throttled POST) | unchanged **and now known to fabricate `fps`** (LV-04) | ⚠️ **WORSE THAN MAPPED** (WS-CAN-0063) |
| Release identity | Single Verified Authority | dev SW = HEAD exactly | **Converged** |
| Accuracy validation | ⚠️ grading the wrong quantity | ✅ **now grades the paired comparison and warns live** | ✅ **CONVERGED** — the single largest improvement since 12.0 |
| **Uptime / liveness** | absent | probe **built** (`f8825291`), scheduled **nowhere** | **More Converged (code) / still absent (runtime)** |
| **CI floor governance** | *not mapped by 12.0* | pre-push hook + staleness test | ✅ **NEW AUTHORITY** (WS-CAN-0065) |

## 6. Release plane

| Responsibility | 12.0 | Current | Trend |
|---|---|---|---|
| Backend deploy | Render auto-deploys `dev` | `ba7f1c18`, healthy | **Stable** |
| Dev frontend | `3ec3fd13` = HEAD | **`9febd970` = HEAD exactly** | **Stable** |
| **Production frontend** | ⛔ frozen at `3bd38a83`, 84 days | ⛔ **unchanged, now 85 days** | **Stable — the freeze is the constant** |
| CI gating | Single Verified Authority | all green; **E2E now green with content** | ✅ **MORE CONVERGED** |

---

## 7. Verdict: is the architecture converging?

**Yes, but almost entirely on the observability and assurance layers, and not at all on ownership.**

**Converged since 12.0 (4):** the accuracy criterion · CI/E2E lane integrity · colour-scale
resolution (a new authority that did not exist) · CI floor governance (likewise).

**Unchanged (everything in the ownership column).** Every one of 12.0's five named ownership
questions — z-tier determinism, ICON dual composition, `run_time` semantics, the `WeatherTelemetry`
RAF, the accuracy criterion — is in the same state **except the fifth**, which closed. Four of five
remain, and **zero post-12.0 commits touched any of them**.

**Newly surfaced (3), all of which existed before and were simply unmapped:** the `om://` model-lock
bypass, the geometry-disclosure bypass, and the `fps || 60` fabrication on the only client→server
transport.

**Diverged: nothing.** No responsibility gained a second owner during this window.

⚠️ **The one governance failure of convergence: no dual path has an exit condition.** The arbiter,
the settle debounce and the ICON blend are all in exactly the state 12.0 described. 12.0 prescribed
an action for each and none has a *date*. A migration without an exit condition is how a temporary
fallback becomes permanent architecture — which is the drift pattern the brief names, and which this
program is now demonstrating on three fronts at once. **This is cheap to fix and it is governance,
not engineering** (WS-OBJ-402).
