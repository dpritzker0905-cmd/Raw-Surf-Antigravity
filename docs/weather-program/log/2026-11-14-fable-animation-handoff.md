# 2026-11-14 Fable (animation lane): handoff for the overnight visual batch (02:10 EST)

Docs only. State as of writing; check `gh pr list` before acting on it. Owner, 2026-11-13 23:35 EST (relayed by the director):
"improve the fog, air temp, and water temp along with the others, so that all lanes are upgrades and instant." This lane had
the visual part and finishing precip. Everything below was measured in the offline harness, a bare page, or by a colour
checker on one machine. Nothing was checked on a real phone, in Safari or Firefox, or after a deploy.

## Where things stand
| PR | What | Kill switch | State |
|---|---|---|---|
| #873 | land file loaded in the map worker | `__RAW_DISABLE_LAND_WORKER_LOADER__` | merged |
| #881 | marine: one world copy below zoom 4 when no world edge is in view | `__RAW_DISABLE_WRAP_CULL_LOWZOOM__` | merged |
| #882 | wind: world copies from the frame's bounds | `__RAW_DISABLE_WIND_COPY_CULL__` | merged |
| #855 | rain layer can use the EURO precipitation set (client; DARK behind `__RAW_RASTER_OWN_FRAMES__ = 'rain'`) | `__RAW_DISABLE_RASTER_OWN_RAIN__` | merged |
| #892 | air temp, water temp and fog palettes; their legends computed from the drawn tables (ON) | `__RAW_DISABLE_TEMP_PALETTE__`, `__RAW_DISABLE_WATER_TEMP_PALETTE__`, `__RAW_DISABLE_FOG_PALETTE__`, `__RAW_DISABLE_RASTER_LEGENDS__` | draft; hosted checks finishing; the advisor red-teams it, the director marks it ready and merges |
| #893 | ICON precipitation downloads each run total once (223 -> 112 per run); the set stays OFF | the repo variable `FRAME_RASTER_PRECIP_ICON` | draft; same route |

Ledger lines are owed for whichever of these merge (the director's ledger batch).

## #892 for the owner's morning look: what it buys and what it costs
**What it buys (as drawn over each theme's map; `scripts/raster-color/check.mjs`):**
- Fog becomes visible in the light theme. Dense fog over land stood 1.0 from the bare map (invisible); it is 26.9 now.
- Air temperature bands stay apart for colour-blind viewers: the worst 5 C band step goes from 1.3 to 3.25.
- Water temperature gets a visible step for every degree (neighbouring degrees shared a colour before) and its lightness now
  rises with temperature all the way.
- The three legends now show the colours the map draws. Before, they were hand-written approximations.

**What it costs, or where it is not better (say no to any of these with the layer's kill switch):**
1. **The freezing line is about as readable as today, not more.** -1 C against +1 C reads 19.7-23.7; today's table reads
   23.1-24.8. Slightly under in 5 of 6 theme/surface cases.
2. **Cold against warm is less vivid in normal vision.** -10 C against +10 C reads 31-39 where today's rainbow reads 50. It is
   higher than today for every colour-blind view (24.3 against 16.3). This is the price of a blue-to-gold diverging table over
   a rainbow.
3. **The fog is a strong veil.** In the light and beach themes it is a slate grey that darkens the map; it is blocky where the
   data is coarse (the fog field is low resolution). It is legible, which was the goal; whether it is too heavy is a taste call
   nobody has made yet. Its opacity was not changed (that lives in `MapWebGL.js`).
4. **The colours are a change people will notice.** Air temp goes from a green-to-red rainbow to blue / cream / gold / red;
   water temp from the same rainbow to violet / teal / pale gold. Nothing about the values or the readouts changes.
5. **The fog legend's ticks changed** from "<1km 5km 10km 20km Clear" to "<100 m 300 m 1 km 3 km Clear", because the table ends
   at 10 km (the old bar named 20 km, a value the table never coloured).

**How far to trust the numbers:** the checker uses ONE flat colour per map surface (no labels, roads or relief), one zoom's
opacity and simulated colour blindness; the tables were tuned against those same measures over seven rounds, so they are fitted
to the instrument. The app screenshots (three themes, desktop and the phone layout) agree with it by eye; that is not a
measurement. One instrument error was found and fixed after the gates were written (the tables are step tables and were first
scored as smooth ramps); no gate line was changed, and the log has both sets of numbers
(`2026-11-14-fable-raster-palettes.md`, on #892).

## Precip
- **EURO rain (#855, merged, dark):** drawn in a browser against a real EURO set placed in the offline stand-in; dark and light
  on desktop; no fix needed. NOT exercised: the GFS stand-in past EURO's last frame, the phone layout, the beach theme. The
  director is publishing the real sets one per ingest run (temperature, then GFS rain, then EURO rain); once EURO rain is
  published, those three checks should be run against the real set before the lever is turned on.
- **ICON rain (#862 merged and off; #893 open):** before it can turn on it still needs (1) one supervised ingest run, never yet
  done in CI, for ICON's grid as well as for time; (2) a read-back of the published set; (3) a client entry and a browser run;
  (4) the owner's decision on the display difference: an area mean onto 0.25 degrees reads peaks 19-26% lower than ICON's
  native cells.
- A correction I made tonight: I first told the director an ICON run would take about 26 minutes; with the publisher's six
  threads it is nearer 4-5 minutes before #893 and about half that after. No full run has been timed.

## Hand-offs to other lanes
- **Move 3 (#889, own frames for fog / air temp / water temp):** its hook should call `rasterScaleFor(layerId, theme)` from
  `rasterPalettes.js` (agreed 00:17 EST) so a theme change cannot leave the previous theme's fog colours in place. My tables'
  stops sit on its lookup steps (0.5 C, 31.25 m); no lookup constant needs to change. The hour-to-hour blend for fog and water
  temp arrives with its sets; there is no separate PR for it from this lane.

## Open on this lane (none started)
1. The three #855 checks against the real EURO set, when it is published.
2. The empty-sample fault in `scn_wind_world_copies.js` (one view returned no timer samples in one load): drain the query
   queue before a view's window and print per-view sample counts.
3. Slow page loads (the particle draw costing about double for a whole load): parked, cause not found, not shown to be ours.
4. Rain's ramp is still not theme-varied: light rain is faint over the pale sea in the light theme (seen again tonight on EURO).
5. The 10 m land file is still parsed on the page thread for the engine's own mask (the candidate named in yesterday's handoff).

## Lessons from tonight
- Know how a table is DRAWN before scoring it: a `breakpoint` scale is a step table in this stack. Scoring it as a ramp gave
  a wrong baseline for two lines.
- A legend that is typed by hand is a second source of truth; it was wrong the moment the table changed.
- Run the whole map tree before the first push, not only the suites touched: #882 failed hosted CI on a wind test that
  classifies every kill switch, which a full local run would have caught.
- When a file was reserved by another agent, read that agent's own release line before editing; the director's word was
  right, but the file it cited was not on `dev`, and it took a second look to find it in the main checkout.
