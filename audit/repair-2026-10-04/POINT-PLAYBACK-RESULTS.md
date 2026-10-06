# Point identity, availability and GFS playback repairs

2026-10-04. Baseline `69c06852`, continuing PR243 on `dev`. Source `5afa0c82` is locally
and hosted qualified; this is a default-off repair batch. No merge, deployment or forecast/science flag activation.

| Finding | Repair and qualification |
| --- | --- |
| W-01 | Backend rejects advisory product hints for another model/domain. The real resolver and sampler return the requested product's2m instead of the wrong product's1m; correct hints and existing layer rejection remain. Recursive ICON child requests retain their own model/time context. |
| W-02 | Outer and adapter cache identity includes the frozen absolute request time, model/domain/layer, provider and actual transmitted product/bbox hints. Forced refresh bypasses both cache levels. Existing coordinate rounding is preserved. |
| M01 | Explicit unavailable/invalid/null sea stays unavailable through the actual EURO/GFS/ICON adapter, point selector and card compiler. Finite measured zero remains available calm/Trace. |
| M02 | EURO nearshore=false survives the adapter boundary, alongside true/null controls. |
| M03 | EURO mean swell periods no longer fill peak-period fields. Mean values remain available. |
| SH01 | Shared spot producer preserves missing current and future heights, skips quality calculation without a sea, and retains measured Flat. Full/compact/daily consumers show Unavailable without empty units. |
| SH02 | Memo compares every small rating JSON field, including nested height/period/tide/source/explanations; identical readings preserve the reference. |
| SH03 | Drawer and SpotConditions own requests by spot/model, abort on replacement/close, suppress late completions, reset stale readings and retain measured zero. Same-window model changes refresh them. |
| PB01 (owner evidence) | Wide GFS wave playback prefetches one next grid through the existing single background lane, waits for its exact model/layer/time/coverage/stride identity, holds the selected hour while buffering and preserves four-second minimum cadence. Warming cannot stage a future frame into the currently drawn bridge. Three attempts per next hour,30s apart; Pause/model change/unmount clean up; zoom into a regional view pauses this wide-view mode. The common series selector refuses thinned GFS world wave placeholders during both play and manual scrub, allowing the ordinary exact-grid path to replace the retained field. |

## Evidence and tests

- Backend W01 original15 controls:8fail/7pass before twice; extended21 pass.
- Standalone `point_jacobian_probe.py`:6 central-difference controls pass twice through the
  actual resolver/sampler. GFS/ICON/EURO height derivatives against [requested-product height,
  cross-model-hint height] change from[0,1] under the legacy dark control to[1,0] with the
  repair; epsilon0.05m, numerical error below1e-10. This measures request ownership, not
  forecast skill or transformed-surf physics. The explicit-path offline instrument is an
  audit artifact and does not alter the backend CI lane counts.
- Frontend W01/W02 original20:18fail/2pass before twice; extended26 pass.
- Availability original19:12fail/7pass before twice; extended24 pass. Producer original11:
  8fail/3pass before twice; extended12 pass. Tests bind actual producer/adapter/selector/cards.
- Consumer original18:16fail/2pass before twice; mounted all-theme drawer and full/daily,
  all four response lanes, model switch, report-refresh and abort controls added afterward.
- Playback original17:9fail/8pass before twice. One positive stride assertion was corrected
  before those two valid baseline runs (the mapper represents unthinned stride as0).
  Player, real series/prewarm/cache, rollback, lifecycle and real control tests pass. Tests
  of the picker isolate canvas2D calls; browser inspection uses the real canvas wheel.
- Final frontend:346 suites/3582 tests pass. ESLint86 existing errors/917 warnings, ratchet
  accepted; production compilation and LOC ratchet accepted. Discovery floor346/3582.
- Focused backend:171 pass including both new files, actual selection/transform/observation
  neighbors, flag parity and the paired floor contract. New files are chain-owned:617 tracked,
  181 guards/149 chain/284 estate/2 fastmcp-excluded/1 documented quarantine. Chain floor149/1945,
  paired reference1951 (= pinned hosted1918 +33 new controls). No new exclusion/skip.
- Local full backend lane crashed during collection with a Windows native access violation;
  it collected no qualifying test result. The local interpreter also reports two missing
  declared packages. Completed hosted Linux CI now supplies the full source receipt.
- Source5afa0c82 CI37226218002 completed/success: all11 jobs accepted; frontend346/3582,
  chain1951/149files (0skips), guards2288/181files (67 existing documented skips),
  estate889 (284selected/282produced/0silent):5128 backend passed,0failed. Production
  compilation, lint/import/ownership/floor gates and supplementary LOC/encoding/ledger/
  Lighthouse passed. PR rollup19:17success checkruns,1neutral and1successful preview status.
  Receipt-only changes preserve every recorded production/test/CI source fingerprint.
- Prior source d67763d5 CI37207402431 completed/success, read back with hosted guards2288
  (67 documented skips), chain1918 (no skips) and estate889 (no silent files):5095 passed.
  These counts qualify the prior source, not the new candidate.
- Browser fixture: real hook/controller cache, controls/wheel, compact/full conditions and
  theme provider. Held+0 while buffering, delivered exact fixture then selected+6. Three themes
  at desktop and390x844 phone, no horizontal overflow; screenshots saved locally. Offline
  delivery is simulated; this does **not** certify full map pixels, GPU continuity, device FPS,
  backend latency, or a deployed fix. A preview-only JSX-runtime mismatch was repaired to
  match CRA's automatic runtime before accepting the delivery replay.

## Owner recording and console forensics

Recording87.03s,2218x1552,30fps, metadata creation17:31:02Z.
Full recording hash: `19a76209848db352cb60b7b1fe4a1b2bfea7606fd429f8e0145f150795fe2934`.
Console SHA256: `07d656dead37ee0a96b677a743e9f741edc517a71d9deb9d16bd1fb2ab26352a`.
Raw owner assets and decoded frames remain local, gitignored; originals were read only.
Console94/99 reports46x20 at zoom3.5;132 reports181x82;157-160 changes46x20→181x82
while hour126/zoom3.5 remain the same. The thin/exact transition has a causal source replay;
the console contains no timestamps that align its events to exact recording frames. No
scientific accuracy claim follows from differing grid representations.

## Activation and remaining acceptance

Unset defaults preserve served behavior. Qualification flags:

- Backend `POINT_PRODUCT_IDENTITY=1`, `SURF_STRICT_AVAILABILITY=1` (registry default0;
  availability workflow parity declarations remain0).
- Client `REACT_APP_POINT_REQUEST_IDENTITY=true`, `REACT_APP_MARINE_VALUE_VALIDITY=true`,
  `REACT_APP_FORECAST_STATE_IDENTITY=true`, `REACT_APP_GFS_EXACT_PLAYBACK=true`.
- Client runtime rollback switches can only disable their corresponding feature:
  `__RAW_DISABLE_POINT_REQUEST_IDENTITY__`, `__RAW_DISABLE_MARINE_VALUE_VALIDITY__`,
  `__RAW_DISABLE_FORECAST_STATE_IDENTITY__`, `__RAW_DISABLE_GFS_EXACT_PLAYBACK__`.

The GFS playback policy targets the recorded wide wave view. Other models/layers and regional
playback keep their existing cadence. Manual scrub holds an accurate resident frame while
the requested exact frame loads; instant uncached delivery is not promised. Before activation,
use an owner-approved bounded dev canary with real hour-to-pixel, missing/zero, source/time,
slow-fetch/abort and frame-cadence read-back. Other audit rows remain tracked in PLAN.md.

Primary guidance: [HTTP cache request identity](https://www.rfc-editor.org/rfc/rfc9111.html#section-2),
[Copernicus wave parameters](https://help.marine.copernicus.eu/en/articles/6175153-how-to-describe-wave-height-period-and-direction-parameters),
[React Effect cleanup](https://react.dev/reference/react/useEffect),
[pure state updaters](https://react.dev/reference/react/useState).
