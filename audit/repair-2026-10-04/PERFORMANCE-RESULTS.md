# Marine series work and retention — PF01/PF02

Baseline `e4353c062c093b453ce7f4e9445a4a793ce7feba`. Source changes are disabled unless
`REACT_APP_MARINE_SERIES_WORK_BOUNDS=true` / `REACT_APP_MARINE_SERIES_CACHE_BOUNDS=true`.
Runtime rollback switches are `__RAW_DISABLE_MARINE_SERIES_WORK_BOUNDS__` and
`__RAW_DISABLE_MARINE_SERIES_CACHE_BOUNDS__`. No configuration, merge or deployment change.

## Actual-source contracts

- All limiter-owned pages, minis and background grid warms share a three-request cap;
  pages retain their two-slot cap and foreground minis have one reserved slot. Visible
  mini waiters precede pages on release, cancel while queued and release their listeners.
  Priority rollback cannot bypass the qualified total cap; qualification rollback drains
  previously queued minis into legacy behavior instead of stranding them.
- The actual orchestrator delegates its two warm effects to a mounted viewport hook.
  Regional intent includes model/layer/flavor/anchor/snapped viewport. Changing region
  cancels its former page/mini/prefetch work. Same viewport and scrub page/hour retain work;
  reusable global work survives regional movements and cancels on model/layer/map exit.
  Immediate model warm shares this intent, avoiding a second uncancelled owner.
- Rapid A/B/A can replace an aborted in-flight owner before its cleanup runs. Late cleanup
  deletes only its own promise; it cannot remove the new request's dedupe identity.
- Pages, minis and warming placeholders use one cache with48entries and32MiB estimated
  ownership budget. Every insertion, lookup and containment scan reclaims expired entries.
  Reads/replacements update recency without extending the five-minute freshness timestamp.
  Containment-selected frames are touched after iteration; mutation cannot cycle the iterator.
  Oversized candidates preserve useful pages and fall back to ordinary grid delivery.
- Weight is an explicit estimate:256bytes per vector object, frame metadata allowances and
  typed-array byteLength. Shared vectors within a page count once; cross-page sharing is
  conservatively overcounted. This is not a hard browser heap/GPU byte measurement.

## Qualification

- Cache producer controls before twice:3failed/5passed, zero suite/runtime errors.
  Actual64mini and warming writers exceed48; expired mini remains resident. Diagnostic
  export added to expose retention only; original producer behavior otherwise unchanged.
- Exact prior limiter substituted and restored byte-for-byte: two selected actual
  transport controls fail twice (nine unrelated controls deliberately deselected, zero
  runtime errors). Shared-signal12viewport trigger starts14requests before,3after.
  Regional+retained-global trigger reaches4before, stays≤3after; abandoned regional queues
  drop while at most one useful latest mini can wait for an earlier global mini.
- Final actual transport, mounted hook, all cache writers and cancellation/coverage/playback
  neighbors:90passed twice across11suites, zero exclusions/skips. Thirty-seven new controls.
- Jacobian central differences: active transport versus viewport count1→0 at11/13viewports;
  retained entries versus inserted entries1→0 at63/65writes. Latest height sensitivity
  remains1 for ±0.05m perturbations. These establish ownership/numerical preservation,
  not forecast skill or a production latency improvement.
- Final full frontend351suites/3647tests; no runtime failures/skips. Earlier pre-final run
 351/3642 retained as history. Final lint accepted86existingerrors/917warnings; no debt increase.
- LOC ratchet accepted2509files, zero new/regressed violations; orchestrator shrinks to823lines.
- Extra CI=true compilation refuses existing warning debt, matching the documented repository
  CI=false build exception. Standard production compilation accepted with existing warnings; hosted source21db8ee8 accepted all11CIjobs (receipt below).

## Open acceptance and next source work

This repairs PF01's browser-owned regional/mini mechanism and PF02's retention invariant.
Foreground per-hour `/grid`, point traffic and other clients remain outside this limiter.
Backend process-wide admission, disconnect handling and true total service work are open;
no cross-user load or absolute queue/wall-clock bound is asserted.

GPU/heap plateau, declared-device cold/warm replay, slow-fetch playback/full hour-to-pixel
oracle and actual spot-hub population p95≤5s remain release gates. No live service load was
generated. Backend response encoding/deadline work PF03 and raster dedupe/LRU PF04 are next.

Primary guidance: [Map insertion order](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map),
[AbortController cancellation](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort).

## 2026-10-04 23:08Z: exact-source hosted acceptance

Source`21db8ee80fc5af8ea892c4c4467f0b54ce2f004e`: CI37241546337 completed/success, all11jobs.
Frontend351/3647, backend5219passed: guards182files/2327passed/66skips/1xfail,
chain150/1982/0skips, estate285selected/283results/910passed/0silent. Encoding, ledger,
LOC, Lighthouse and Netlify preview accepted. Source fingerprints match. Flags remain
disabled; no merge, deployment or activation. Backend admission/device/full-map/p95
acceptance remains open. Final paired floor/chronology controls48pass locally.
