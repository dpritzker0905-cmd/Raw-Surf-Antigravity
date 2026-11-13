# Compact map UI review checkpoint

Verified: 2026-11-12T23:58:21Z. Owner/executor: Codex, isolated branch codex/map-controls-refinement-20261112; base ffcfe858372fc06ceadb2f7532112dc036c21b05. Unpublished local checkpoint; merge hold pending direct Claude delivery and ownership acknowledgment.

User scope: persistent LIVE MAP at the map viewport top-left; themed Search & Filters immediately below; narrower/taller infobox; smaller timeline and stable weather picker; all three themes; preserve both original backend copies and all checkpoints. Display and interaction changes only: no forecast values, tide coverage/selection semantics, model/tier/window entitlement, auth, provider settings or runtime backend changes. No served number changed.

Owned source: frontend/src/components/MapPage.js, frontend/src/components/map/MapHeader.js, frontend/src/components/map/MapExploreRail.js, frontend/src/components/map/MapExploreRail.test.js, frontend/src/components/map/MapFilterTabs.js, frontend/src/components/map/MapWeatherControls.js, frontend/src/components/map/MapWeatherControls.playback.test.js, frontend/src/components/map/TideReadout.js, frontend/src/components/map/WeatherLayerSheet.js, frontend/src/components/map/responsiveWeather.css, frontend/src/components/map/responsiveWeather.test.js, frontend/src/components/map/useMapChromeLayout.js. Generated own frontend floor fragment adds four cases and one suite. No shared floor or lint/LOC baseline edited.

## Result and review repairs

Heading stays outside Search disclosure and reading-area hiding. Search uses component theme tokens and a bounded overlay, so opening it no longer moves/squashes the weather picker. Real search suggestions remain in one scroll flow; last of eight synthetic results is reachable. First Escape closes suggestions, second closes Search and returns focus. Live status and the approximate-location prompt remain outside collapsed content. GPS callback exercised with a synthetic counter, without browser geolocation. Map selection and immersive entry close Search.

Infobox is220x254 at1440x900 versus300x238 baseline; timeline480x108 versus560x147.4; weather picker232x421.1 versus280x382.1. Paired component measurements, same synthetic tide/time: about22%,37%,9% less area respectively. Title/search default top rail92px reserve versus184px baseline. These percentages do not apply to every state. Collapsed weather exposes active layer/model, retains user choice, and has no replacement-focus theft on theme/mode changes. Layer selection keeps the mobile sheet open; Escape closes it and returns focus.

Independent actual Claude Code source reviews identified rollback geometry, hidden location prompt, search clipping, nested Escape and moving weather-picker findings. Repaired locally. Its unused-variable suggestion was wrong: mobile fallback needs immersive; regression test/lint caught the removal and it was restored. The last review found no provably blocking source defect, and asked for Search close on immersive/selection and complete legacy mobile handle rollback; both repaired after that review. Tokens and banner predicate verified against source; E2E search found no changed-selector consumer. Reviewer did not execute tests or provide coordinator acknowledgment.

## Verification and limits

Final v10:13 suites/151 tests pass, normal exit with open-handle detection. Normal production build passes; generated service-worker/build-version stamps restored byte-for-byte. ESLint ratchet passes with86 existing errors/899 warnings, zero never-zero findings and no baseline increase. LOC ratchet passes:3519 files, zero new/regressed violations, control component942 versus957 baseline. Four new cases in one suite generated through rederive_floor.py.

Browser: actual isolated components with synthetic acquisition/auth, not live authenticated MapPage/WebGL/backend acceptance. All three themes measured at1440x900,390x844,320x640,667x375,844x390; zero horizontal interactive text overflow in the final v9 matrix. Final v10 additionally repairs measured320px/root32px/text-spacing overlap: compact timeline54px; Search ends342, Details begins367 and ends422, timeline begins430. Explicit expansion keeps wheel/playback reachable and selected-time header visible; keyboard advanced wheel0to1 and the tide readout changed to1.0ft. Reading card296x284 begins208 below heading bottom192; focused tide SVG361..417 remains inside492 card bottom and below239 context bottom.

At844x390 with root32px, WCAG spacing and long synthetic details, all three themes keep heading bottom68 and reading top88; real Tab to deep action and Shift+Tab to graph reveal focus inside the scrollport. Escape restores Details focus. Earlier320px overlap evidence retained; no false pass based on horizontal checks alone. Declared duplicate/out-of-order/bad-time gaps, unavailable and503 cases show no numeric tide or curve at+2.5h; complete data restores1.8ft and curve. Default desktop light screenshot and JSON evidence are private local artifacts. Synthetic fixture intentionally produces capabilities-acquisition errors, and the503 error case adds its expected error; no clean-console claim.

Native zoom remains unqualified: fresh Chrome AX identity/URL and sole tab were verified, but native screenshot returned Claude. No native input sent; stopped that path. Owner will set200% manually; not yet confirmed. Do not transfer older native zoom acceptance to this source.

Both original rsx backend pairs and all45 archived review/native-zoom artifacts rehashed unchanged. Previous branches/commits retained; no reset, force push or deletion.

## Backend and coordination correction

#825 source3cc1e3f6 is preserved and published; run43325470681 tests synthetic mergea71c5f77, dev parent59a7fa0c, treeae728a9c. Its estate job131556711726 FAILED despite3523passes/2866skips/2289warnings,373selected/371reporting/0silent:2122connections/2121closes/1unclosed/1live worker. New site is test_social_live_auth_and_mux_failure.py::test_start_social_live_success. LiveKit repair remains valid. Codex is investigating the second DB-mocked notification path and related callers before another hosted run. Second estate acceptance is not eligible yet.

Shared handoff updated; user requested and received a concrete forwarding message. Neither delivery nor ownership acknowledgment is confirmed. Dev merge and deployment remain held.

Final program validation: 77 CI-floor/lane governance tests pass. Ledger 2,074 entries verified; docs-only audit 0 FAIL, 60 WARN, 66 NOTE. Local interpreter parity caveat retained. This is a preserved local review checkpoint, with native zoom, live-map qualification, coordinator acknowledgment and backend hosted acceptance still pending.

Final program validation: 77 CI-floor/lane governance tests pass. Ledger 2,074 entries verified; docs-only audit 0 FAIL, 60 WARN, 66 NOTE. Local interpreter parity caveat retained. This is a preserved local review checkpoint, with native zoom, live-map qualification, coordinator acknowledgment and backend hosted acceptance still pending.
