# 2026-10-21 / 22: lead merge day (lead session local_d6b521eb)

Append-only. One log per session. Ledger lines for this log: 1613-1645 (receipts) plus this PR's pr_open.

## 1. 2026-10-21 07:40Z: what happened overnight

The owner asked at 00:39 EDT for everything to be "merged and pushed and tested before I wake up". The lead asked which PRs
to merge with AskUserQuestion; that blocked the turn until ~07:38 EDT, so nothing merged overnight. Answer: "Speed set"
(#426, #423, #422, #425); production "No, wait for me". Lesson recorded in memory: never block an overnight job on a modal
question; get the PR names in the same breath as the go-ahead.

## 2. 2026-10-21 11:40Z - 2026-10-22 03:10Z: merges, in order

| PR | merge | what | owner's word |
|---|---|---|---|
| #423 | 744775c86 | /products encoded once per manifest version (on) + run-keyed memo (dark) | "Speed set" |
| #425 | a25aaa8ae | light/beach wash alpha measured (docs) | "Speed set" |
| #430 | 73e25a908 | calm wash hold (D-038), merged by its session | owner pick HOLD |
| #434 | 5be9e9dd0 | #430's receipt, merged by its session | (session) |
| #426 | 8392f25b8 | client request diet; SWR cap made opt-in after the independent review | "Speed set" |
| #432 | dbb9713fd | Logfire setup never stops boot (+ receipts 1573-1583, #435 folded in) | reported the failed deploy |
| #429 | 7ac4bff4e | scrub-settle check sees the live map at first load | "merge anything ... that will help progress" |
| #422 | 2a47fd5d8 | static frames step 2b with the three review fixes | "Speed set" |
| #419 | f17508ba0 | dark storm crest cased orange from 8 m (D-039) | "Ship the cased orange from 8 m ..." |
| #438 | 42833a52d | light crests back to the original (D-041) | "The original was better." |
| #439 | 83c1c4c0c | CI weather load off the live backend | "move the CI load off the live server" |
| #428 | 23a91534f | thinner big-surf crests by theme (D-042) | "as the eye sees it, fitted per theme" |
| #431 | 11cb46400 | light wash re-solved apart from dark (D-037) | "Ship #431" |
| #441 | e96a274c6 | stale-grid backoff | "resolve all the conflicts and merge" |
| #427 | d84a94f26 | instant scrub phase 1 spec (docs) | same |
| #442 | 28be37d3f | light crest two-tone lever (off) | same |
| #443 | b240401f8 | static frames ON + publisher builds the lattice from cell centres | "turn on static frames" |
| #433 | 95363ea27 | beach crest style levers (off) | same as #441 |
| #437 | 576e021b1 | instant scrub: GPU-resident frames, adaptive prefetch | "Can we move forward on part 2?" + the eager/on-demand question |

## 3. Findings worth keeping

- Logfire: LOGFIRE_ENABLED=1 without LOGFIRE_TOKEN failed deploy dep-dbcb9eg473hc73fn0hdg (the previous deploy stayed live);
  fixed in #432. To enable later: LOGFIRE_TOKEN first, then LOGFIRE_ENABLED=1.
- Static frames were inert after #422: both post-merge pilots runs refused all 113 frames because a stored product's
  grid.bounds is the request box (north 85), not the cell centres (84). Fixed in #443. The live read-back follows the first
  post-#443 pilots run.
- Render has a build filter: frontend/docs-only merges do not redeploy the backend. Netlify production is the locked
  prod-frozen-3bd38a83 deploy; the owner's "live dev" is dev--rawsurf.netlify.app. Merges were confirmed there by grepping the
  deployed chunks for each merge's kill-switch names.
- Live compact product list: 200, 65.5 KB gzipped, 0.97 s; revalidation 304 in 0.41 s; 11,629 entries.
- Crest colour science (owner rejected height hue flips): one colour family per theme; fix low contrast with luminance
  (two-tone rim and light centre), measured at the real per-zoom crest opacity, not the 0.85 cap. No light wash keeps the
  original light crests visible above ~2 m; the crest must change, not the sea.

## 4. Process lessons (mechanized in the lead's memory)

- One merger. Sessions merging receipts mid-queue forked every queued PR's ledger (#426 re-chained twice).
- Do not remove ledger lines from a branch: a session's permission classifier flagged it as audit tampering. Re-chain
  (append-only) instead. Lines that had already been held for this PR (#429, #431, #441, #442, #443, #440, #437's adaptive
  finding) are appended here verbatim, with #431's `fulfills` remapped to its commitment's new seq.
- floor-staleness reads dev's latest CI; if dev's run is still going it refuses; re-run the job after dev's CI finishes.
- --match-head-commit must carry the SHA verified green, never a re-read head (the #431 slip; correction line 1645).

## 5. Open after this PR

- Crest edge ON for light and beach (owner's pick 2026-10-21 22:34 EDT; one flip PR by the beach session).
- Static frames + instant scrub read-back after the first post-#443 pilots run (one map open, /api/health before and after).
- Production promotion (dev -> main) waits for the owner's word.

## 6. 2026-10-22 03:41Z: owner dislikes light's animations at dev 67021e936 (ledger 1650)

Owner, 23:41 EDT: "The light mode animations that just deployed look strange to me. Make a note of the new changes I don't
like in light mode for the dev@67821e9" (67821e9 read as 67021e936, dev's head at the time).

What changed in light's crest animations on 10-21/22, newest first, with each per-viewer kill switch:

| PR | change | kill (window flag, set before load) |
|---|---|---|
| #445 (67021e936, D-043) | two-tone ON: each crest keeps its colour with a dark rim (colour x0.15) and a light centre line (85% toward white), ribbon to 0.80; far-out crests x3 stronger, back to x1 by z9 | `__RAW_DISABLE_LIGHT_CREST_STYLE__` |
| #431 (11cb46400, D-037) | the sea under the crests: green -> aqua -> teal -> steel blue -> indigo -> maroon | `__RAW_DISABLE_WAVE_SPECTRUM__` |
| #428 (23a91534f, D-042) | big-surf crests thinned at mid-to-close zoom (light from z5) | `__RAW_DISABLE_CREST_DENSITY_ZOOM__` |
| #438 (42833a52d, D-041) | crest colours back to the original (navy / amber / crimson) | `__RAW_DISABLE_LIGHT_CREST_RESTORE__` |

#445 is the change that deployed just before the verdict. The beach two-tone flip (same method) is PAUSED until the owner
says which part he dislikes.
