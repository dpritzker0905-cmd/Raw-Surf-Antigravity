# T-2′ — MECHANISM FOUND, INVARIANT APPROVED, IMPLEMENTATION SPEC

**Status: NOT IMPLEMENTED.** Mechanism identified and the invariant is owner-approved. The edit
itself is deliberately left for a session with room to test it (see §4).

## 1. The approved invariant

> For a fixed `(lat, lng, model, layer, hour)`, the band's **served extent + resolution + sampled
> value** must be stable across any interaction that does not change those inputs.
> **Never assert this on an identifier** — `productId` is not injective over the field.

## 2. The mechanism (forensics)

Not tier selection. Not the residency guard. **Cache keying.**

`marineControllerCache.js:193-211` documents it directly:

> *"This key is derived from the RESPONSE (tile_id/region_id), but getModelSafeMarine looks up by
> the REQUEST-derived selectedTileId, which clampViewportBbox hardcodes to GLOBAL_LOOKUP_TILE_ID
> for world bounds. Nothing kept the two in sync… `41addb91` (2026-07-22) moved the served world
> tier from 'global_coarse' to 'global_mid' and silently broke it again."*

So for one product (`global_mid`) there can be **two cache entries under two different keys** — one
request-scoped (viewport bbox) and one world-aliased (bbox width ≥ 340°). Which one answers a given
activation depends on what is already cached, i.e. **on interaction history**.

That is the measured 289 ↔ 15,023 flip under a byte-identical `productId`
(`SOFTWARE_JACOBIAN_11.2_T2PRIME.csv`, rows 1-2), and it explains why the band value moved +15.6%
while the user-visible number stayed `null`.

**Note the recurrence:** this exact response-key vs request-key desync has now been fixed **twice**
(`backendWeatherServiceClientCoverage.js:390`, then the alias at `:209`) and re-broken once by a
tier rename. It is a standing defect class, not an incident.

## 3. Implementation spec

**Step 1 — instrument first (disclosure-only, zero regression risk).**
Publish the served extent alongside the identity, into `__MARINE_PROJECTION_DIAG__`:
`servedVectorCount`, `servedBounds`, `servedWidthDeg`, plus the existing `resolution` /
`resolutionSource` from Phase 0. Today the diag reports `productId` and a `vectorCount` that can
disagree with `__MARINE_WIND_DATA__.cols × rows` — those must be reconciled to one source.

**Step 2 — lock the invariant with a failing test.**
Drive layer OFF→ON ×3 at a fixed coordinate and assert **extent + resolution + sampled value** are
identical on every ON. Assert on those three, **never** on `productId` — a `productId` assertion
passes while the field changes 52×, which is precisely how the prior exit criterion failed.

**Step 3 — make the key deterministic.**
One canonical cache key per `(model, layer, hour, tier)` derived from **one** side of the
request/response pair, not both. The `_aw >= 340` alias at `:209` is a mitigation for the desync,
not a fix; the fix is to stop deriving the same entry two ways.
Kill-switch already present: `window.__RAW_DISABLE_GLOBAL_TILE_ALIAS__`.

**Explicit non-goals:** do not touch `shouldRejectResolutionDowngrade` or its 22 KB suite; do not
change tier selection; do not change any formula. The residency policy is load-bearing and carries
five dated live regressions (`T2_FORENSICS_MISSION_REFUTED_AND_CORRECTED.md`).

## 4. Why the edit was not made in this session

The change lands in the marine cache path. Its blast radius includes the five documented residency
regressions plus the two prior desync incidents, and the only honest verification is the live
OFF→ON×3 extent battery plus the full marine suite. There was not enough remaining working room to
make the change **and** verify it, and a half-applied or unverified data-path edit is a worse
outcome than none — the same reasoning that correctly stopped T-2 and the first T-2′ exit criterion
earlier in this audit.

**Phase 0 is unaffected and remains complete and green** (5 files, 198 tests, mutation-proven).
