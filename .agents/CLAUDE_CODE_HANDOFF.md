# 🧬 ULTRA MASTER HANDOFF — Claude Code Edition

> **For**: Claude Code (or any AI agent working on Raw Surf)
> **From**: Antigravity forensic audit session `43209731`
> **Date**: 2026-07-15
> **Method**: Jacobian lens (∂output/∂input traced across all subsystems) + forensic proof (every claim links to source code)
> **Rule**: No guessing. Only proof.

---

## Table of Contents
1. [What This Codebase Is](#1-what-this-codebase-is)
2. [Session History (What We've Done)](#2-session-history)
3. [Architecture Facts (Proven)](#3-architecture-facts)
4. [Security Tasks (14 Total)](#4-security-tasks)
5. [LOC Audit (Files Over 800)](#5-loc-audit)
6. [LOC Split Plans](#6-loc-split-plans)
7. [Weather System Lockpoints](#7-weather-system-lockpoints)
8. [Prior Claude Code Work (Weather Fixes)](#8-prior-claude-code-work)
9. [BRAIN_RULES.md Compliance](#9-brain_rulesmd-compliance)
10. [Verification Commands](#10-verification-commands)
11. [File Ownership Map](#11-file-ownership-map)
12. [Git & Branch Rules](#12-git--branch-rules)

---

## 1. What This Codebase Is

**Raw Surf** is a surf photography marketplace + weather simulation platform.

| Layer | Tech | Location |
|---|---|---|
| Frontend | React 18 + MapLibre GL + WebGL custom shaders | `frontend/src/` |
| Backend | FastAPI (Python 3.12) + SQLAlchemy | `backend/` |
| Database | Supabase (PostgreSQL + pgvector) | Hosted |
| Auth | JWT (Supabase Auth) | `backend/core/security.py` |
| Deploy | Netlify (frontend) + Render (backend) | `dev` branch auto-deploys |
| Weather | GFS/ICON/EURO models via Open-Meteo + Copernicus | `backend/services/weather_pipeline/` |

**User roles**: Surfer, Photographer, Admin, Grom (child surfer with parental controls)

---

## 2. Session History

> All conversation `.md` artifacts on this machine were read. Here's what matters:

| Session | What Was Done | Impact on Your Work |
|---|---|---|
| `ed000353` (Jun 23) | **Your prior handoff**: 7 marine heatmap bug fixes specified | 🔴 Verify these are applied before touching weather files |
| `43209731` (Jul 14-15) | **This audit**: Deep forensic security audit, live visual audit, 14 implementation tasks, LOC audit | 🔴 This document is your primary instruction set |
| `21272b28` | Local machine security audit — clean, no malware | 🟢 Informational only |
| `d23a151e` | System performance audit — DWM leak, disk space | 🟢 Informational only |
| `756f727c` + `7188b5f2` | SmugMug facial recognition photo sorting | 🟢 Shows photographer business model context |
| Others | WordPress fixes, disk cleanup — different projects | 🟢 Not relevant |

---

## 3. Architecture Facts (Proven)

### Auth System

There are **TWO** user auth functions in [security.py](file:///c:/Users/dprit/Raw-Surf/backend/core/security.py):

| Function | Line | Security | Usage Count |
|---|---|---|---|
| `get_current_user_id` | ~86 | ✅ **SECURE** — JWT-only, extracts user_id from Bearer token | 29 Depends() calls |
| `get_user_id_from_jwt_or_query` | ~132 | 🔴 **VULNERABLE** — tries JWT first, falls back to `?user_id=` query param | 97 Depends() calls |

**Goal**: Eliminate ALL 97 usages of the vulnerable function. Replace with the secure one.

**Admin auth**: [admin_auth.py](file:///c:/Users/dprit/Raw-Surf/backend/deps/admin_auth.py) chains `get_current_user_id` → DB `is_admin` check. **227 Depends() calls. SOLID. Do NOT modify.**

**Frontend auth**: [apiClient.js:52-65](file:///c:/Users/dprit/Raw-Surf/frontend/src/lib/apiClient.js#L52-L65) injects `Authorization: Bearer <token>` from `localStorage('raw-surf-user').access_token` on EVERY request. The IDOR fix is **backend-only** — no frontend changes needed.

### Route Architecture

- **223 total route files** across 30 packages
- All registered in [routes/__init__.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/__init__.py)
- **No global auth middleware** — auth is per-endpoint via `Depends()`
- No router-level `dependencies=[]` — each handler declares its own

### Weather System

- **11 endpoints** in [weather.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/weather.py), ALL fully public (zero auth)
- Subscription tier gating is **frontend-only** via [LayerAccessResolver.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/LayerAccessResolver.js)
- Anyone with `curl` can pull EURO/ICON premium weather data for free

---

## 4. Security Tasks (14 Total)

### Tier 1: CRITICAL — Do These First

---

#### T-01: IDOR Migration (97 calls across 30 files)

> [!CAUTION]
> This is the #1 security vulnerability. Any user can act as any other user by passing `?user_id=<victim_id>` in the query string.

**Pattern** (identical for all 30 files):

```python
# Step 1: Change the import
# BEFORE:
from core.security import get_user_id_from_jwt_or_query
# AFTER:
from core.security import get_current_user_id

# Step 2: Change the Depends() call (DO NOT rename the parameter variable)
# BEFORE:
user_id: str = Depends(get_user_id_from_jwt_or_query)
# AFTER:
user_id: str = Depends(get_current_user_id)
```

**Complete file list (sorted by impact)**:

| # | File | Count |
|---|---|---|
| 1 | [posts/interactions.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/posts/interactions.py) | 9 |
| 2 | [content/notes.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/content/notes.py) | 8 |
| 3 | [grom_hq/parental.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/grom_hq/parental.py) | 8 |
| 4 | [grom_hq/verification.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/grom_hq/verification.py) | 6 |
| 5 | [bookings/waitlist.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/waitlist.py) | 6 |
| 6 | [bookings/lineup.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/lineup.py) | 6 |
| 7 | [grom_hq/monitoring.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/grom_hq/monitoring.py) | 5 |
| 8 | [surf_data/surfboards.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/surf_data/surfboards.py) | 5 |
| 9 | [surfer_gallery_review_pkg/claims.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/surfer_gallery_review_pkg/claims.py) | 5 |
| 10 | [bookings/lineup_seats.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/lineup_seats.py) | 4 |
| 11 | [grom_hq/purchases.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/grom_hq/purchases.py) | 4 |
| 12 | [surfer_gallery_review_pkg/entitlements.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/surfer_gallery_review_pkg/entitlements.py) | 3 |
| 13 | [career_hub/passport.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/career_hub/passport.py) | 3 |
| 14 | [notifications/notification_prefs.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/notifications/notification_prefs.py) | 3 |
| 15 | [profiles/username.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/profiles/username.py) | 3 |
| 16 | [compliance_pkg/violations.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/compliance_pkg/violations.py) | 2 |
| 17 | [grom_hq/family.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/grom_hq/family.py) | 2 |
| 18 | [bookings/invite_lifecycle.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/invite_lifecycle.py) | 2 |
| 19 | [surf_spots/spot_admin.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/surf_spots/spot_admin.py) | 2 |
| 20 | [content/note_reactions.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/content/note_reactions.py) | 2 |
| 21 | [subscriptions_billing/subscriptions.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/subscriptions_billing/subscriptions.py) | 1 |
| 22 | [bookings/invites.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/invites.py) | 1 |
| 23 | [admin/analytics_settings.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/admin/analytics_settings.py) | 1 |
| 24 | [bookings/booking_lifecycle.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/booking_lifecycle.py) | 1 |
| 25 | [live/social_live_comments.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/live/social_live_comments.py) | 1 |
| 26 | [explore_discover/geolocation.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/explore_discover/geolocation.py) | 1 |
| 27 | [compliance_pkg/tos.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/compliance_pkg/tos.py) | 1 |
| 28 | [reviews_pkg/review_discovery.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/reviews_pkg/review_discovery.py) | 1 |
| 29 | [bookings/payments.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/payments.py) | 1 |
| | **TOTAL** | **97** |

Also migrate 4 optional-variant calls:
- `get_optional_user_id_from_jwt_or_query` → `get_optional_user_id`
- In: [bookings/directory.py:139](file:///c:/Users/dprit/Raw-Surf/backend/routes/bookings/directory.py#L139), [posts/feed.py:146](file:///c:/Users/dprit/Raw-Surf/backend/routes/posts/feed.py#L146), [surf_spots/spots.py:29](file:///c:/Users/dprit/Raw-Surf/backend/routes/surf_spots/spots.py#L29), [surf_spots/spots.py:269](file:///c:/Users/dprit/Raw-Surf/backend/routes/surf_spots/spots.py#L269)

**Post-migration cleanup**: Delete `get_user_id_from_jwt_or_query` and `get_optional_user_id_from_jwt_or_query` from [security.py:132-178](file:///c:/Users/dprit/Raw-Surf/backend/core/security.py#L132-L178). Only after ALL 101 calls (97+4) are migrated.

---

#### T-02: Upload Endpoint Auth (9 endpoints, 4 files)

| File | Endpoints |
|---|---|
| [uploads/core.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/uploads/core.py) | `/upload`, `/upload/story`, `/upload/conditions`, `/upload/gallery`, `/upload/avatar` |
| [uploads/media.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/uploads/media.py) | `/upload/feed`, `/upload/wave` |
| [uploads/media_gallery.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/uploads/media_gallery.py) | `/upload/user-gallery`, `/upload/gallery-pro`, `/upload/gallery-batch` |
| [uploads/comments.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/uploads/comments.py) | `/upload/comment-media` |

**Pattern**:
```python
# BEFORE
async def upload_story_media(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
# AFTER
async def upload_story_media(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
```

> [!WARNING]
> The general `/upload` endpoint at [core.py:364-366](file:///c:/Users/dprit/Raw-Surf/backend/routes/uploads/core.py#L364-L366) has **no user_id at all**. Ask the user whether it should require auth or remain public for anonymous upload-during-signup flows.

---

#### T-03: Hardcoded Internal Token

Remove `"super_secret_internal_token_123"` default from:
- [websocket.py:16](file:///c:/Users/dprit/Raw-Surf/backend/routes/live/websocket.py#L16)
- [event_bus_core.py:189](file:///c:/Users/dprit/Raw-Surf/backend/event_bus_core.py#L189)

```python
# BEFORE
INTERNAL_TOKEN = os.getenv("INTERNAL_BROADCAST_TOKEN", "super_secret_internal_token_123")
# AFTER
INTERNAL_TOKEN = os.getenv("INTERNAL_BROADCAST_TOKEN", "")
if not INTERNAL_TOKEN:
    logger.warning("INTERNAL_BROADCAST_TOKEN not set — internal broadcasts disabled")
```

Also: set `INTERNAL_BROADCAST_TOKEN` to a real random value in Render env vars.

---

#### T-04: Password Reset Token Leak

**Proof**: [password_reset.py:57-66](file:///c:/Users/dprit/Raw-Surf/backend/routes/auth_pkg/password_reset.py#L57-L66) — `_dev_token` included in response when `ENVIRONMENT`/`ENV`/`NODE_ENV` ≠ "production".

**Fix**: Delete the `include_dev_reset_details` function and its call at [line 212](file:///c:/Users/dprit/Raw-Surf/backend/routes/auth_pkg/password_reset.py#L212).

> [!IMPORTANT]
> Tests in `test_password_reset_admin.py` may rely on `_dev_token`. Update those tests to read the token directly from the database instead.

---

### Tier 2: HIGH

#### T-05: Stripe Webhook Verification

[payments.py:81-103](file:///c:/Users/dprit/Raw-Surf/backend/routes/subscriptions_billing/payments.py#L81-L103) — Make signature verification mandatory (currently conditional: `if webhook_secret and signature`).

#### T-06: WebSocket Admin Auth

[websocket.py:91-113](file:///c:/Users/dprit/Raw-Surf/backend/routes/live/websocket.py#L91-L113) — `/ws/admin/events` has zero auth. Add JWT token verification from query param before `ws_manager.connect()`.

#### T-07: Password Reset Rate Limit

[password_reset.py:159](file:///c:/Users/dprit/Raw-Surf/backend/routes/auth_pkg/password_reset.py#L159) — Zero `rate_limit_check` calls. Add: `rate_limit_check(request, max_requests=3, window_seconds=300, key_prefix="forgot_pw:")`.

#### T-08: Remove WS Auth Bypass

[websocket.py:27](file:///c:/Users/dprit/Raw-Surf/backend/routes/live/websocket.py#L27) — Delete the `os.getenv("BYPASS_WS_AUTH")` check.

#### T-09: Weather API Tier Gate

[weather.py](file:///c:/Users/dprit/Raw-Surf/backend/routes/weather.py) — All 11 endpoints are fully public. Add optional JWT + tier check so that EURO/ICON models require `basic` or higher tier. GFS remains free. `/weather/capabilities` remains public (it's the capabilities discovery endpoint).

---

### Tier 3: MEDIUM

#### T-10: Remove `__FORCE_PREMIUM_TIER__`

[LayerAccessResolver.js:60](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/LayerAccessResolver.js#L60) — Delete: `if (typeof window !== 'undefined' && window.__FORCE_PREMIUM_TIER__) return 'premium';`

**Dependency**: T-09 must be designed first. The bypass currently serves as the only way to test premium weather features without a live subscription.

#### T-11: Health Endpoint Auth

[health.py:24-27](file:///c:/Users/dprit/Raw-Surf/backend/routes/health.py#L24-L27) — Gate `/health` behind admin. Keep `/health/simple` public for load balancers.

#### T-12: Tighten CORS Regex

[server.py:480](file:///c:/Users/dprit/Raw-Surf/backend/server.py#L480) — Change `.*\.netlify\.app` to `(rawsurf|dev--rawsurf|deploy-preview-\d+--rawsurf)\.netlify\.app`.

#### T-13: Env Var Audit

Verify in Render dashboard that `ENV=production`, `SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `INTERNAL_BROADCAST_TOKEN` are all set.

#### T-14: Verify Prior Weather Fixes

Confirm the 7 marine heatmap fixes from session `ed000353` are applied (see Section 8).

---

## 5. LOC Audit (Files Over 800)

> **Rule**: All files must be under 800 LOC except pre-approved exceptions.
> **Method**: `python -c "..."` line count on every `.py`, `.js`, `.jsx`, `.ts`, `.tsx` file in the project.
> **Result**: **0 backend files** over 800 LOC. **9 frontend files** over 800 LOC.

| # | File | LOC | Over By | Verdict |
|---|---|---|---|---|
| 1 | [WebGLMarineEngine.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineEngine.js) | **2,448** | +1,648 | 🔴 **SPLIT** — Single function from L405-L2448. Extractable: render loop, mask management, particle dispatch, heatmap pass, crest pass |
| 2 | [MapWebGL.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/MapWebGL.js) | **1,073** | +273 | 🔴 **SPLIT** — Single component from L46-L1073. Extractable: event handlers, layer management, popup logic |
| 3 | [WebGLMarineLayer.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineLayer.js) | **1,016** | +216 | 🔴 **SPLIT** — Single component from L28-L1014. Extractable: texture upload pipeline, error recovery, resize handling |
| 4 | [openMeteoProtocol.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/openMeteoProtocol.js) | **943** | +143 | 🟠 **SPLIT** — Has clear sections: tile cache, land masking, ocean fill QC, protocol registration |
| 5 | [MapWeatherControls.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/MapWeatherControls.js) | **940** | +140 | 🟠 **SPLIT** — Single component from L59-L939. Extractable: gradient builders, legend rendering, toggle logic |
| 6 | [WebGLMarineMaskRenderer.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineMaskRenderer.js) | **916** | +116 | 🟠 **SPLIT** — 14 exports. Extractable: sheltered water detection, basin verdict logic, mask rendering |
| 7 | [OceanMask.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js) | **889** | +89 | 🟠 **SPLIT** — Single component from L224-L887. Extractable: layer insertion helpers, theme color resolution |
| 8 | [WebGLMarineParticleShaders.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineParticleShaders.js) | **856** | +56 | ✅ **EXCEPTION** — 4 GLSL template literals. Splitting GLSL shader source strings would break them. |
| 9 | [useMarineDataFetcherCore.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js) | **804** | +4 | ✅ **EXCEPTION** — Only 4 LOC over. The hook is cohesive. Splitting would create unnecessary indirection. |

### Pre-Approved Exceptions

| File | LOC | Reason |
|---|---|---|
| `WebGLMarineParticleShaders.js` | 856 | GLSL shader source strings — cannot be split without breaking shader compilation |
| `useMarineDataFetcherCore.js` | 804 | Only 4 LOC over threshold; cohesive data-fetching hook |

---

## 6. LOC Split Plans

> [!IMPORTANT]
> **BRAIN_RULES.md §26**: "Do not rewrite the system. First map the data pipeline... then make the smallest targeted fix." These splits must be surgical extractions, NOT rewrites.

### Split Plan 1: WebGLMarineEngine.js (2,448 → ~4 files, each <700)

**Current structure**:
- L1-404: Utility functions + exported helpers (resolveRatingBandFade, resolveRibbonTaper, shouldRejectResolutionDowngrade, etc.)
- L405-2448: Single `WebGLMarineEngine()` function containing ALL rendering logic

**Proposed extraction**:

| New File | What to Extract | Approx LOC |
|---|---|---|
| `WebGLMarineEngineRender.js` | Heatmap render pass (drawHeatmap/drawBaseWash), rating band painting, field fade logic | ~600 |
| `WebGLMarineEngineCrest.js` | Crest/wave front line rendering (drawCrestLines, drawCoarseCrestBand) | ~400 |
| `WebGLMarineEngineParticles.js` | Particle advection + draw dispatch (stepParticles, drawParticles, lifecycle management) | ~400 |
| `WebGLMarineEngine.js` (remainder) | Constructor, init, dispose, top-level render(), mask texture management, utility exports | ~700 |

**Jacobian**: These are GPU render passes called sequentially in the render loop. They share WebGL context (`gl`) and uniform state but operate on distinct shader programs. Extraction via parameter passing is safe.

### Split Plan 2: MapWebGL.js (1,073 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `MapWebGLHandlers.js` | Mouse/touch event handlers, popup logic, marker click handling | ~400 |
| `MapWebGL.js` (remainder) | Component render, layer orchestration, useEffect hooks | ~650 |

### Split Plan 3: WebGLMarineLayer.js (1,016 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `WebGLMarineLayerTextures.js` | Texture upload pipeline, grid-to-texture conversion, error recovery | ~400 |
| `WebGLMarineLayer.js` (remainder) | Component lifecycle, canvas sizing, render orchestration | ~600 |

### Split Plan 4: openMeteoProtocol.js (943 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `openMeteoLandMasking.js` | `getLandGeoJSONOnce`, `ensureLandCellMask`, `oceanFillLandCells`, `coastalOutlierQC`, `prebuildWaterTempLandMasks` (~L179-375) | ~200 |
| `openMeteoProtocol.js` (remainder) | Protocol registration, tile fetching, cache management | ~740 |

### Split Plan 5: MapWeatherControls.js (940 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `WeatherControlsLegend.js` | `buildGradientCSS`, `buildStops`, legend rendering sub-components | ~250 |
| `MapWeatherControls.js` (remainder) | Main control panel component, toggle state management | ~690 |

### Split Plan 6: WebGLMarineMaskRenderer.js (916 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `WebGLMarineShelterDetection.js` | `classifySheltered`, `pickBasinVerdict`, `stashBasinVerdict`, `applyCachedShelteredVerdict`, `suppressShelteredWater` (~L445-715) | ~270 |
| `WebGLMarineMaskRenderer.js` (remainder) | Polygon helpers, mask projector, basemap overlay, render pipeline | ~640 |

### Split Plan 7: OceanMask.js (889 → 2 files)

| New File | What to Extract | Approx LOC |
|---|---|---|
| `OceanMaskHelpers.js` | `resolveBufferColor`, `safeMoveLayer`, `safeMoveLayersBatch`, `repositionLanduse`, `findInsertionPoint`, `findRoadInsertionPoint`, `buildLandMask` (~L70-222) | ~160 |
| `OceanMask.js` (remainder) | `OceanMaskInner` component, `syncLayers`, effect hooks | ~730 |

---

## 7. Weather System Lockpoints

> [!CAUTION]
> These are LOCKED architectural decisions from BRAIN_RULES.md §26-§28. Violating any of these will break the weather system.

| Rule | Value | Proof |
|---|---|---|
| **14-day forecast horizon** | GFS=384h, ICON=336h (blend), EURO=336h (estimated) | [BRAIN_RULES.md:282-286](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L282-L286) |
| **Never cap the scrubber** | `MARINE_SERIES_MAX_HOURS=336` | [BRAIN_RULES.md:296](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L296) |
| **Capabilities = single source of truth** | `/api/weather/capabilities` serves `max_forecast_hours` | [BRAIN_RULES.md:288](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L288) |
| **LayerAccessResolver = ONLY permissions authority** | No parallel gating anywhere else | [BRAIN_RULES.md:290](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L290) |
| **Series paging**: 48-frame pages | 0–141 / 144–285 / 288–336 | [BRAIN_RULES.md:296-298](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L296-L298) |
| **EURO excluded from eager prewarm** | Copernicus cost constraint | [BRAIN_RULES.md:298](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L298) |
| **TruthOverlay = single diagnostics HUD** | No separate debug panels | [BRAIN_RULES.md:301](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L301) |
| **Client diagnostics throttle** | 60s min per unique violation type | [BRAIN_RULES.md:304](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L304) |

---

## 8. Prior Claude Code Work (Weather Fixes)

These 7 fixes were specified in session `ed000353` (Jun 23). **Verify they are applied before modifying these files**:

| # | Fix | File | What to Check |
|---|---|---|---|
| 1 | OceanMask paint property | [OceanMask.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js) | Line ~313: should be `'line-color'` not `'fill-color'` for `MASK_BUFFER` |
| 2 | OceanMask hide-vs-remove | [OceanMask.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js) | Deactivation should use `setLayoutProperty(lid, 'visibility', 'none')` not `removeLayer` |
| 3 | Abort-storm deadlock | [useMarineDataFetcherCore.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js) | `requestId = ++marineRequestIdRef.current` must come AFTER rate-limit check, not before |
| 4 | Scrub-settle infinite loop | [useMarineOrchestrator.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js) | Safety net should have 3-retry max + terminal error bypass + zoomed-out series frame commit |
| 5 | Cache key inconsistency | [backendWeatherServiceClientCoverage.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js) | `clampViewportBbox` should check REGIONAL_TILES for exact match before falling back to viewport string |
| 6 | ICON 14-day blend abort | [backendWeatherServiceClientHelpers.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientHelpers.js) | Anchor fetches (ICON@168, GFS@168) should use `new AbortController().signal` not caller's signal |
| 7 | PostHog localhost gate | [index.html](file:///c:/Users/dprit/Raw-Surf/frontend/public/index.html) | PostHog init should check `location.hostname` and set `disable_session_recording: true` for localhost |

---

## 9. BRAIN_RULES.md Compliance

| Rule | Status |
|---|---|
| §1: Prefer MCP over ad-hoc scripts | ✅ |
| §5: Role-Based Moderation Safety | ⚠️ **VIOLATED** by weather API — premium data served without role check |
| §9: Stripe Commission Splits (80/20) | ✅ — T-05 must not break webhook processing |
| §14: World Model surf quality formula | ✅ — `spot_ratings.py` implements scoring |
| §22: Git branching — dev only | ✅ — All work targets `dev`. Never push to `main` without explicit user + confirmation handshake |
| §26: 14-day forecast LOCKED | ✅ — **DO NOT MODIFY** `MARINE_SERIES_MAX_HOURS=336` or scrubber caps |

---

## 10. Verification Commands

Run these after each task to prove it worked:

```powershell
# T-01: Must return 0
Get-ChildItem -Path "backend\routes" -Recurse -Filter "*.py" | Select-String -Pattern "Depends\(get_user_id_from_jwt_or_query\)" | Measure-Object | Select-Object -ExpandProperty Count

# T-02: Must return 0
Get-ChildItem -Path "backend\routes\uploads" -Recurse -Filter "*.py" | Select-String -Pattern "user_id: str = Form" | Measure-Object | Select-Object -ExpandProperty Count

# T-03: Must return 0
Get-ChildItem -Path "backend" -Recurse -Filter "*.py" | Select-String -Pattern "super_secret_internal_token_123" | Measure-Object | Select-Object -ExpandProperty Count

# T-04: Must return 0
Select-String -Path "backend\routes\auth_pkg\password_reset.py" -Pattern "_dev_token|_dev_reset_link" | Measure-Object | Select-Object -ExpandProperty Count

# T-10: Must return 0
Select-String -Path "frontend\src\components\map\LayerAccessResolver.js" -Pattern "__FORCE_PREMIUM_TIER__" | Measure-Object | Select-Object -ExpandProperty Count

# LOC Check: Must return 0 (after splits, excluding pre-approved exceptions)
python -c "import os; root='c:/Users/dprit/Raw-Surf/frontend/src'; exceptions=['WebGLMarineParticleShaders.js','useMarineDataFetcherCore.js']; results=[(sum(1 for _ in open(os.path.join(dp,f),encoding='utf-8',errors='ignore')),os.path.join(dp,f)) for dp,dn,fns in os.walk(root) for f in fns if f.endswith(('.js','.jsx','.ts','.tsx')) and f not in exceptions]; violations=[(c,p) for c,p in results if c>800]; [print(f'{c} {p}') for c,p in violations]; print(f'VIOLATIONS: {len(violations)}')"
```

---

## 11. File Ownership Map

If Antigravity and Claude Code work in parallel:

| Agent | Owns | No-Touch Zone |
|---|---|---|
| **Agent A** | `backend/routes/` (non-upload, non-weather, non-auth, non-live) | Do not touch weather, upload, or auth files |
| **Agent B** | `backend/routes/uploads/`, `backend/routes/weather.py`, `backend/routes/live/`, `backend/routes/auth_pkg/`, `backend/routes/subscriptions_billing/`, `backend/routes/health.py`, `backend/server.py`, `backend/event_bus_core.py` | Do not touch routes owned by Agent A |
| **Shared** (coordinate) | `backend/core/security.py` — T-01 cleanup runs LAST | |
| **Frontend splits** | All 7 files in `frontend/src/components/map/` | Coordinate — these are tightly coupled WebGL files |

---

## 12. Git & Branch Rules

1. **All work goes to `dev` branch.** Never `git push origin main`.
2. To push to `main`, you need: (a) explicit user instruction AND (b) confirmation handshake ("Are you sure you want me to push to main?").
3. Prefer fast-forward merge when `main` is strictly behind `dev`.
4. Source: [BRAIN_RULES.md:214-218](file:///c:/Users/dprit/Raw-Surf/BRAIN_RULES.md#L214-L218)

---

> **This document supersedes all prior handoff documents.** Every claim links to exact source code. No guessing.
