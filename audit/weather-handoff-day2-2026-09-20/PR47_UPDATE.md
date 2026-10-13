# Proposed PR #47 update

Prepared from the current draft PR against `dev`, whose published head is `d82032f5cd5978967622721b8c9638da36a87f7d`. This file is a local publication draft; no PR metadata was changed. Record the new head before publication.

## Title

fix(weather): validate marine forecasts and preserve verification history

## Body

Masked, missing or cancelling wave inputs could become usable forecasts, raster fallback could select a guessed forecast cycle, and failed archive reads could replace retained verification history. This PR preserves valid input support, refuses unresolved forecasts through existing fallback paths, and prevents the reproduced failed-read archive replacements.

- Require finite, valid wet support when interpolating marine grids. Require usable EURO/GFS heights for direct extension, exclude unusable optional ICON inputs using the existing fallback policy, and preserve explicit calm zero. Active positive-height direction blends must have finite bearings and a resolved circular resultant. Backend point, grid and lattice paths and frontend point/grid mirrors propagate refusal; point resolution retains its labeled coarse fallback or structured no-coverage response.
- Key coastal masks by exact owned mask/bounds identity and bound that cache to 12 entries. Await and preserve provider raster metadata rather than inventing a completed manifest. Tile requests remain transparent until their authoritative time axis is available, then recover on a normal retry. The provider host is unchanged.
- Compare forecasts only against common observation timestamps and heights. Reject invalid scoring heights before observation selection, retain valid unmatched forecasts until expiry, and expose rejected or excluded counts in reports. Keep historical measurements intact and C4-SC-12 open for its remaining verification requirements.
- Distinguish missing storage objects from failed or malformed reads. Validate ledger and residual archive shapes, use create-only writes after absence, require literal acknowledged success, preflight touched scored months, and consume pending work only after scored writes succeed. Cover failed reads, misleading absence, creation conflicts, partial progress, lost acknowledgments and idempotent retries. Retention bounds are unchanged.
- Make disabled nearshore validation explicitly NOT GRADED and skip the scientific job; retain manual dispatch. Reset the existing low-FPS streak after an excluded scheduling gap, preserving its thresholds and sustained-low-FPS detection. No scientific flag or canary is activated.
- Update CI deletion floors together with their measured provenance, preserving established backend margins. Raise the frontend floor to the last verified hosted count rather than claiming the new candidate has already passed hosted CI.

### Validation

Local continuation on `codex/weather-handoff-second-check`, based on `d82032f5`:

- Full local forecast chain: **1,148 passed in 101 selected files**, three warnings, 710.85 seconds, with all production changes in place.
- Combined frontend: **2,542 tests in 259 suites passed**, including 43 new direction controls and 13 metadata controls. The three changed suites separately passed **60/60 with open-handle detection**. The full run emitted an asynchronous-exit warning; its cause remains unattributed.
- Frontend production compilation passed with warnings using direct CRACO. Governance passed **51 tests**; all **530 tracked backend test files** have an explicit lane or exclusion. Test partition, file-size/LOC checks and the frontend lint ratchet passed. Existing frontend lint debt remains **154 errors and 923 warnings**; local backend flake8 was unavailable.
- Baseline and mutation controls establish the repaired failure modes. The final frontend direction suite has **37 failures and six healthy controls passing** against `d82032f5`; disabling only the resultant cutoff fails ten cases. Backend direction and storage baseline failures and metadata decoder/hook mutations are recorded with healthy controls. These are correctness checks, not measured forecast-skill gains.

Local Python **3.14.4** and Node **24.19.0** differ from hosted CI's Python **3.12** and Node **18**. The prior published head `d82032f5` passed all 11 hosted jobs in [run 35487375744](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/35487375744): **1,912 guards / 1,022 forecast-chain / 502 estate / 2,486 frontend tests**. Its synthetic merge tree matches that head. That receipt does not validate the new candidate; exact-head hosted CI remains required after publication.

A fixed private archive replay at **2026-09-20T16:29:23Z** independently reproduces all **15 trailing-week common-observation comparisons**, with no missing or mismatched observation identities in this snapshot. Raw Surf beats persistence by **0.0546 / 0.1304 / 0.1492 m MAE** at +24/+48/+72h but trails both public references and its EURO alternate. Aggregate receipts and offline scripts are retained; raw records remain outside Git. This does not establish equivalence to the earlier historical window, a corrected scheduled verdict, statistical significance or nearshore surf-rating skill.

### Remaining limits

Keep this PR draft pending its existing integration and visual/scientific release gates. Successful concurrent read/merge/replace operations still need atomic persistence protection; these repairs are not a transaction or multiwriter solution. Mixed-support backend grids can still expose the final cell's weights in global metadata. Direction conditioning does not calibrate physical uncertainty, period semantics or shoreline/bathymetry physics. Live fallback pixels, halos, sustained rendering performance and production release remain separate validation work. The scheduling-gap reset overlaps PR #27 and does not close its sustained slowdown. Existing scored archives are not retroactively rewritten; production/main settings remain unchanged.

Evidence: `audit/weather-handoff-second-check/` for the earlier input, scoring, cache and workflow repairs, and `audit/weather-handoff-day2-2026-09-20/SUMMARY_AUDIT.md` for the current direction, raster, replay and persistence receipts.
