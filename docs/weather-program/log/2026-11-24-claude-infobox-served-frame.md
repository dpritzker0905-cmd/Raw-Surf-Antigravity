# 2026-11-24 (claude, infobox-honesty session): #1219 brought up to dev; D-090 says it stays dark

Branch `claude/infobox-served-frame` (#1219, findings 9 and 10; built 2026-11-23, log
`2026-11-23-claude-infobox-served-frame.md`). The director, via the lead: merge `dev` in, apply D-090, run the frontend
tests, ESLint and the build twice, check the three themes and mobile, leave it a draft, and put the design questions to
SubQ and Reflection.

## Merge

- Plain merge of `origin/dev` 8c7607d8e (no rebase, no force-push).
- Two conflicts, both lists where each side added lines at the same place. Both sides were kept:
  - `frontend/src/tests/killSwitch.inventory.test.js`: dev added `__RAW_DISABLE_RASTER_SOURCE_WORDS__` (#1246), this
    branch added its two switches;
  - `docs/weather-program/SCOREBOARD.md`: dev's rows and this branch's 2026-11-23 13:54Z row, in time order.
- No code conflicts. The auto-merged `useOwnRasterFrames.js` carries both #1246's `gridDeg` and this branch's
  `noteShownFrame`. #1149 (tide above MLLW) is still open, so the glyph's flag-off path is dev's, unchanged.
- The pre-commit LOC hook crashed printing a warning on the Windows console (cp1252). The commit was re-run with UTF-8
  output so the hook ran; it reported only pre-existing backend files near 800 lines.

## D-090 (owner, 2026-11-23): stays DARK

D-090 rule 1 says client-only fixes "count as having no replay coverage unless a client-side tester is named". There
is none:
- `flag_guardrail` watches only `runtime_flags.GUARDED` (backend) and switches a flag off by writing
  `control/flags.json`. `REACT_APP_GLYPH_TIDE_OWN` and `REACT_APP_INFOBOX_OWN_FRAME` are compiled into the bundle, and
  the client reads no manifest for them.
- Neither changes a served frame or table. They change which already-served number a card shows: the drawn raster field,
  or our tide table at the scrubbed hour. The replay scores buoy waves and surf, not raster cards or glyph tide lines.
- The backend's own tide flags are BLIND to the replay (it reads Open-Meteo tide by date; `flag_guardrail.py`'s coverage
  table).

So REPLAY, RATING and PHYSICS are all BLIND, coverage is not feasible, and both flags stay dark as built (rule 4). This
is recorded in a SCOREBOARD row dated 2026-11-24 17:45Z.

- **Panel:** SubQ and Reflection both answered "both stay DARK", with the same reasons.
- **Their risk, recorded:** a client kill cannot be pulled by the guardrail, so any later flip needs its own named
  client tester or the owner's word.

## Checks, twice (on the merged head)

**Jest** (whole tree: the path filter did not narrow the run, so it is a superset of `src/components/map` + `src/tests`):

| run | `src/components/map` | `src/tests` | whole tree | failures |
|---|---|---|---|---|
| 1 | 512 suites / 7321 tests, 0 failures | 37 / 371, 0 | 757 of 758 suites | 3 timeouts in `components/admin/AdminSupportDashboard.pagination.test.js`, under load; outside this diff, and green in run 2 |
| 2 | 512 / 7321, 0 | 37 / 371, 0 | 758 of 758 suites, 9983 of 9983 tests | none |

- **ESLint (`check_eslint.js`):** no rule over its baseline, both times.
- **Production build (flags off, the default):** passes, both times.

## Three themes and mobile (flags ON build, offline)

- **Setup:** `scn_infobox_own_frame.js` with our GFS pressure frames from the fixture CDN, `/api/weather` stubbed,
  Open-Meteo aborted, host audit ok. Point 52N 40W, 17:45-17:46Z.
- **Desktop:** in dark, light and beach the card read 989 hPa against the drawn frame's 989.2 (MATCH).
- **Phone (390 px):** in dark, light and beach the card read 985 hPa against the drawn frame's 985.0 (MATCH). The
  scripted wheel stays at hour 0 on a phone, so a different frame is shown there; the card still equals the frame on
  screen.
- **Screenshots:** the beach desktop and light phone cards read cleanly.

## The advisor's hold at 5a11e28e0, item 2: flags off was not behaviour-identical

- **The finding (via the lead).** `useOwnFrameValue`'s effect subscribed to the shown-frame, downscale and engaged events
  unconditionally. With the flag off, every frame cut therefore re-rendered the infobox while scrubbing.
- **The fix.** Inside the effect, `if (!infoboxOwnFrameEnabled()) return undefined;`. The hook call stays unconditional
  (hook order). With the flag off or the kill switch set, nothing is subscribed.
- **Tests.** Three in `ownFrameReadout.test.js` (21 in the file), using a render-counting probe fed the events the raster
  layer emits while scrubbing (a frame cut, an engagement change, a terrain correction):
  - flag OFF: 0 re-renders over three bursts;
  - kill switch set: 0 re-renders;
  - flag ON, the positive control: the same events do re-render.
- **Mutation check.** With the gate removed, the two flag-off tests fail (2 failed, 19 passed); with it restored, all 21
  pass.
- **Floor fragment:** +2 suites / +31 tests.
- **Item 1 (`MapForecastOverlay.js` is Codex-RESERVED; this PR adds 4 lines, at 799 of 800).** Not resolved here: the lead
  is taking it to David. That file is not touched further.
- **Checks, twice on the fix.**
  - Jest whole tree: 758 of 758 suites and 9986 of 9986 tests in both runs, including `src/components/map` (512 / 7324)
    and `src/tests` (37 / 371).
  - `check_eslint.js`: clean both times.
  - Production build: passes both times.
