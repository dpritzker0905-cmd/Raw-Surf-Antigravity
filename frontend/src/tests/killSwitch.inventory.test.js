/**
 * Kill-switch inventory gate — frontend/src/tests/killSwitch.inventory.test.js
 *
 * WHAT THIS TEST DOES
 * -------------------
 * 1. Scans every production JS file in frontend/src/components/map/ at test
 *    run time for window.__RAW_DISABLE_*__ patterns.
 * 2. Asserts that every found switch is in either KILL_SWITCHES_TESTED (it has
 *    a focused Jest test proving the switch restores prior behaviour) or
 *    KILL_SWITCHES_EXEMPT (it exists but hasn't been tested yet).
 * 3. Asserts that every switch in KILL_SWITCHES_TESTED is still actually
 *    present in source — no phantom test entries.
 *
 * SHRINK-ONLY RULE
 * ----------------
 * Both sets are shrink-only:
 *   - New switches fail CI until they are added to one of the two sets.
 *     (To add a new switch: first write a kill-switch test file, then add the
 *     switch to KILL_SWITCHES_TESTED and remove it from KILL_SWITCHES_EXEMPT.
 *     If no test yet, add only to KILL_SWITCHES_EXEMPT.)
 *   - Removing a switch from KILL_SWITCHES_EXEMPT is only allowed when it has
 *     been moved to KILL_SWITCHES_TESTED (i.e., a test was written for it).
 *   - Removing a switch from KILL_SWITCHES_TESTED is only allowed when the
 *     switch itself has been removed from source.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAP_DIR = path.resolve(__dirname, '../components/map');
// Map-serving files outside components/map whose switches the map depends on (#782 accounts only, 2026-11-12).
const EXTRA_FILES = ['../lib/weatherAuthFetch.js', '../lib/weatherSession.js', '../lib/weatherRateLimit.js'].map((f) => path.resolve(__dirname, f));

/**
 * Switches that have a dedicated *.killSwitch.test.js covering them with
 * null controls.  Every entry here must appear in the source; the test fails
 * for phantom entries.  To add: write the test file first.
 */
const KILL_SWITCHES_TESTED = new Set([
  // tests/weatherAuthFetch.test.js ("kill switch: never a token, never a retry") and tests/sessionExpiredPrompt.test.js
  // ("kill switch and the auth page itself raise nothing"): #782, accounts only
  '__RAW_DISABLE_WEATHER_AUTH__',
  '__RAW_DISABLE_SESSION_PROMPT__',
  // tests/rateLimitNotice.test.js ("the kill switch: no hold, no event, no notice"): #815
  '__RAW_DISABLE_RATE_LIMIT_NOTICE__',
  // components/map/oneWayCrests.test.js (one-way crests, 2026-11-12)
  '__RAW_DISABLE_ONE_WAY_CRESTS__',
  '__RAW_DISABLE_REDUCED_MOTION_BAND__',
  // components/map/glyphAreaEstimate.test.js (O4 / CLI-3: grid-sample glyphs labelled area estimates)
  '__RAW_DISABLE_GLYPH_ESTIMATE_LABEL__',
  // components/map/truthTagLazyHash.test.js, components/map/readoutDateFormat.test.js (layer animation lane, 2026-11-11)
  '__RAW_DISABLE_TRUTH_TAG_LAZY_HASH__',
  '__RAW_DISABLE_READOUT_FORMAT_CACHE__',
  // components/map/marineHoldRunUnknown.test.js (CLI-6: a run known on one side only releases the hold)
  '__RAW_DISABLE_HOLD_RUN_UNKNOWN_RELEASE__',
  // components/map/marineGridSeries.runIdentity.test.js (CLI-7: a newer-run page evicts older-run sibling pages)
  '__RAW_DISABLE_SERIES_RUN_EVICT__',
  // marineFramePack.parity.test.js + marineFrameStoreRuntime.allLayers.test.js + filledWorldStore.test.js + staticFrames.test.js
  // ("OFF PATH: ... packs waves only again"; 2026-11-12, move 3: the GPU frame store takes every marine layer)
  '__RAW_DISABLE_FRAME_STORE_ALL_LAYERS__',
  // staticEuroSwellSets.test.js ("OFF PATH: the kill disables every EURO swell set and nothing else"; 2026-11-12, move 3)
  '__RAW_DISABLE_STATIC_EURO_SWELL__',
  // components/map/responsiveWeather.test.js
  '__RAW_DISABLE_RESPONSIVE_WEATHER__',
  // components/map/ownRasterFrames.test.js (pressure from own frames, ON 2026-11-12; the kill is the .om path)
  '__RAW_DISABLE_RASTER_OWN_PRESSURE__',
  // components/map/ownRasterFrames.test.js ("OFF PATH: its own kill wins over the lever and touches no other layer"; 2026-11-12)
  '__RAW_DISABLE_RASTER_OWN_RAIN__',
  // components/map/ownRasterLayer.test.js ("OFF PATH: the kill is the hard cut, as before"; the value blend, 2026-11-12)
  '__RAW_DISABLE_RASTER_VALUE_BLEND__',
  // components/map/landMaskSource.test.js ("OFF PATH: the kill gives the object, as before"; 2026-11-13)
  '__RAW_DISABLE_LAND_SOURCE_URL__',
  // components/map/landMaskSource.test.js ("OFF PATH: the kill never loads the script and gives the plain URL, as before"; 2026-11-13)
  '__RAW_DISABLE_LAND_WORKER_LOADER__',
  // components/map/maskCanvasUpload.test.js ("OFF PATH: the kill uploads the mask canvas itself, as before"; 2026-11-13)
  '__RAW_DISABLE_MASK_UPLOAD_COPY__',
  // components/map/windWorldCopies.test.js ("OFF PATH: the kill gives the layer's old offsets, as before"; 2026-11-13)
  '__RAW_DISABLE_WIND_COPY_CULL__',
  // components/map/worldWrapCull.test.js ("OFF PATH: __RAW_DISABLE_WRAP_CULL_LOWZOOM__ wraps every view below zoom 4, as before ..."; 2026-11-13)
  '__RAW_DISABLE_WRAP_CULL_LOWZOOM__',
  // components/map/radarAdvectWorker.test.js (the nowcast warp in a worker; the kill runs the main-thread warp + PNG)
  '__RAW_DISABLE_RADAR_ADVECT_WORKER__',
  // components/map/radarRecolorWorker.test.js (HRRR / DWD / lightning tiles in the worker; the kill is the main-thread recolor)
  '__RAW_DISABLE_RADAR_RECOLOR_WORKER__',
  // tests/forecast-card-swell-vs-surf.test.js (CMP-4)
  '__RAW_DISABLE_UNKNOWN_DEPTH_HIDE__',
  // components/map/marineUnpatchedMaskHold.test.js
  '__RAW_DISABLE_UNPATCHED_MASK_HOLD__',
  '__RAW_DISABLE_UNRESOLVED_DIRECTION__',
  // components/map/marineFinerResidentHold.test.js
  '__RAW_DISABLE_FINER_RESIDENT_HOLD__',
  '__RAW_DISABLE_LANE_SWITCH_REGIONAL_FIRST__',
  // components/map/marineWorldOverRegionalHold.test.js
  '__RAW_DISABLE_WORLD_OVER_REGIONAL_HOLD__',
  // components/map/marineHoldOnError.test.js
  '__RAW_DISABLE_MARINE_HOLD_ON_ERROR__',
  // cadenceStep.test.js
  '__RAW_DISABLE_CADENCE_STEP__',
  // components/map/TideReadout.test.js
  '__RAW_DISABLE_INFOBOX_TIDE__',
  // hudResidentTruth.test.js
  '__RAW_DISABLE_HUD_RESIDENT_TRUTH__',
  // marineSeriesFrame.killSwitch.test.js
  '__RAW_DISABLE_SERIES_MINT_STAGE__',
  '__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__',
  // useSpotRatings.killSwitch.test.js (via ratingsShallowEqual mechanism)
  '__RAW_DISABLE_RATINGS_STABLE_MEMO__',
  // marineCalmWashHold.test.js (via CALM_WASH_HOLD_KILL constant)
  '__RAW_DISABLE_CALM_WASH_HOLD__',
  // marineController.globalSeriesPrewarm.test.js
  '__RAW_DISABLE_GLOBAL_SERIES_PREWARM__',
  // Added to source by #674 (weather batch 1), each with a focused test that sets the switch and asserts the prior
  // behaviour; recorded here when #678's inventory met #674 in weather batch 2 (2026-11-02):
  // marineColdPreview.test.js ("__RAW_DISABLE_COLD_PREVIEW__ hides the field exactly as before")
  '__RAW_DISABLE_COLD_PREVIEW__',
  // staticRegionalPrewarm.test.js ("nothing at all behind any of the three kill switches")
  '__RAW_DISABLE_REGIONAL_PREWARM__',
  // marineColdVeil.test.js (describeColdVeil with the switch set returns null)
  '__RAW_DISABLE_VEIL_WORDS__',
  // windTimeBlend.test.js and forecastReadout.windBlend.test.js ("killed: +1 h reads the snapped 00Z frame, as before")
  '__RAW_DISABLE_WIND_TIME_BLEND__',
  // Added to source by #672 (rated CDN frames, D-057), with its focused test; recorded in weather batch 2:
  // staticRatingFrames.test.js ("a surf ask is never static while killed (the /grid path)")
  '__RAW_DISABLE_RATING_FRAMES__',
  // Added to source by #673 (EURO/ICON regional z7-9 bundles, D-059), with its focused test; recorded in weather batch 2:
  // staticRegional.euroIcon.test.js ("the kill leaves no EURO/ICON set key and no pick; GFS unchanged")
  '__RAW_DISABLE_REGIONAL_EURO_ICON__',
  // Spot-hub phase 1 (2026-11-03), with its focused tests: SpotHub.phase1.test.js ("kill switch restores the previous
  // hub"), SpotConditions.phase1.test.js ("kill switch: the old source lines") and spot-hub/spotHubP1.test.js
  // (the infobox Tide row and the explore card's server count).
  '__RAW_DISABLE_SPOT_HUB_P1__',
  // Map motion fixes (2026-11-03, ON with a kill each). motionFixes.killSwitch.test.js: set before load, the four shader kills draw
  // origin/dev's ADVECT_FS / DRAW_VS byte for byte (hash-pinned); set live, each kill's uniforms or encoder return the old behaviour.
  // Plus particleState.test.js, particleRk2.test.js, crestLocalPhase.test.js, crestTexelRank.test.js and windEncoderRound.test.js.
  '__RAW_DISABLE_FLOAT_PARTICLE_STATE__',
  '__RAW_DISABLE_RK2_ADVECTION__',
  '__RAW_DISABLE_CREST_LOCAL_PHASE__',
  '__RAW_DISABLE_CREST_TEXEL_RANK__',
  '__RAW_DISABLE_WIND_ENCODER_ROUND__',
  // Map-clear self-capture recorder (#744, opt-in diagnostics, no served number). marineClearRecorder.test.js:
  // the switch beats both ?diag=1 and window.__RAW_SOAK_RECORDER__ (isSoakRecorderEnabled returns false).
  '__RAW_DISABLE_SOAK_RECORDER__',
  // O6 static-frame signer (2026-11-11). staticFrameSigner.test.js: with the switch set no /frame-urls call is made and the
  // paid hours stay unbuilt (-> /grid, the pre-O6 path); the same index without it is signed (null control).
  '__RAW_DISABLE_FRAME_SIGNER__',
]);

/**
 * Switches that exist in source but do not yet have a kill-switch test.
 * This list is SHRINK-ONLY.  Entries move to KILL_SWITCHES_TESTED when a
 * test is written; never grow this list after its initial commit.
 *
 * (415 total found 2026-11-01; 5 in TESTED; 410 here.)
 */
const KILL_SWITCHES_EXEMPT = new Set([
  '__RAW_DISABLE_ABORT_LOG_DOWNGRADE__',
  '__RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__',
  '__RAW_DISABLE_ADV_TEARDOWN_SKIP__',
  '__RAW_DISABLE_ANIM_PHYS__',
  '__RAW_DISABLE_ARBITER_SHADOW__',
  '__RAW_DISABLE_ASYNC_SHADER_COMPILE__',
  '__RAW_DISABLE_ATOMIC_COARSE_BASE__',
  '__RAW_DISABLE_BAND_BUTTON_SYNC__',
  '__RAW_DISABLE_BAND_COVER_FADE__',
  '__RAW_DISABLE_BAND_EDGE_FADE__',
  '__RAW_DISABLE_BAND_OFF_INSTANT__',
  '__RAW_DISABLE_BAND_RES_FADE__',
  '__RAW_DISABLE_BAND_WASH_UNDAMP__',
  '__RAW_DISABLE_BASE_AWARE_BRIDGE__',
  '__RAW_DISABLE_BASE_CRISP_MASK__',
  '__RAW_DISABLE_BASE_HOLD__',
  '__RAW_DISABLE_BASE_HOUR_SYNC__',
  '__RAW_DISABLE_BBOX_NORM__',
  '__RAW_DISABLE_BEACH_CREST_LIFT__',
  '__RAW_DISABLE_BEACH_CREST_V2__',
  '__RAW_DISABLE_BLEND_BOTH__',
  '__RAW_DISABLE_BLEND_SERVED_TIME__',
  '__RAW_DISABLE_BRIDGE_MULT_REALIGN__',
  '__RAW_DISABLE_BRIDGE_WASH_UNDAMP__',
  '__RAW_DISABLE_CLAMP_SEEN_SIGS__',
  '__RAW_DISABLE_CLAMP_SOFTEN__',
  '__RAW_DISABLE_CLEAR_HOLD__',
  '__RAW_DISABLE_CLIP_COVER_RELEASE__',
  '__RAW_DISABLE_COARSE_BASE_LRU__',
  '__RAW_DISABLE_COARSE_BASE_TIME_KEY__',
  '__RAW_DISABLE_COARSE_BRIDGE__',
  '__RAW_DISABLE_COARSE_CREST_SUPPRESS__',
  '__RAW_DISABLE_COARSE_FADE__',
  '__RAW_DISABLE_COARSE_GRID_WORDS__',
  '__RAW_DISABLE_COARSE_MASK_CACHE__',
  '__RAW_DISABLE_COAST_SDF__',
  '__RAW_DISABLE_COLD_COARSE_VEIL__',
  '__RAW_DISABLE_COMMIT_SHORT_CIRCUIT__',
  '__RAW_DISABLE_CONFORM_IS_VALID__',
  '__RAW_DISABLE_COVERING_CLIP_HOLD__',
  '__RAW_DISABLE_COVER_FRAC_ALIGN__',
  '__RAW_DISABLE_CREST_DENSITY_ZOOM__',
  '__RAW_DISABLE_CREST_DIAG_DEDUP__',
  '__RAW_DISABLE_CREST_FEATHER_CAP__',
  '__RAW_DISABLE_CREST_RINGFILL__',
  '__RAW_DISABLE_CROP_AHEAD_RUN__',
  '__RAW_DISABLE_DAMP_MOTION_HOLD__',
  '__RAW_DISABLE_DARK_STORM_CREST__',
  '__RAW_DISABLE_DEAD_EDGE_TRIM__',
  '__RAW_DISABLE_DEFERRED_SHADER_STATUS__',
  '__RAW_DISABLE_DEGRADED_OVERLAY_DROP__',
  '__RAW_DISABLE_DENSEBASE_WASH_UNDAMP__',
  '__RAW_DISABLE_DENSE_BASE_NO_REPLACE__',
  '__RAW_DISABLE_DIRECT_READ_WORDS__',
  '__RAW_DISABLE_DIR_CONFIDENCE__',
  '__RAW_DISABLE_DIR_DILATION__',
  '__RAW_DISABLE_DPR_SYNC__',
  '__RAW_DISABLE_DRAWN_DATED_LABEL__',
  '__RAW_DISABLE_DRAWN_ENGINE_TRUTH__',
  '__RAW_DISABLE_DRAWN_ESTIMATE_WORDS__',
  '__RAW_DISABLE_DRAWN_FALLBACK_TRUTH__',
  '__RAW_DISABLE_DRAWN_FRAME_READOUT__',
  '__RAW_DISABLE_DRAWN_HELD_WORDS__',
  '__RAW_DISABLE_DRAWN_HOLD_REASON__',
  '__RAW_DISABLE_DRAWN_HOLD_WORDS__',
  '__RAW_DISABLE_DRAWN_LABEL_INSTANT__',
  '__RAW_DISABLE_DRAWN_NOTHING_TRUTH__',
  '__RAW_DISABLE_DRAWN_SERVED_TIME__',
  '__RAW_DISABLE_DRAWN_STALE_BADGE__',
  '__RAW_DISABLE_ENDPOINT_LAND_FADE__',
  '__RAW_DISABLE_ESCAPED_MASK_REBUILD__',
  '__RAW_DISABLE_EURO_DISPLAY_NAME__',
  '__RAW_DISABLE_EXACT_REGIONAL_RULE__',
  '__RAW_DISABLE_EXACT_UPGRADE_SKIP__',
  '__RAW_DISABLE_EXACT_UPGRADE__',
  '__RAW_DISABLE_FAST_LAND_MASK__',
  '__RAW_DISABLE_FBO_STATUS_CACHE__',
  '__RAW_DISABLE_FETCH_PRIORITY__',
  '__RAW_DISABLE_FILLED_INDEX_PRELOAD__',
  '__RAW_DISABLE_FILLED_WORLD_STORE__',
  '__RAW_DISABLE_FINE_SEAM_FLOOR__',
  '__RAW_DISABLE_FIXED_HEIGHT_DECIMALS__',
  '__RAW_DISABLE_FLAT_HEATMAP_OPACITY__',
  '__RAW_DISABLE_FLAVOR_BACKSTOP__',
  '__RAW_DISABLE_FLAVOR_CACHE_FASTPATH__',
  '__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__',
  '__RAW_DISABLE_FLAVOR_TOGGLE_VIEWPORT__',
  '__RAW_DISABLE_FORECAST_STATE_IDENTITY__',
  '__RAW_DISABLE_FRAME_AUX_SHOW__',
  '__RAW_DISABLE_FRAME_IDLE_FILL__',
  '__RAW_DISABLE_FRAME_MODEL_TOGGLE__',
  '__RAW_DISABLE_FRAME_PREFETCH__',
  '__RAW_DISABLE_FRAME_STASH_SUPERSEDE__',
  '__RAW_DISABLE_FRAME_STORE_CROP__',
  '__RAW_DISABLE_FRAME_STORE_GPU__',
  '__RAW_DISABLE_FRAME_STORE_REGIONAL__',
  '__RAW_DISABLE_FRAME_STORE__',
  '__RAW_DISABLE_FRAME_VALIDITY_TOLERANCE__',
  '__RAW_DISABLE_GEOFENCE_MINZOOM__',
  '__RAW_DISABLE_GFS_EXACT_PLAYBACK__',
  '__RAW_DISABLE_GLOBAL_TILE_ALIAS__',
  '__RAW_DISABLE_GL_STATE_SHADOW__',
  '__RAW_DISABLE_GRID_INSTANT_KEY__',
  '__RAW_DISABLE_GRID_POINT_REG__',
  '__RAW_DISABLE_GUARDRAIL_BLANK_GUARD__',
  '__RAW_DISABLE_GUARDRAIL_MAIN_THREAD__',
  '__RAW_DISABLE_GUARDRAIL_RENDER_EVIDENCE__',
  '__RAW_DISABLE_GUARDRAIL_THROTTLE_CADENCE__',
  '__RAW_DISABLE_HALO_DAMP__',
  '__RAW_DISABLE_HEATMAP_BOUNDS_GATE__',
  '__RAW_DISABLE_HOLD_NO_DIM__',
  '__RAW_DISABLE_HOUR0_FIRST__',
  '__RAW_DISABLE_HOUR_BY_INSTANT__',
  '__RAW_DISABLE_HOUR_WORLD_WARM__',
  '__RAW_DISABLE_ICON_FAR_HOUR_RENDER__',
  '__RAW_DISABLE_ICON_POINT_STORED_TAIL__',
  '__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__',
  '__RAW_DISABLE_ICON_TAIL_CONTINUITY__',
  '__RAW_DISABLE_INFOBOX_FRAME_WORDS__',
  '__RAW_DISABLE_INFOBOX_RATING_TIME__',
  '__RAW_DISABLE_INFOBOX_UTC_HOURS__',
  '__RAW_DISABLE_INLAND_ORDER_PIN__',
  '__RAW_DISABLE_INLAND_WATER_GUARD__',
  '__RAW_DISABLE_INSTANT_COMMIT_LASTLAYER__',
  '__RAW_DISABLE_INTL_FORMAT_CACHE__',
  '__RAW_DISABLE_ISLAND_HALO_DAMP__',
  '__RAW_DISABLE_ISLAND_REASSERT__',
  '__RAW_DISABLE_ISOBAR_DARK_INK_V2__',
  '__RAW_DISABLE_LAND_AWARE_FETCH__',
  '__RAW_DISABLE_LATTICE_BY_LAYER__',
  '__RAW_DISABLE_LATTICE_MODEL_STEP__',
  '__RAW_DISABLE_LAYER_DATA_CREDIT__',
  '__RAW_DISABLE_LIGHT_CREST_CROSS__',
  '__RAW_DISABLE_LIGHT_CREST_RESTORE__',
  '__RAW_DISABLE_LIGHT_CREST_STYLE__',
  '__RAW_DISABLE_LIGHT_CREST_V2__',
  '__RAW_DISABLE_LOCK_LIVE_EXTEND__',
  '__RAW_DISABLE_LOWH_CREST_CONTRAST__',
  '__RAW_DISABLE_LOWWIND_LEGIBILITY__',
  '__RAW_DISABLE_MAIN_THREAD_TIMING__',
  '__RAW_DISABLE_MANIFEST_TILE_CLIP__',
  '__RAW_DISABLE_MANIFEST_TIME_INDEX__',
  '__RAW_DISABLE_MARINE_ARBITER__',
  '__RAW_DISABLE_MARINE_COALESCE_LIVE_HOUR__',
  '__RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__',
  '__RAW_DISABLE_MARINE_EMPTY_GRACE__',
  '__RAW_DISABLE_MARINE_ERROR_IDENTITY__',
  '__RAW_DISABLE_MARINE_PHASE_TIMING__',
  '__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__',
  '__RAW_DISABLE_MARINE_SERIES_CACHE_BOUNDS__',
  '__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__',
  '__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__',
  '__RAW_DISABLE_MARINE_STRAND_WATCHDOG__',
  '__RAW_DISABLE_MARINE_TINYTILE_FADE__',
  '__RAW_DISABLE_MARINE_VALUE_VALIDITY__',
  '__RAW_DISABLE_MARINE_WARM_COVERAGE__',
  '__RAW_DISABLE_MARINE_WAVE_PALETTE__',
  '__RAW_DISABLE_MARINE_WIND_HOUROFFSET_MEMO__',
  '__RAW_DISABLE_MARKER_WEDGE_HEAL__',
  '__RAW_DISABLE_MASK_CANVAS_CACHE__',
  '__RAW_DISABLE_MASK_COVER_REUSE__',
  '__RAW_DISABLE_MASK_DELIVERED_COVER__',
  '__RAW_DISABLE_MASK_FAMILY_ORDER__',
  '__RAW_DISABLE_MASK_MAP_GONE_GUARD__',
  '__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__',
  '__RAW_DISABLE_MASK_NO_DOWNGRADE__',
  '__RAW_DISABLE_MASK_NO_SHRINK__',
  '__RAW_DISABLE_MASK_PATCH_CARRY__',
  '__RAW_DISABLE_MASK_PATCH_KEEP__',
  '__RAW_DISABLE_MASK_READONLY_CANVAS__',
  '__RAW_DISABLE_MASK_RETAIN_UPGRADE_GUARD__',
  '__RAW_DISABLE_MASK_RETAIN__',
  '__RAW_DISABLE_MASK_RING_UNWRAP__',
  '__RAW_DISABLE_MASK_SHORT_CLIP__',
  '__RAW_DISABLE_MASK_SOURCEDATA_REDRIVE__',
  '__RAW_DISABLE_MASK_STASH_VARIANT__',
  '__RAW_DISABLE_MASK_STASH__',
  '__RAW_DISABLE_MIDBAND_BRIDGE_CEIL__',
  '__RAW_DISABLE_MIDCARVE_REPLACE__',
  '__RAW_DISABLE_MIDGESTURE_MASK_REBUILD__',
  '__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__',
  '__RAW_DISABLE_MID_CEILING_SNAP__',
  '__RAW_DISABLE_MOTION_COARSE_PROMOTE__',
  '__RAW_DISABLE_NARROW_WATER__',
  '__RAW_DISABLE_NONCOVERING_OVERLAY_DROP__',
  '__RAW_DISABLE_NO_DOWNGRADE__',
  '__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__',
  '__RAW_DISABLE_OFFSET_CACHE_ROLL__',
  '__RAW_DISABLE_ONE_INSTANT_RANGE__',
  '__RAW_DISABLE_OPENWATER_PLAUSIBILITY__',
  '__RAW_DISABLE_OVERLAY_COVERAGE_REPLACE__',
  '__RAW_DISABLE_OVERLAY_TRUTH_GATE__',
  '__RAW_DISABLE_OVERSIZE__',
  '__RAW_DISABLE_PARITY_IDENTITY__',
  '__RAW_DISABLE_PARITY_REPUBLISH__',
  '__RAW_DISABLE_PARITY_VERDICT__',
  '__RAW_DISABLE_PARTICLE_CARRY__',
  '__RAW_DISABLE_PARTICLE_LNG_WRAP__',
  '__RAW_DISABLE_PERIOD_GATE__',
  '__RAW_DISABLE_PINGPONG_GUARD__',
  '__RAW_DISABLE_PLAIN_SET_CROPS__',
  '__RAW_DISABLE_POINT_MODEL_GUARD__',
  '__RAW_DISABLE_POINT_REQUEST_IDENTITY__',
  '__RAW_DISABLE_PRODUCTS_COMPACT__',
  '__RAW_DISABLE_PRODUCTS_SHARE__',
  '__RAW_DISABLE_PROPORTIONAL_WAVE_SETS__',
  '__RAW_DISABLE_QUIET_SEED__',
  '__RAW_DISABLE_RADAR_FRAME_HOLD__',
  '__RAW_DISABLE_RASTER_DIRECTIONAL_NEIGHBOUR__',
  '__RAW_DISABLE_RASTER_DRAWN_READOUT__',
  '__RAW_DISABLE_RASTER_HARD_CUT__',
  '__RAW_DISABLE_RASTER_INSTANT_FLIP__',
  '__RAW_DISABLE_RASTER_ISOBARS__',
  '__RAW_DISABLE_RASTER_OWN_FRAMES__',
  '__RAW_DISABLE_RASTER_OWN_PREWARM__',
  '__RAW_DISABLE_RASTER_OWN_SATELLITE__',
  '__RAW_DISABLE_RASTER_OWN_TEMPERATURE__',
  '__RAW_DISABLE_RASTER_TEMP_DOWNSCALE__',
  '__RAW_DISABLE_RASTER_TOGGLE_RETAIN__',
  '__RAW_DISABLE_RASTER_WORK_BOUNDS__',
  '__RAW_DISABLE_RATINGS_CDN__',
  '__RAW_DISABLE_RATINGS_SKIP_BEYOND_BOUND__',
  '__RAW_DISABLE_RATING_GRACE__',
  '__RAW_DISABLE_REGIONAL_BUNDLES__',
  '__RAW_DISABLE_REGIONAL_FULL_PAGE__',
  '__RAW_DISABLE_REGIONAL_MANIFEST_WAIT__',
  '__RAW_DISABLE_REGIONAL_PILOT_FALLBACK__',
  '__RAW_DISABLE_REJECT_WORLD_ASK__',
  '__RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__',
  '__RAW_DISABLE_REQUEST_DIET__',
  '__RAW_DISABLE_REQUEST_TILE_ALIAS__',
  '__RAW_DISABLE_RESIDENT_FRAME_DIAGNOSTICS__',
  '__RAW_DISABLE_RES_WATCH__',
  '__RAW_DISABLE_RING_READER__',
  '__RAW_DISABLE_RUM__',
  '__RAW_DISABLE_SAFECACHE_GLOBAL_SKIP__',
  '__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__',
  '__RAW_DISABLE_SERIES_ABORT_GUARD__',
  '__RAW_DISABLE_SERIES_CONTAIN_REUSE__',
  '__RAW_DISABLE_SERIES_FINER_ENTRY__',
  '__RAW_DISABLE_SERIES_LOW_PRIORITY__',
  '__RAW_DISABLE_SERIES_PAINT_WHILE_PENDING__',
  '__RAW_DISABLE_SERIES_PAN_DEBOUNCE__',
  '__RAW_DISABLE_SERIES_PAN_SUPERSEDE__',
  '__RAW_DISABLE_SERIES_PREWARM__',
  '__RAW_DISABLE_SERIES_REQUEST_SNAP__',
  '__RAW_DISABLE_SETTLE_ARM_ON_ACTIVATE__',
  '__RAW_DISABLE_SETTLE_LIVE_MAP__',
  '__RAW_DISABLE_SETTLE_RELOAD_GUARD__',
  '__RAW_DISABLE_SETTLE_RELOAD_PAGE_KEY__',
  '__RAW_DISABLE_SHARPEN_OPACITY_EASE__',
  '__RAW_DISABLE_SHELTERED_WATER__',
  '__RAW_DISABLE_SHELTER_CACHE__',
  '__RAW_DISABLE_SIBLING_ASK_ONCE__',
  '__RAW_DISABLE_SIBLING_IDLE_PAGES__',
  '__RAW_DISABLE_SIBLING_SURF_GATE__',
  '__RAW_DISABLE_SIBLING_WARM_ON_SERIES__',
  '__RAW_DISABLE_SIM_FIELD_DEFER__',
  '__RAW_DISABLE_SPECTRUM_CREST_LIFT__',
  '__RAW_DISABLE_STALE_HOUR_DIM__',
  '__RAW_DISABLE_STALE_RESIDENT_SWAP__',
  '__RAW_DISABLE_STASH_PATCH_TRUST__',
  '__RAW_DISABLE_STATIC_FILLED_WORLD__',
  '__RAW_DISABLE_STATIC_FRAMES_PREWARM__',
  '__RAW_DISABLE_STATIC_FRAMES_SETS__',
  '__RAW_DISABLE_STATIC_FRAMES__',
  '__RAW_DISABLE_STATIC_MID_CROP__',
  '__RAW_DISABLE_STATIC_SERIES_ALL_SETS__',
  '__RAW_DISABLE_STATIC_WORLD_FILL_GUARD__',
  '__RAW_DISABLE_STEP_PAGE__',
  '__RAW_DISABLE_STORE_SHOW_RESYNC__',
  '__RAW_DISABLE_STRADDLE_GUARD__',
  '__RAW_DISABLE_STRADDLE_TILE_CLIP__',
  '__RAW_DISABLE_STYLE_READY_FALLBACK__',
  '__RAW_DISABLE_SUBCOVER_REJECT__',
  '__RAW_DISABLE_SU_NO_CANCEL__',
  '__RAW_DISABLE_SWITCH_HOLD__',
  '__RAW_DISABLE_SWR_BACKOFF__',
  '__RAW_DISABLE_SWR_KEY_LADDER__',
  '__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__',
  '__RAW_DISABLE_THEMED_PARTICLE_RIM__',
  '__RAW_DISABLE_TIDE_FALLBACK__',
  '__RAW_DISABLE_TIGHTEST_CONTAINED__',
  '__RAW_DISABLE_TIGHT_RESHARPEN__',
  '__RAW_DISABLE_TILE_BACKOFF_ZOOMGATE__',
  '__RAW_DISABLE_TILE_VP_CLAMP__',
  '__RAW_DISABLE_TRUTH_DIFF_AFTER_PAINT__',
  '__RAW_DISABLE_TRUTH_TAG_LAZY_CENSUS__',
  '__RAW_DISABLE_UNIFORM_CACHE__',
  '__RAW_DISABLE_VEIL_NEVER_HID__',
  '__RAW_DISABLE_WASH_CDN_FIRST__',
  '__RAW_DISABLE_WASH_NO_REPLACE__',
  '__RAW_DISABLE_WASH_REFUSAL_WARM__',
  '__RAW_DISABLE_WASH_TIME_MATCH__',
  '__RAW_DISABLE_WAVE_BEACH_V1__',
  '__RAW_DISABLE_WAVE_HEIGHT_16M__',
  '__RAW_DISABLE_WAVE_LAKES__',
  '__RAW_DISABLE_WAVE_PALETTE_V2__',
  '__RAW_DISABLE_WAVE_SPECTRUM__',
  '__RAW_DISABLE_WETLAND_DILATE__',
  '__RAW_DISABLE_WHEEL_DRAG_COMMIT__',
  '__RAW_DISABLE_WHEEL_FINISH_ON_CANCEL__',
  '__RAW_DISABLE_WHEEL_RELEASE_DECAY__',
  '__RAW_DISABLE_WIND_ABORT_REJECTS__',
  '__RAW_DISABLE_WIND_BASEMAP_MUTE__',
  '__RAW_DISABLE_WIND_BASE_FIRST__',
  '__RAW_DISABLE_WIND_BASE_LANE_WIDE__',
  '__RAW_DISABLE_WIND_BASE_OVERLAY__',
  '__RAW_DISABLE_WIND_BEACH_CVD__',
  '__RAW_DISABLE_WIND_BEACH_PATH__',
  '__RAW_DISABLE_WIND_BORDER_INK__',
  '__RAW_DISABLE_WIND_CALIBRATION_V2__',
  '__RAW_DISABLE_WIND_CALM_AIR__',
  '__RAW_DISABLE_WIND_CALM_ALPHA_V3__',
  '__RAW_DISABLE_WIND_CALM_CLEAR__',
  '__RAW_DISABLE_WIND_CALM_MARKS__',
  '__RAW_DISABLE_WIND_CLIP_KEEP_FINE__',
  '__RAW_DISABLE_WIND_CLOSEZOOM_DENSITY__',
  '__RAW_DISABLE_WIND_CLOSEZOOM_INK__',
  '__RAW_DISABLE_WIND_CLOSE_LAND__',
  '__RAW_DISABLE_WIND_CLOSE_THIN__',
  '__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__',
  '__RAW_DISABLE_WIND_COASTLINE__',
  '__RAW_DISABLE_WIND_COAST_INK__',
  '__RAW_DISABLE_WIND_COMMIT_NOOP__',
  '__RAW_DISABLE_WIND_DARK_CVD__',
  '__RAW_DISABLE_WIND_DARK_RULES__',
  '__RAW_DISABLE_WIND_DARK_WHITE__',
  '__RAW_DISABLE_WIND_DASH__',
  '__RAW_DISABLE_WIND_DELIVERY_COALESCE__',
  '__RAW_DISABLE_WIND_DELIVERY_QUEUE__',
  '__RAW_DISABLE_WIND_DENSITY_UNIFORM__',
  '__RAW_DISABLE_WIND_DENSITY_V2__',
  '__RAW_DISABLE_WIND_DRAWN_READOUT__',
  '__RAW_DISABLE_WIND_FIELD_LUT__',
  '__RAW_DISABLE_WIND_FIELD_RAMP__',
  '__RAW_DISABLE_WIND_FIELD_TINT__',
  '__RAW_DISABLE_WIND_FINE_CONTAIN_GUARD__',
  '__RAW_DISABLE_WIND_FINE_WIDE__',
  '__RAW_DISABLE_WIND_FIXED_CASING__',
  '__RAW_DISABLE_WIND_FIXED_SPEED_REF__',
  '__RAW_DISABLE_WIND_FRAME_HASH_SEED__',
  '__RAW_DISABLE_WIND_GATE__',
  '__RAW_DISABLE_WIND_GLOW__',
  '__RAW_DISABLE_WIND_GRID_RESPONSE_CACHE__',
  '__RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__',
  '__RAW_DISABLE_WIND_HRRR_LANE__',
  '__RAW_DISABLE_WIND_HUE_PATH__',
  '__RAW_DISABLE_WIND_INK__',
  '__RAW_DISABLE_WIND_INSTANT_STEP__',
  '__RAW_DISABLE_WIND_LAND_DEPTH__',
  '__RAW_DISABLE_WIND_LAND_STEP__',
  '__RAW_DISABLE_WIND_LANE_REBUILT_INDEX__',
  '__RAW_DISABLE_WIND_LIGHT_CVD__',
  '__RAW_DISABLE_WIND_LIGHT_FASTBAND__',
  '__RAW_DISABLE_WIND_LIGHT_LOOK__',
  '__RAW_DISABLE_WIND_LIGHT_LOWBAND__',
  '__RAW_DISABLE_WIND_LIGHT_NEUTRAL_CVD__',
  '__RAW_DISABLE_WIND_LIGHT_PATH__',
  '__RAW_DISABLE_WIND_LOWBAND_RESPREAD__',
  '__RAW_DISABLE_WIND_MIDBAND_REFINE__',
  '__RAW_DISABLE_WIND_MOTION_FLOOR__',
  '__RAW_DISABLE_WIND_OPAQUE_CANVAS__',
  '__RAW_DISABLE_WIND_OVERLAY_KEEP__',
  '__RAW_DISABLE_WIND_PREBUILD__',
  '__RAW_DISABLE_WIND_PREFETCH_REPLAN_AFTER_PAINT__',
  '__RAW_DISABLE_WIND_PREFETCH__',
  '__RAW_DISABLE_WIND_PRIMARY_HOUR_GUARD__',
  '__RAW_DISABLE_WIND_REASK_DEDUPE__',
  '__RAW_DISABLE_WIND_RESPAWN_LNG_WRAP__',
  '__RAW_DISABLE_WIND_SAME_TARGET_JOIN__',
  '__RAW_DISABLE_WIND_SCRUB_BASE_LANE__',
  '__RAW_DISABLE_WIND_SCRUB_END_SETTLE__',
  '__RAW_DISABLE_WIND_SCRUB_GATE__',
  '__RAW_DISABLE_WIND_SERIES_AFTER_PAINT__',
  '__RAW_DISABLE_WIND_SERIES_MANIFEST_SNAP__',
  '__RAW_DISABLE_WIND_SERIES_STATIC_SKIP__',
  '__RAW_DISABLE_WIND_SERIES_SUPERSEDE__',
  '__RAW_DISABLE_WIND_SERIES_TRIM__',
  '__RAW_DISABLE_WIND_SIZE_MONOTONIC__',
  '__RAW_DISABLE_WIND_SPEED_GAMMA__',
  '__RAW_DISABLE_WIND_SPEED_KEEP__',
  '__RAW_DISABLE_WIND_SPEED_PREMUL__',
  '__RAW_DISABLE_WIND_STALE_COVERING__',
  '__RAW_DISABLE_WIND_STATIC_CROP__',
  '__RAW_DISABLE_WIND_STATIC_FRAMES__',
  '__RAW_DISABLE_WIND_STATIC_LANE_HOURS__',
  '__RAW_DISABLE_WIND_THEME_V2__',
  '__RAW_DISABLE_WIND_TIER_MOSAIC__',
  '__RAW_DISABLE_WIND_TRAIL_ANCHOR__',
  '__RAW_DISABLE_WIND_TRAIL_VEIL__',
  '__RAW_DISABLE_WIND_UNDER_LABELS__',
  '__RAW_DISABLE_WIND_VIEWPORT_DENSITY__',
  '__RAW_DISABLE_WIND_VIEWPORT_FINE__',
  '__RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__',
  '__RAW_DISABLE_WIND_VIEWPORT_MODEL_GUARD__',
  '__RAW_DISABLE_WIND_VORTEX_LEVERS__',
  '__RAW_DISABLE_WIND_WHITE_STREAK__',
  '__RAW_DISABLE_WIND_WIDEFADE__',
  '__RAW_DISABLE_WIND_WIDE_TRAILS__',
  '__RAW_DISABLE_WORLD_GRID_FIRST__',
  '__RAW_DISABLE_WORLD_WARM_BAND__',
  '__RAW_DISABLE_WRAP_CULL__',
  '__RAW_DISABLE_WRAP_MIRROR__',
  '__RAW_DISABLE_WT_FAST_FILL__',
  '__RAW_DISABLE_ZOOMOUT_BRIDGE__',
  '__RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__',
  '__RAW_DISABLE_ZOOMOUT_WASH_FLOOR__',
  '__RAW_DISABLE_ZOOM_REBUILD__',
]);

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scanSwitches() {
  const found = new Set();
  let files;
  try {
    files = fs.readdirSync(MAP_DIR);
  } catch (e) {
    throw new Error(`Cannot read MAP_DIR (${MAP_DIR}): ${e.message}`);
  }
  const paths = files.filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => path.join(MAP_DIR, f));
  for (const fullPath of [...paths, ...EXTRA_FILES]) {
    const text = fs.readFileSync(fullPath, 'utf8');
    // Global regex — must be recreated per file to reset lastIndex
    const re = /__RAW_DISABLE_[A-Z0-9_]+__/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      found.add(m[0]);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kill-switch inventory', () => {
  let sourceSwitches;

  beforeAll(() => {
    sourceSwitches = scanSwitches();
  });

  it('every switch in source is either TESTED or EXEMPT', () => {
    const unaccounted = [];
    for (const sw of sourceSwitches) {
      if (!KILL_SWITCHES_TESTED.has(sw) && !KILL_SWITCHES_EXEMPT.has(sw)) {
        unaccounted.push(sw);
      }
    }
    if (unaccounted.length > 0) {
      throw new Error(
        `${unaccounted.length} kill switch(es) not in TESTED or EXEMPT:\n` +
        unaccounted.sort().map(s => `  ${s}`).join('\n') +
        '\n\nFix: add to KILL_SWITCHES_EXEMPT here (shrink-only list), or write a ' +
        'kill-switch test and add to KILL_SWITCHES_TESTED.'
      );
    }
  });

  it('every switch in KILL_SWITCHES_TESTED is still in source (no phantom entries)', () => {
    const phantom = [];
    for (const sw of KILL_SWITCHES_TESTED) {
      if (!sourceSwitches.has(sw)) {
        phantom.push(sw);
      }
    }
    if (phantom.length > 0) {
      throw new Error(
        `${phantom.length} TESTED switch(es) not found in source:\n` +
        phantom.sort().map(s => `  ${s}`).join('\n') +
        '\n\nFix: remove from KILL_SWITCHES_TESTED (the switch was removed from source, ' +
        'so the test is now a phantom).'
      );
    }
  });

  it('KILL_SWITCHES_EXEMPT and KILL_SWITCHES_TESTED are disjoint', () => {
    const overlap = [...KILL_SWITCHES_TESTED].filter(sw => KILL_SWITCHES_EXEMPT.has(sw));
    expect(overlap).toEqual([]);
  });

  it('prints coverage summary (informational, always passes)', () => {
    const tested  = [...KILL_SWITCHES_TESTED].filter(sw => sourceSwitches.has(sw)).length;
    const total   = sourceSwitches.size;
    const pct     = total > 0 ? ((tested / total) * 100).toFixed(1) : '0.0';
    // Not a real assertion — just a console log for CI visibility
    console.log(
      `Kill-switch coverage: ${tested}/${total} switches tested (${pct}%). ` +
      `${total - tested} in EXEMPT (untested).`
    );
    expect(true).toBe(true);
  });
});
