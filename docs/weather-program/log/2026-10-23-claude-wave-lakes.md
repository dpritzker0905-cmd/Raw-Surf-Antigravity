# 2026-10-23 (claude, wave-lakes session): lakes a wave model carries render as lakes

Written 2026-10-23. Branch `claude/wave-lakes`, rebased on dev `f6433615a`. Evidence: `evidence/wave-lakes-2026-10-23.json`
(offline only). Design: `docs/architecture/wave-lakes.md`. Client only. No served number changes (no SCOREBOARD row): EURO's lake
values are what #497 already stores; this PR only stops the mask from painting those lakes black. ON, kill switch
`window.__RAW_DISABLE_WAVE_LAKES__ = true`.

## Ask and conditions (lead, 2026-10-23)
Make wave-carrying lakes render as lakes. The lead's four conditions: (1) the owner approves the download of the Natural Earth
lake files; (2) a lit lake under GFS or ICON is a defect, so both mask variants are cached per bounds and swapped by reference,
an EURO->GFS toggle served from the frame store flips the variant in the same commit as the first GFS frame, and toggle-to-frame
is measured; (3) the 2-cell extrapolation must not light a lake or inland water the model does not carry; (4) evidence for the
owner (Great Lakes, Caspian, Winnipeg, Victoria, Nicaragua at world zoom and z7-9, EURO and GFS; three themes; Salton and
Okeechobee black under every model; no new per-step mask paint on the scrub).

Owner approval of the download (AskUserQuestion, this session, 2026-10-23T22:12:43Z, answered 22:13:21Z). Question: "May I
download Natural Earth lake outlines to build a small lakes file for the wave-lakes work? They are ne_10m_lakes.json (6.6 MB) and
ne_50m_lakes.json (0.9 MB), public domain, from cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson (the same source the app
already uses for its 10m land outlines)." Answer: "Yes, download both (Recommended)". Only the trimmed 95 KB asset is committed.

## What was built
`waveLakes.js` (allow-list, memoised land variant, sheltered-water release), `waveLakesShow.js` (frame-store show guard),
`maskTextureStash.js` second "variant" slot, encoder/shelter/layer wiring, `public/wave_lakes.json` built by
`scripts/build_wave_lakes.py`. Detail in the design doc.

## Findings
1. **The three-mask cycle (fixed in this PR).** Zoomed in, EURO<->GFS with lakes cycles three masks (GFS plain world, EURO world
   series page with lakes, EURO viewport with lakes) through the resident and the one-slot stash, so every toggle rebuilt one.
   z8 Lake Michigan lakes arm, `setWaveData` ms per click: before the slot `stash_swap 12, rebuild 375, 263, 251, 375`; with the
   slot `rebuild 492, stash_swap 14, 10, 7, 16, rebuild 330` (the two rebuilds are the first lake-mask build for new bounds).
   The no-lakes arm is `reuse/stash_swap` 2-26 ms throughout. Handhelds never allocate either slot (test).
2. **A silent wrong-model frame per GFS->EURO click (pre-existing, both arms, not fixed here).** z4/z4b: exactly one frame per
   GFS->EURO click whose model is the old one with no loading text in the status line (z4: 5 frames in the lakes arm and 5 in the
   no-lakes arm over 12 clicks each, 6 of them GFS->EURO; z4b: 2 and 4; none on EURO->GFS), 3-10 ms after the click (z4b probe).
   (My message to the lead of 2026-10-23 said "6 of 6 / 5 of 6" for z4: the run summary counts are 5 and 5.) Every other wrong-model frame in those windows (24-113 per click) is admitted
   by "Loading EURO Waves... still showing GFS Waves". The frame is the previous GFS 181-col resident (5 of 6 resident, 1 series).
   UNRESOLVED: whether the model chip already read EURO in that frame (mislabel) or still GFS (click-to-render latency, fine).
   Needs the chip's `aria-pressed` per frame in the probe. Separate PR after this one if it is a mislabel.
3. **EURO toggles are not store-eligible offline** (gulf_fill_mid: true in /capabilities -> `serveTimeFillAtWorld`), so GFS->EURO
   p95 is 1.0-1.3 s at z4 against 3-16 ms for EURO->GFS. This misses the 100 ms instant contract for EURO. The lead routed the fix
   to the static-frames session (publish EURO/ICON world frames with the serve-time fill applied at publish time and the fill mode
   stamped in the index).
4. **z8 request repetition (not caused by lakes).** On dev f6433615a (includes #501, the reload budget): one z8 session, 6 model
   clicks + a step, 264 s, 225 asks (103 /grid, 91 one-hour series minis, 31 series pages); 33 distinct (model, layer, bbox, hours)
   keys; the same /grid ask repeats 31x at a ~2 s median gap; the three hidden sibling layers (swell_1, swell_2, wind_waves)
   account for ~85 series asks. Handed to the GPU-frames session. Retraction: I first read the z8 "missed" clicks as a saturated
   offline box; more likely the probe's exact-frame check compares with the WORLD product id while z8 is answered with the box's
   own product. Not verified; z8 toggle-to-frame is therefore not reported.

## Measurements (offline; build of this branch; evidence file has all numbers)
- Lake pixels differing between lakes and no-lakes builds (same theme, model, view), per class: EURO lakes 0.76-0.86 (the field
  is drawn in them), GFS lakes 0.000-0.001, Salton / Okeechobee / Nicaragua controls 0.000 under EURO and GFS, land 0.000-0.012.
  Caspian and Black Sea are NE water already: unchanged by the code (sea differs by crest animation between sessions, a noise
  floor of 0.5-0.8 where the code cannot matter, so sea is not read).
- After EURO->GFS at Lake Michigan the lake pixels equal the GFS no-lakes render (0.000 differing); 0 lit-lake frames across all
  toggle runs (z4 x3, z8 x2), 0 mask paints on the click path, 0 mask paints on the scrub (michigan, 6 keys) in every arm.
- z4 toggle, EURO->GFS from the store: 3-16 ms in both arms (lakes arm p50 9 ms, no-lakes arm 9 ms); first EURO commit at new
  bounds builds the lake mask once (137-183 ms), later ones swap (4-11 ms).
- Screenshots in three themes (dark, light, beach) at world, Lake Michigan and Lake Victoria: the field fills the lake clipped to
  the shoreline (Green Bay, Victoria's bays) and nothing is added on land.
- #497's real lake nodes: all 34 carry superior/michigan/huron/erie/winnipeg/victoria (Ontario via its own 5 inland nodes), the
  Caspian and Black Sea nodes carry none (already water); Taihu, Lagoa Mirim and the Amazon at Santarem stay dark (owner call).

## Not verified / owed
- The 10 m lake outlines (`g10`) are exercised in unit tests only: the offline harness has no 10 m land (the CDN fetch is not
  served), so the screenshots use the 50 m outlines. The live read must check shore alignment with the 10 m land.
- The offline local build has no Mapbox basemap token, so the screenshots show flat land (no basemap-water overlay path): the
  z>=4.4 overlay + inland-water guard + wetland passes with a real basemap are NOT exercised by these runs.
- The chip `aria-pressed` probe (finding 2). The live read (one, with /api/health before and after) once dev deploys.
- `netlifyIconStoredTailScope.test.js` fails in my Windows test copy (it spawns bash on netlify.toml, which this diff does not
  touch); the hosted CI is the authority.
- Owed follow-ups (separate PRs, the lead knows): the empty-set client read for #514 (`sets[key].empty === true` -> pick null
  with reason 'empty', no manifest wait), and a shared boxes -> {pick, covers, window} JSON for the server port of the regional
  rule (#508).
