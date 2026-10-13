# Gallery deadline grace period and fatal lint gate

## 2026-10-07 01:56Z — local runtime evidence; hosted acceptance pending824

PR250's completed hosted backend-lint job was successful, but its broad lint
step was non-blocking. Its four warnings are one actual missing `timedelta`
import in the gallery scheduler, two guarded `StringIO` references in a test,
and one unused cache `global` declaration. These are not three deadline bugs.

On the first undecided selection expiry, the scheduler sets the reminder flag
before calling the missing name. The caught exception leaves the old deadline
and skips the intended warning notification; the final commit still saves the
reminder flag. A later cycle can therefore force auto-selection without the
intended three-day grace period.

The repair imports `timedelta`, preserving the existing policy. Three offline
controls invoke the actual scheduler with a mocked session and fixed UTC clock:
first undecided expiry receives exactly three days and the correct notification;
already-reminded expiry receives no second extension or warning; explicit
forfeit keeps its existing deadline and notification behavior. The unchanged
source produced two passes and one deadline assertion failure; the fixed source
passes all three. The initial sandbox asyncio stall is excluded from that RED.
No real database, scheduler job, gallery or notification was touched.

The guarded test references now use the existing `io.StringIO` import directly.
Removing the unused global does not change dictionary cache mutation. The exact
broad CI fatal-name/syntax scan reported four warnings before and zero after.
Its `continue-on-error` exemption is removed so future failures block CI.

The staged file is selected from the required backend working directory:
estate298 files. PR250's own CI37557753240 measured1201 passed; three new cases
project1204, with floor1202 preserving the margin2. The staleness calibration is
updated in the same change. An embedded workflow indentation error was caught
by source review and corrected before publication; all three Python heredocs
parse. No floor was lowered.

Local isolated pytest runs39 cases across the new scheduler and existing floor
controls. The application conftest was explicitly excluded because this local
runtime lacks its unrelated dependencies; two plugin/config warnings are not a
full application environment pass. Own exact-source hosted CI must confirm all
lanes, actual counts and the now-blocking lint step before merging under the
owner's dev approval. Production frontend remains frozen; no served forecast
number or scientific-serving flag changes. The other chat's canary is excluded.

Historical affected gallery records are not repaired by this code change.

## 2026-10-07 02:17Z — exact-source hosted gallery acceptance and merge

Own b81b CI37559959669 all11 jobs and four supplementary workflows succeeded,
including manually dispatched Encoding37560053774 for the frontend-only path
filter. Actual5946backend tests2425/2317/1204;estate298selected296results0silent.
Frontend376suites4128tests. The strict fatal-lint step returned0 and succeeded.
Local39isolated controls are supplementary; the configured hosted environment
confirms all three new cases and the unchanged remaining lanes. PR251 merged
02:15:56Z asbf72c8db. Matching served frontend/API readback824 remains pending;
02:17:39Z frontendbf72 and healthy API26a1. No historical gallery record mutation,
served forecast number, scientific flag or production frontend change.

## 2026-10-07 02:21Z - matching served rollout

Ledger832 fulfills824. At02:21:00.0403477Z the public API was healthy on full
bf72c8db57252d55ccfaec3f55e0f9a4cc4d2f2d; dev frontend BUILD_VERSION bf72c8db
matched. Production frontend fc140024 unchanged. PR250 and PR251 are served.
No real gallery mutation, historical repair, served forecast number or science
flag change. Ledger833 preserves portable offline research and its limits;
the cache prototype remains unshipped. Original forecast acceptance stays open.
