# Gate: client-display-tester-v1
Stamp: 2026-11-24T18:56:00Z (written and committed before the tester exists, before any of its runs and before any flip)
Candidate: a scheduled, offline browser tester that turns `INFOBOX_OWN_FRAME` and `GLYPH_TIDE_OWN` (#1219, client build flags,
shipped DARK) OFF at runtime through a fetched kill list when the infobox stops equalling the drawn frame or the glyph tide stops
equalling the tide marker. It is the "client-side tester" D-090 rule 1 requires before either flag may ship ON.
Metric: per pre-registered row (the Rows section), parity between the surface under test and its reference, at display rounding.
- Infobox rows: the card's number vs the SHOWN frame's value at the point, decoded independently in Node from the CDN bytes
  (bilinear on the frame's cell-centre lattice, integer wrap on full-circle grids, any no-data corner = no data).
- Glyph rows: the glyph's tide (accessible name) vs the tide overlay marker (accessible name), at the same scrubbed hour.
Pass threshold: EVERY measured row equal, at the tolerances below, and at least 80% of the pre-registered rows measured.
- Integer cards (pressure hPa, gusts kts, temperatures °F): |card − decoded| ≤ 0.5 + 1e-6.
- One-decimal cards (currents kts): |card − decoded| ≤ 0.05 + 1e-6.
- The "at <time>" note: present exactly when the shown frame's valid time is ≥ 30 min from the selected instant.
- Glyph tide: the height text and trend word are the same strings; past the payload's coverage both show no tide.
- The third oracle (below) agrees with the Node decoder within its stated bound, so the card and the decoder cannot share a bug.
Controls: a null control and seven seeded positive controls, all required before any flip (Acceptance A3-A5).
- Baseline: the SPA built from `dev` HEAD with both flags ON, against the fixture CDN and the local mock.
Decision rule: decide() below maps each run to a verdict and an action. The flip to ON is allowed only when A1-A5 all pass, are
recorded in `results/client-display-tester-v1.md` (a LATER commit than this gate), and the director carries the owner's word.
Unmeasured items: named in the "Unmeasured, named now" section. An unmeasured row counts against the 80% floor, never as a pass.
Served change: none in this PR (documentation only). The later flip of either flag is a served display change and needs the
owner's word (D-090), under this tester.

## Why

- D-090 (owner, 2026-11-23) allows a fix ON only with a tester that turns it off on failure, proven to fire.
- The backend `flag_guardrail` cannot reach these flags: they are compiled into the bundle, and the runtime manifest
  (`control/flags.json`) is private, read with the service key.
- David, 2026-11-24, choosing "Build client tester (Recommended)": #1219 ships dark; this tester comes after it, then the code,
  then the flip under it. The order is this gate, then the code PR, then the flip.

## What runs, and where (never the live backend)

- **Runner.** A GitHub Actions job runs a headless browser (Playwright, the `frontend/scripts/offline-backend/ab_lib.js` launcher)
  against the SPA built from `dev` HEAD with `REACT_APP_INFOBOX_OWN_FRAME=true REACT_APP_GLYPH_TIDE_OWN=true`.
- **Data.** Our raster frames come from a local fixture CDN (`own_frames_fixture.js`, extended by the code PR with the sets
  below). Every `/api` call is answered by a local mock: surf spots, spot ratings for 3 spots, and the `/point-tide` payload.
- **Isolation.**
  - Open-Meteo hosts are aborted.
  - The live API host is intercepted locally.
  - Every session writes a host audit, and a LEAK verdict is a SANITY breach.
  - The tester sends **zero** requests to Render, Supabase or any live host, except the one kill-list write described below,
    which goes to storage, not Render.
- **Cadence.**
  - Every 6 hours (cron `17 */6 * * *`).
  - On every push to `dev` that changes `frontend/src/**`.
  - On `workflow_dispatch`.

## Rows (pre-registered)

### A. Infobox, flag `INFOBOX_OWN_FRAME`

**Layer and model, by fixture set:**

| # | layer | model | fixture set |
|---|---|---|---|
| 1 | pressure | GFS | `GFS/weather/pressure/global_0p5` |
| 2 | gusts | GFS | instantaneous gust window |
| 3 | gusts | EURO | the 6-hour max gust window |
| 4 | currents | GFS | NOAA RTOFS |
| 5 | currents | EURO | Copernicus |
| 6 | air temp | ICON | 0.125°, no terrain correction in the fixture |
| 7 | water temp | ICON | Copernicus, 1/6° |

**Points:**

| id | where | why |
|---|---|---|
| P1 | 52N 40W | a strong gradient |
| P2 | 18N 70W | a tight low |
| P3 | 0N 179.9E | the antimeridian, which exercises the wrap |
| P4 | 40N 100W | land, so no data for the ocean layers (currents, water temp) |

- **Hours:** 0, 1 (off the 3-hourly lattice, so the card must say "at <time>"), 9, 24 and 200.
- **Rows:** 7 × 4 × 5 = 140 pre-registered. P4 on the atmospheric layers (pressure, gusts, air temp) is measured like any other
  point. P4 on currents and water temp must show "No data here" / "Land / no data" and no number.

### B. Glyph tide, flag `GLYPH_TIDE_OWN`

- **Spots:** S1 and S2 in one ~0.1° tide cell, S3 in another, all rated by the mock (Surf Rating on).
- **Hours:** 0, 5, 17, 30 and 60. Hour 60 is past the mock payload's 48 h coverage, so both the glyph and the marker must show
  no tide.
- **Rows:** 3 × 5 = 15 pre-registered.

## The third oracle

The fixture generator also writes, per frame, a sidecar with the expected value at P1-P4. It is computed by the generator from
its own quantised node values, in separate code from both the app and the Node decoder.

- **Agreement required:** the Node decoder must match the sidecar to within 1e-6 of the field's own unit. If they disagree, the
  run is INCONCLUSIVE (a harness fault), never a pass.

## Verdicts

| verdict | when |
|---|---|
| PASS | every measured row equal, and at least 80% of the 155 rows measured |
| WORSE | at least 1 measured row unequal (any flag) |
| SANITY | a card value outside physical bounds; a card number where the frame decodes to no data; or a host-audit LEAK |
| INCONCLUSIVE | the harness broke, fewer than 80% of rows were measured, or the oracles disagree |

The physical bounds for SANITY:

| layer | bounds |
|---|---|
| pressure | 870-1090 hPa |
| gusts | 0-200 kts |
| currents | 0-10 kts |
| temperatures | -90 to 60 °C |

The verdict is per flag: section A rows judge `INFOBOX_OWN_FRAME`, section B rows judge `GLYPH_TIDE_OWN`.

## decide() (pure function, unit-tested)

`decide(report, state) -> { [flag]: { action: 'off' | 'keep' | 'propose_on', reason } }`

1. WORSE -> `off`.
2. SANITY -> `off`. A LEAK also marks the run invalid and is reported.
3. INCONCLUSIVE -> `keep` and report to the owner. Three consecutive INCONCLUSIVE -> `off` (fail closed: an ON flag that is
   untested is what D-090 forbids). An INCONCLUSIVE never extends a PASS streak.
4. PASS -> `keep`.
5. After an `off`, three consecutive PASS give `propose_on` only.
   - decide() never writes ON.
   - Only the owner clears a kill, by `workflow_dispatch` (D-087's rule: the owner re-enables).

## The runtime kill (the client honours it)

**The list.** A public JSON on the frame CDN, which the client already reads; it puts no load on Render:

```
v1/control/client_kills.json
{ "version": <int, monotone>, "updated": "<ISO>",
  "kills": { "INFOBOX_OWN_FRAME": { "off": true, "reason": "...", "run": "<url>", "at": "<ISO>" } } }
```

**Writes.**
- Only by the tester job, with the storage service key from Actions secrets (by name only; never in a file).
- Versioned and idempotent: unchanged content means no write.
- The code PR publishes an empty list (`kills: {}`) before any client reads it.

**Reads.**
- At boot, every 10 minutes, and when the tab becomes visible, with no-cache.
- A list whose `version` is lower than the last-known one is ignored (a stale cache).

**Effective flag:** build flag AND not window kill AND not fetched kill.

**Failure modes:**
- The last-known list is persisted (localStorage, with its time) and honoured through CDN gaps.
- A cold start that has no last-known list and cannot read or parse the list (unreachable, 404 or malformed) **fails
  CLOSED**: both flags read off, so the user sees today's dark display. This is SubQ's recommendation. Reflection preferred
  fail-open on a first-ever cold start; the cost asymmetry decided it: fail-closed only shows the shipped dark baseline,
  while fail-open could re-enable a known-bad flag.

**Immediacy (the advisor's nuance).** A kill must take effect at once, not "numbers correct, extra re-renders until the layer
changes":
- The fetched kill list is a store.
- `useOwnFrameValue`'s effect depends on it, so a kill unsubscribes immediately (0 re-renders after it).
- `MapMarkerLayers` re-renders once on a kill, so the glyph line falls back.
- The window kill (`__RAW_DISABLE_*__`) joins the same store, closing the gap the advisor noted on #1219.

## Acceptance (all required before the flip; each recorded in `results/client-display-tester-v1.md`)

### A1: decide() unit tests

Every branch:
- WORSE -> off, and SANITY -> off;
- INCONCLUSIVE ×1 -> keep + report;
- INCONCLUSIVE ×3 -> off;
- INCONCLUSIVE inside a PASS streak resets it;
- off then PASS ×3 -> propose_on, never on;
- per-flag independence (a glyph mismatch never kills the infobox flag).

### A2: client kill tests

- **Parsing:** valid, empty, malformed, 404, unreachable, stale version, last-known persisted.
- **Cold start:** with no last-known list, it fails closed.
- **Immediacy:** with a render-counting probe, a kill mid-session gives 0 re-renders after it; `MapMarkerLayers` re-renders
  exactly once.
- **Flag off:** with the build flag off, nothing is fetched and nothing is subscribed (behaviour-identical, as #1219).

### A3: null control

Three consecutive scheduled PASS runs on `dev`.

### A4: positive controls, each of which must fire

**How faults are injected.** Faults go into a tester-only build: `REACT_APP_TESTER_FAULTS=true` enables
`window.__RAW_TESTER_FAULT__`. Production builds never contain it, and the code PR adds a bundle check for that.

| control | seeded fault | expected verdict |
|---|---|---|
| a | infobox card +1 unit | WORSE |
| b | glyph tide +0.3 m | WORSE |
| c | card value 2000 hPa | SANITY |
| d | a card number where the frame has no data | SANITY |
| e | a request to `leak-canary.invalid`, which is listed as live for this test (it never resolves, so no load anywhere) | SANITY (LEAK) |
| f | the CDN serves a different frame than the one drawn | WORSE |
| g | the oracles disagree (a corrupted sidecar) | INCONCLUSIVE |

For a-f, decide() must write the kill to a STAGING list (`v1/control/client_kills.staging.json`). A browser client pointed at
staging (the harness sets the list URL and a 5 s test interval) must then show both of these within one fetch interval:
- the flag dropped: the old cards, or the glyph's old line;
- 0 re-renders after the kill.

### A5: the INCONCLUSIVE drill

Three seeded INCONCLUSIVE runs in a row must write `off` to staging. One or two must not.

## Unmeasured, named now

- **The live site.** The tester never reads production. A display fault that only appears on real data and not on the fixture
  is outside its reach. The fixture sets are built in the published sets' own grids and encodings to narrow that gap.
- **Terrain-corrected air temperature (GFS).** The dz asset is not in the fixture. Row 6 uses ICON, which has no correction.
- **Layers without a fixture set** (fog, rain, cloud, EURO / GFS water temp on the .om path). They are not covered; the card
  reads its old source for them unless they are drawn from our frames.
- **GPU pixels.** The card is compared with the decoded field, not with a GPU readback. The parity with the fragment shader's
  maths is pinned by `ownFrameReadout.test.js`.

## Order of work

1. This gate (docs PR).
2. The code PR: the fixture sets and sidecars, the mock, the tester job, decide() and its tests, the kill list (empty first),
   the client store and its tests.
3. A3-A5 run and recorded in `results/client-display-tester-v1.md`.
4. The flip PR (both build flags ON) under the tester, on the owner's word via the director.
