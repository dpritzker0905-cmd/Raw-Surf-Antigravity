# HANDOFF 2026-07-24 → CODEX — review of your uncommitted WIP + the systemwide audit

**From:** Claude Code (Opus 4.8). **To:** Codex.
**Scope:** I was asked to review the July-24 systemwide audit (`.agents/DEEP_AUDIT.md`). Doing so I
found your fixes for it sitting **uncommitted** in the working tree. I did **NOT** commit, modify, or
revert any of your files — this is a findings report so you can finish them safely. My own work this
session is already committed+pushed (HEAD region: `88fd439d`, `b80f1be2`, `09e2c8d4`); your changes
are layered on top, uncommitted.

## 1. YOUR UNCOMMITTED FOOTPRINT (as of this review)
```
 M CLAUDE.md                                          ← marks the below "COMPLETED PHASE 1 & 2"
 M backend/routes/messages/conversations.py     (+17) ← BOLA (DEBT-BOLA-01)
 M backend/routes/subscriptions_billing/credits.py (+38) ← BOLA
 M backend/routes/subscriptions_billing/payments.py(+12) ← BOLA
 M backend/routes/uploads/core.py               (+1/-1) ← bucket public:False default
 M frontend/src/components/map/marineController.js (+9) ← DEBT-CACHE-03 gwid guard
 M frontend/src/components/map/useMarineOrchestrator.js (+7/-2) ← DEBT-UX-04 deactivate-retain
?? .agents/DEEP_AUDIT.md, .agents/CLAUDE_CODE_HANDOFF.md, fixbake_gulf.json
```
**None of it is committed, and none of it has a test in the tree** (`grep` for
`SAFECACHE_GLOBAL_SKIP` / `DEACTIVATE_RETAIN` in `*.test.js` → 0 hits). CLAUDE.md already asserts these
are "COMPLETED" — that is premature while uncommitted + untested. The house lesson that cost the most
this month (the 3° regression) shipped precisely because a change to the marine fetch/serve path went
in without a test asserting the real invariant. Please don't repeat it on these two.

## 2. ★ CRITICAL — DEBT-CACHE-03 (marineController.js gwid guard): a CONFIRMED conflict

Your uncommitted change adds, inside `getModelSafeMarine`'s containment fallback:
```js
const gwid = Math.abs(g.bounds.east - g.bounds.west);
if (!disableGlobalSkip && (gwid >= 340 || key.includes('global_coarse'))) {
  const reqWidth = Math.abs(bounds.east - bounds.west);
  if (reqWidth < 100) continue;   // skip the world grid for a zoomed-in request
}
```
**Good news first:** you used a GEOMETRY test (`gwid >= 340` on the grid, `reqWidth < 100` on the
viewport). That is model-independent and sidesteps the trap an earlier draft would have hit — for
context, I ran an adversarial regression pass this session and a string-based `tileId !==
'global_coarse'` version would have **blanked EURO at every zoom**, because
`backendWeatherServiceClientCoverage.js:384` excludes EURO from the global branch, so EURO's
`selectedTileId` is never `'global_coarse'`. Your geometry test avoids that.

**The confirmed problem:** the guard is **blanket** — it changes `getModelSafeMarine` for **every**
caller, and `getModelSafeMarine` is ALSO the **429-cooldown blank-prevention fallback**:

`useMarineDataFetcherHelpers.js:296` (the "#10 warm-commit coverage guard" cooldown lane):
```js
// during a 429 cooldown: reuse a grid ONLY if it COVERS the viewport, so we don't blank
cachedData = getModelSafeMarine(model, timeOffset, layer, vpBounds);  // vpBounds = zoomed-in viewport
```
At close zoom during an Open-Meteo 429 cooldown, the **only** covering grid is often the world grid.
Your guard makes `getModelSafeMarine` skip exactly that grid (`reqWidth < 100`), so this fallback gets
**nothing → the map blanks during the cooldown**. DEBT-CACHE-03 wants to deny the world grid at close
zoom (for resolution); the 429 cooldown needs it at close zoom (for blank-prevention). Same function,
opposite requirements — a blanket skip cannot serve both.

**Fix direction (make the skip caller-aware, not blanket):** add an opt-in param, e.g.
`getModelSafeMarine(..., {allowGlobalFallback = false})`, apply the `reqWidth < 100` skip only when
`!allowGlobalFallback`, and have the cooldown lane (`useMarineDataFetcherHelpers.js:296`) pass
`allowGlobalFallback: true`. The primary/close-zoom lane keeps the skip (gets the resolution win); the
cooldown lane keeps the world grid (keeps the blank-prevention). This is the same "don't import a
serving guard into the fallback lane" principle the ring-tear and geofence fixes turned on this month.

**Live test before commit (kill-switch A/B):**
1. Zoom to z6+ on Florida, EURO waves → confirm the resident is now a REGIONAL clip, not 181×83
   (`window.__MARINE_ENGINE__._waveData.waveGrid.cols` should be small, not 181). Then
   `window.__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__ = true` → confirm it reverts to 181×83. That proves
   the win.
2. Force a 429 cooldown (or set the cooldown ref) at z8 and confirm the map does **NOT** blank — this
   is the regression the blanket skip introduces and the caller-aware fix prevents.
Add a unit test asserting the REAL invariant: `getModelSafeMarine` with a zoomed-in bbox and only a
world grid cached returns **null** by default but returns the **world grid** when
`allowGlobalFallback` is set.

## 3. DEBT-UX-04 (useMarineOrchestrator.js deactivate-retain): one thing to verify

Your change retains `marineData` on deactivation (default) and only nulls under
`__RAW_DISABLE_MARINE_DEACTIVATE_RETAIN__`. It also **stops nulling `lastCommittedSigRef.current`**.
That ref is one half of `shouldSkipDuplicateCommit`'s dual-authority dedup
(`useMarineOrchestrator.js` + twins in `useMarineDataFetcherHelpers.js:564-568` / `:466-468`). Risk:
on **reactivation to a DIFFERENT hour/model/layer**, a retained sig could make the fresh commit
**dup-skip** (map stays on the stale retained frame) — or on reactivation to the SAME target, briefly
paint stale before the refetch. Verify: toggle marine → wind → marine while **scrubbing to a new
hour**, and confirm the new hour commits (not the retained one). If it dup-skips, the retain must
produce a fresh signature or clear the ledger on REACTIVATION specifically (not on deactivation).
Kill-switch + a unit test on the reactivation dedup path.

## 4. BOLA WIP (DEBT-BOLA-01) — looks real, needs the test gate

`credits.py` (+38), `payments.py` (+12), `conversations.py` (+17) add
`Depends(get_user_id_from_jwt_or_query)` + ownership checks; `uploads/core.py` flips bucket creation to
`public: False`. Direction matches the audit's P0. Before committing: run the BOLA route tests (or add
them) — a tenancy guard with an off-by-one on the ownership predicate fails **open**, so these need a
positive test (owner passes) AND a negative test (non-owner gets 403). Note memory
[[security-debt-public-storage-buckets-2026-07-14]]: some public-bucket exposure was a **deliberate
user choice** (chat_media/crew_chat) — confirm the `public: False` flip doesn't break an intentionally
public bucket.

## 5. AUDIT ACCURACY NOTES (`.agents/DEEP_AUDIT.md`)
- **Omits a live P0 stability item:** the Render restart-under-load I fixed today (`b80f1be2`, shared
  Open-Meteo 429 circuit breaker) and its OPEN memory lever (16 concurrent 15k-vec parses on a 512 MB
  box). See `HANDOFF-2026-07-24-OPUS48-EVE-render-restart-under-load-429-breaker.md`. The audit's debt
  bank should carry this — it is higher blast-radius than DEBT-THEME-05/OBS-06.
- **Backend test count understated:** audit says "121+ green"; the suite actually **collects 3,784**
  (`pytest --collect-only`). 121 is a narrow subset; don't cite it as the footprint.
- **DEBT-CACHE-03 / DEBT-UX-04 are listed as "open with proposed mitigation," but the mitigations are
  already written** (your uncommitted diffs). The audit is stale relative to your own WIP — reconcile
  after §2/§3 land.
- **DEBT-OBS-06** (`weather.py:464` hardcoded `stale_products_count:0` / `healthy`) — I did not
  re-verify the line this pass; worth a spot-check since serve-path line numbers have moved this month.

## 6. WHAT I DID / DID NOT DO
- DID: read the audit + the actual code; confirmed each debt item's file:line; ran the cooldown-lane
  cross-reference that turns DEBT-CACHE-03 from "looks fine" into "confirmed conflict."
- DID NOT: commit, stage, modify, or revert any of your uncommitted files. They are exactly as you
  left them. My session's commits are independent and already pushed.
- Suggested order to finish: (1) make the gwid skip caller-aware + test (§2), (2) verify the retain
  reactivation-dedup (§3), (3) gate BOLA on positive+negative tests (§4), (4) then update CLAUDE.md to
  "COMPLETED" — not before.
