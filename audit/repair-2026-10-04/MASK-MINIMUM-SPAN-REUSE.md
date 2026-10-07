# Clean minimum-span mask reuse

The live PR252 receipt846 caught19clean rendered-water paints taking2433.2ms
outside15short wave callbacks99.3ms. It had no fallback/damaged paint. That
disproves the degraded-retry hypothesis for that scene, but does not establish
the live viewport span or the sole cause of its1FPS fallback.

## Independently reproduced cache defect

The actual overlay engine keeps a0.05-degree minimum texture width for regional
min-combine and0.7degrees for a wide-grid replacement overlay. Its old reuse
ceiling was5times the viewport width. A stationary clean texture at the floor
therefore never qualifies below0.01/0.14-degree viewport widths respectively,
even though painting again cannot increase its texture density.

Through a Jacobian lens, target texture width is `max(2 * viewWidth, minimum)`:
its derivative with respect to view width is zero while the floor binds. The
old resolution guard nevertheless demanded a rebuild there. This is an exact
reachable contradiction, independent of the missing live viewport receipt.

Public engine tests use the actual feature selector and painter with a bounded
rectangular Canvas fixture. The valid RED produced2stationary-reuse failures
with18existing controls passing. The first wide fixture was below one raster
pixel and could not paint; that failure is excluded. The corrected wide view
paints cleanly and then exhibits the same unwanted second paint as regional.

## Repair and safety boundaries

Keep the existing5-times resolution rule. Additionally reuse the attainable
current candidate width when the clean queried truth covers the viewport and
zoom has changed by less than0.75 since painting. Track basin combine-mode
identity so changing classification mode always rebuilds. The minimum widths,
canvas tier, painter/pixel algorithm, source-event handling, readiness gates,
degraded healing, no-shrink guard and forecast values remain unchanged.

Review added a second RED:2cases/32passing controls proved that unrestricted
floor reuse would skip newly available tile truth after a settled zoom change.
The stable-zoom guard applies only to the added minimum-width reuse path, so
the old5-times path retains its prior behavior. Pan escapes, resolution gains,
mode changes and damaged truth still rebuild. These controls are part of the
16new public engine tests; the final hosted floor is377suites/4171tests.

Rollback: `window.__RAW_DISABLE_MASK_MINIMUM_SPAN_REUSE__ = true` restores the
prior reuse policy; otherwise revert the repair. Two controls exercise rollback
then re-enable reuse. No default-off scientific-serving flag is activated and
no served forecast number changes. Production frontend remains frozen.

## Qualification still pending

Two intermediate full suites passed377/4165 and377/4169; the final suite includes
the zoom guard and must qualify independently. Final lint/build, native Canvas
pixel parity and own-source hosted checks are required before a dev merge.
The existing live-scene allowance was used for receipt846; there is no second
forecast scene in this turn. A future bounded live receipt must determine
whether the clean-paint hotspot falls. Playback/scrub, Gulf amplitude, exact
served time, real devices and isolated staging publication remain open.

## 2026-10-07 03:27Z - native parity failure isolated and repaired

848 preserved a failed native pixel qualification rather than ignoring it:
rollback3paints versus repaired1, but1542regional/1320wide final bytes differed.
849 isolated eight native legs: FIRST paints matched exactly; repeated legacy
paints drifted only when pristine-canvas caching was enabled. Disabling that
cache removed the discrepancy. The synthetic fixture deliberately has all-land
NE and map water, with shelter off; it is a raster control, not real geography.

One source change gives the pristine cache's first2Dcontext creation the same
willReadFrequently:true option as original/render-copy canvases. The same eight
legs then had ZERO first/repeated/final differing bytes across32MiB of final
comparisons. Every row had both land and water, clean verdict, restored GL
state; old-policy3queries/uploads versus repaired1. Native completed=true.
The actual pixel algorithm is unchanged; the context choice is now consistent.
The earlier no-parity result remains evidence, not an excluded test.

The context-option mismatch is causal in this Chrome control. MDN documents
that getContext reuses the first context and that willReadFrequently selects
a software-oriented2Dcanvas; this explains why matching creation options is
appropriate. We did not instrument the browser's actual GPU/backend selection
and do not claim all-browser parity, GPU completion, cost or live smoothness.
[Canvas context documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)

Both owned native tabs closed and servers stopped; no tests/builds overlapped
the observations, no backend connections (CSP connect-src none), no second live
forecast scene. Renderer change now joins the minimum-span repair and requires
new combined full/lint/build and own-source hosted qualification. Forecast
numbers/science switches/production frontend remain unchanged; canary excluded.

## 2026-10-07 03:30Z - final combined local qualification

850 accepts the FINAL combined tree:377suites/4171tests,0failed/pending;
blocking lint86knownerrors/917warnings, no ratchet regression; LOC0new/regressed,
engine3207to3205; deployed CI=false production build exit0.849 native8cases
compare32MiB finalRGBA exactly, including first/repeated parity and restored GL
state. No source code changes remain after this qualification. Earlier full
runs were intermediate; they do not substitute for this combined result.

851 tracks own-source hosted all11/four supplementary checks, actual5946backend
and377/4171frontend with0silent estate results, qualified dev merge and healthy
matching served readback. No second live scene in this turn. Live smoothness,
viewport span, playback/Gulf/time/device/cloud acceptance remain open. No
served forecast number or science switch changed; production frontendfc140024
frozen and other chat canary unchanged/excluded.

## 2026-10-07 03:56Z - final three-cache repair, active zone included

853 records a related public-engine RED1/34 in an isolated ignored root:
regional z10 clears clean overlay truth on every refresh. Actual active carve
minimum is8, while the stale clear still used obsolete12. The proper source
regressions then produced4RED/36passing cases:8/10/11.999stationary plus
reenabled rollback. Clear only below the active zone; legacy carve and the
new __RAW_DISABLE_ACTIVE_OVERLAY_RETENTION__ rollback keep12. Below8clear,
legacy12gate and repair rollback/re-enable are preserved.

854 final full377suites4177tests,0failed/pending; lint/LOC/build pass,
engine3207to3202.22new public controls now cover all three cache repairs.
855 native16legs,64MiB exact finalRGBA comparisons,0different bytes. Regional
8/10/11.999 have3legacy overlays versus1repair (each also paints1base);
at12both retain1overlay. Floor controls remain3versus1. Every native row has
land/water, clean verdict, restored GL state. Owned tab closed/server stopped;
no tests/build overlapped, no backend connections or second live forecast.

The previousff124 candidate qualified all11/four and actual5946backend/
3774171frontend on CI37567230968 at03:49:10Z, but was NOT merged. That evidence
is historical and cannot qualify the new head.851 remains open; final frontend
floor4177 replaces its4171 baseline. New head must pass its own full hosted
checks/counts before dev merge and matching served readback. No served forecast
number/science activation/production frontend change. Original live smoothness,
viewport span, playback/Gulf/time/device/staging gates remain open.

## 2026-10-07 04:22Z - final source qualified, merged and served on dev

857 qualifies exact d4176381 on own CI37569367813: all11 jobs and four
supplementary workflows succeed. Actual377 suites/4177 frontend tests and5946
backend passes (2425 guards,2317 chain,1204 estate);67 declared guard skips,
0 failures/errors,estate298selected296results0silent. These receipts qualify
the final active-zone amendment; earlierff124 evidence remains historical.
858 records PR253 squash 4fe944205a5716aa3114dfa47a79e1ee32e69cc6 at 2026-10-07T04:17:54Z.
859 fulfills851: fresh 2026-10-07T04:21:55.0649154Z healthy shared API and dev frontend match
the exact squash; production frontendfc140024 unchanged. Final native855 has
16legs/64MiB compared/zero differing bytes. Repeated floor and regional paints
fall3to1 in synthetic controls; this does not establish live smoothness.

Three fixes are deployed: minimum-span reuse guarded by truth/coverage/zoom/
combine mode; consistent pristine-cache Canvas context; and clearing regional
overlays below their active8gate rather than obsolete12. Both new client kill
switches and the existing pristine-cache disable remain available. No served
forecast number or scientific-serving flag changed; no SCOREBOARD row needed.
One-CPU shared backend received only lightweight health reads after merge.
No second live scene, Play/scrub, judge or stress dispatch. Owned tabs/servers
remain closed and other chat canary unchanged/excluded.

860 records the later bounded paused live acceptance: first verify exact
served version and healthy API after the deployment quiet period; capture real
viewport/zoom, clean-paint counts/cost, callback gaps, visibility and fallback;
then disable Waves, close the owned tab and read back health. No claim yet for
FPS, playback/scrub, Gulf amplitude, exact served time, real devices or isolated
staging publication. The original audit register and prior failures stay open.

Data-health readback at2026-10-07T04:22:57Z remains warn (862), while the
API availability/version is healthy and exact (859). Warning causes and
scientific/live acceptance are not closed by this deployment receipt.

Receipt branch publication, own hosted qualification and dev merge remain owed by863.
