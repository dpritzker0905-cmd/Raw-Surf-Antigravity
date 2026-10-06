# Existing-object freshness and verified-cycle pruning — 2026-10-06

Local source acceptance only; both flags default0/unset. PR243 targets dev; no merge,
deployment, cloud write, live-map request or flag activation. The prior source remains
qualified separately; its CI does not certify this batch.

## Reproductions and repair

WI01: actual ProductStore with fake L2 replaces a4m frame with6m and advances its manifest
registration. Existing L1 still serves4m after RAM expiration (full/stride2), sensitivity0
to the remote+2m change. Warm entries have the same defect. Initial23controls19fail/4pass
twice. Guarded replacement now returns6m; the synthetic height derivative becomes1.

`PRODUCT_REVISION_REFRESH=1` checks registration before RAM return, indexes the stable manifest
once, memoizes disk metadata by actual file stat, and serializes refreshes with64 bounded lock
stripes. Disk/refusal tables are capped256; manifests beyond50000entries refuse certification.
Unchanged registration performs0remote reads. A successful download must match model/provider/
component/valid time/coverage, receipt metadata and separately verified cycle. Each cell is
validated without retaining a full unstrided Pydantic vector list. Valid zero and partial masks
survive. Unique temporary files and validated replacement preserve complete old bytes on failure;
the manifest and local file stat are rechecked before replacement. All RAM stride variants and
their vector accounting are invalidated; stale in-flight RAM insertion cannot undo the refresh.

Older cycles, loss of a known cycle, older same-cycle storage receipts and source migrations
are refused. A failed/refused refresh never becomes accepted freshness; its five-second refusal
hold suppresses repeated downloads and recovery is tested. The original clocks and cells remain
served, with stale reason carried through all three actual point-sampler response constructors.
Legacy receipt evidence is not promoted into a verified model initialization.

WI06: the real duplicate sweep deletes a newer known cycle when an older cycle has a later
legacy receipt. Both orders reproduce the defect. Initial42controls28fail/14pass twice.
`INGEST_PRUNE_VERIFIED_CYCLES=1` changes both duplicate and superseded pruning: only duplicates
with the same valid interval, provider, model/component, resolution, coverage, region/tile,
authority/estimated class and source/estimate metadata compete. Verified cycle wins; same-cycle
ties use stable filename, never ingest time. Unknown cycles, sole hours, estimated tails and
different source/coverage classes are retained. Shared physical keys and retained IDs are
protected even when the separate WI04 flag is off. The upload reconciliation collision path
uses the same verified-cycle evidence, preventing a late older remote registration from undoing
the prune. A later receipt can update storage metadata only within the same verified cycle.

## Final acceptance

The corrected final matrix contains88new chain cases:39refresh/point and49prune/reconciliation.
Against actual6a5c5f23 loader/store/pruner/sampler source:67fail/21pass twice. Initial expanded
test fixtures incorrectly omitted saved coverage_mode and mutated a shallow cached vector;
those results are retained and rejected. Corrected source matrix88pass;145focused including
floor/partition controls pass. Expanded485tests pass twice (22.01s/21.42s), including cache
budgets, stride, actual sampler, L2 refusal, manifest merge/restore/publication/pointer/retention,
upload acknowledgment, cycle selection and prior ingestion repairs. No external sockets allowed.

Both files staged before lane selection:186guards/156chain/296estate, partition0unclaimed.
Projected hosted chain2224, floor2218 and paired reference2224. Guards2425/estate1113 unchanged:
projected5762backend. Frontend source unchanged; prior360suites3746tests, not rerun as new evidence.
Changed fatal lint clean; root LOC ratchet0new/regressed and backend653files0violations.
The local interpreter lacks two declared packages: hosted exact-source counters remain authority.

The previous docs head6a5c5f23 has CI37399663979 all11success; actual2425guards66skipped1xfailed,
2136chain1113estate (296selected294produced0silent), frontend360/3746; supplementary ledger,
LOC, encoding and Lighthouse success. This resolves its pending receipt publication readback,
not this batch's own hosted gate.

## Remaining acceptance and limits

WI01 remains partial: identical-metadata byte rewrites have no digest/storage revision in the
legacy manifest and cannot be detected. A control explicitly proves this limitation. Corrupt
existing objects and initial missing-file downloads keep their legacy path; this guard repairs
existing usable L1 replacement. Unknown/ambiguous registrations do not claim freshness.
The per-process lock and metadata recheck are not cross-process publication CAS; no live Storage
wire identity, authenticated egress, shared-box latency or memory acceptance has been measured.
Cached manifest changes must become visible locally; this does not refresh the manifest itself.

WI06 source ranking repair is built dark; unknown-cycle retention is deliberately conservative
and may retain extra registrations until normal valid-time retention. Capacity and live coverage
must be measured before activation. No provider fetch, model schedule or forecast physics changed.

Actual Gulf native/fallback model/time/palette/cells/pixels and playback/frame-gap/mobile/theme
performance remain open; these synthetic storage sensitivities do not identify the screenshot's
root cause. Dev publisher canary, PG/card concurrency and scientific held-out validation remain
separate release gates. Production Netlify freeze and all new serving/science switches preserved.

Primary design references checked: [Python replacement semantics](https://docs.python.org/3/library/os.html#os.replace)
and [Supabase download paths](https://supabase.com/docs/guides/storage/management/download-objects).
The installed storage3 download returns bytes without caller conditional headers; no ETag
interoperability or actual cloud execution is assumed.


### 2026-10-06 01:57Z: final unit/vector review supersedes interim counts

Local formats (value kind/unit/display hint, source variables, units) must also match
before replacement; measured direction/u/v/period/gust/value must be finite. Added two
controls, now90newchain (41refresh/49prune): actual predecessor69fail21pass twice,
final544expanded including57floor/lane controls twice. Previous88/485 receipts describe
the accepted interim source. New source chain2226/floor2220/ref2226; projected5764backend,
frontend unchanged360/3746; hosted694 pending. Scoped fatal lint pass; no activation or
live served-number/physics/cloud/merge/deploy change. Ledger695 records the count update.


## 2026-10-06 02:04Z: source publication and independent local cost/label probes

Sourcea268d804 pushed/read back at PR243 OPEN/dev, body accurate; CI37401821405
running and own694 pending. New flags0/unset; no merge/deploy/cloud/UI/served-number change.
Final90newcases544expanded twice; projection5764backend, not an actual hosted result.
Two actual-loader probes:20kmanifest/14842cells, guarded warmmedian0.0471/0.0463ms
vs0.0039/0.0040ms off; p95<=0.0542ms; initialindex102.65/102.28ms; changedrevision
refresh87.79/87.38ms including reindex. Unchanged0remote reads; changed1; servedstride966.
Synthetic local machine/fakeStorage only; sharedRender/cloudwire/egress/memory gate open.
Separate corrected actual LegendTicks SSR counterexample twice: fallback notice plus
native223km resolution with native engine absent. No realGPU/cloud/pixels or source fix.
Old screenshot path remains unknown; this does not prove low Gulf heights. Next visual
acceptance must identify actual raster/native frame/model/time/palette/cells and devices.
Ledger696-697. Pending delta only these receipts; source equals a268d804.


## 2026-10-06 02:16Z: exact cache/cycle source hosted qualification

Source **a268d804f76864eaeb20e7bc0df7c99023f9536d**, PR243 OPEN/dev: own
CI37401821405 completed successfully with all11 jobs. Actual timestamp-anchored
stdout: **5,764 backend** =2,425guards (66skips,1xfailed)+2,226chain+1,113estate;
**360 suites/3,746 frontend tests**. Estate296selected294produced0silent. The
LOC37401821438,ledger37401821491,encoding37401821492,Lighthouse37401821452
supplementary runs all succeed on this exact source. Ledger699 fulfills694;
695 corrected the interim2224chain projection to final2226. No previous source
qualification or copied workflow comment is counted as this run stdout.
Final90new regressions and544expanded local controls pass twice. Scoped fatal
lint/LOC pass; existing broad backend lint debt remains explicit. This pending
delta is documentation/ledger only and source-equivalent to the qualified commit.
Receipt publication700 requires final exact GitHub readback after commit/push.
New flags stay0/unset, production freeze preserved, no merge/deploy/activation.
WI01 remains partial: same-metadata rewrites, missing/corrupt local path and
cross-process/cloud wire acceptance. WI06 live coverage/capacity remains open.
Fallback resolution label reproduced but unpatched; original playback logs show
same-selected-hour grid-quality changes, without resident time/pixel proof.
Actual Gulf cause, native/raster playback/device/performance, Dev publication
canary, PG/card acceptance and held-out science remain open.
