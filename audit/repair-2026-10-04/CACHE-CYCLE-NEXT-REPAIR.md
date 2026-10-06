# Next serving freshness and cycle-selection repairs

Reviewed against source a3b321f0. This is a diagnosis and acceptance plan, not implemented
behavior or authorization to activate a flag. WI01 and WI06 remain open.

## WI01: existing disk product is never refreshed

Actual `ProductStore.load_product` full/stride2 replays fail twice. A fake remote object changes
4m to6m, its manifest registration advances, and the RAM cache is cleared. The loader still
returns4m from disk and performs0remote reads. Sensitivity of served height to this remote+2m
change is0. This distinguishes persistent disk staleness from the separate five-minute RAM TTL.
The owner Gulf screenshot does not contain the object revisions needed to attribute its pixels
to this particular failure.

The current code returns a warm RAM entry before checking disk or manifest revision. The lazy
manifest restore intentionally skips product downloads, while the loader downloads only absent
disk files. A repair restricted to RAM eviction or periodic manifest refresh is therefore
insufficient. Cold and warm full/stride reads need the same revision policy.

Proposed minimal dark repair:

- Build a bounded per-manifest revision index once when the manifest identity changes. Avoid a
 20,000-entry scan on each map frame. Compare stored identity using explicit provider/model/
 domain/layer/valid time, verified cycle and storage revision evidence. Legacy ingest time is
 not evidence of a forecast's model cycle. Same filename collisions need ambiguity handling.
- Invalidate all full and strided RAM variants when their accepted object revision changes.
 Serialize refreshes per storage key; recheck the current manifest revision after the download
 to reject a race where a newer publication arrived during an older read.
- Download to a unique temporary file, validate normalized shape and expected revision, and
 atomically replace the existing object only after success. Clear success/failure state and
 vector-budget accounting consistently. Corrupt, empty, unrelated or older remote data must
 not destroy the usable local object.
- Bound refresh and refusal caching. Never mark a failed refresh as fresh. If retaining an older
 local object, preserve its actual served provenance so the UI/health check can report it;
 returning it under the requested newer identity would reintroduce the diagnostic defect.
- Keep the repair off until cloud bytes, concurrency, freshness, egress and latency acceptance.
 An unconditional remote read per frame would burden the shared production/dev serve box.

Required regression matrix: unchanged revision has0extra reads; changed revision refreshes
warm/cold full and stride variants; valid zero and masks survive; concurrent readers make one
refresh; revision changes mid-download; corrupt/wrong-revision/wrong-provider/404/429/timeout
responses preserve the previous bytes and do not certify freshness; retry later recovers; flag
rollback; unknown/ambiguous legacy registration; bounded index/failure state; no second surf
composition. Verify the wire boundary with the actual installed storage client.

AWS documents conditional reads with ETags. That is a design reference, not proof that the
installed Supabase `download()` exposes equivalent headers or revision metadata. Check the SDK
and authenticated storage endpoint before choosing a transport; do not assume interoperability.
[AWS conditional reads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html),
[Supabase download paths](https://supabase.com/docs/guides/storage/management/download-objects).

## WI06: transient probe changes selected cycle

Corrected URL fixture calls actual `_pick_cycle`: one500 or timeout on the newest cycle's f000
HEAD selects a cycle6h older; two failures and one genuine404 control pass twice. The first
fixture omitted `gfs.` from its URL match; its vacuous successes were rejected. This proves
selection sensitivity, not the complete audit claim about subsequent duplicate ranking.

Current picker probes f000 and the requested final hour once, newest first, across seven cycles.
The HTTP session pools connections but has no explicit picker retry policy. A dark repair needs
bounded transient retries for both endpoints, a total elapsed selection budget, bounded individual
timeouts, backoff/jitter and explicit terminal status handling.404 remains a legitimate not-yet-
published cycle;401/403 and malformed responses should not become transient successes. An exhausted
budget must not certify an unobserved complete cycle. Preserve actual chosen cycle metadata and
the existing valid-time axis. A socket timeout alone is not a full elapsed wall-clock deadline.
[Requests retry guidance](https://requests.readthedocs.io/en/stable/user/advanced/#example-automatic-retries).

Required regression matrix: transient first/final HEAD recovers to newest; real404 walks back;
repeated transient failure stops at the retry/time budget; no complete cycle returns unavailable;
late response does not certify success; genuine complete older cycle stays honestly identified;
off/unset rollback; script-by-path imports; existing coverage/soft-deadline/multi-region guards.
Do not change legacy pruning timestamps as part of a transport-only retry repair. Their migration
requires an independent selection/cycle-ranking regression and owner activation review.

Neither proposal is a claim of improved physical forecast skill, completed live cloud acceptance,
or a repaired actual Gulf/native pixel mismatch. No flags, provider settings or live data changed.


## 2026-10-06 01:12Z: subsequent WI06 local implementation and ranking proof

The retry proposal above now has a default-off local implementation with67focused/347expanded
twice pass; hosted686 pending. Actual duplicate sweep2fail twice proves the separate ranking
problem too: later legacyrun_time of an older known cycle deletes the newest known cycle.
No ranking migration/activation; WI06 partial and WI01 open. WAVE-CYCLE-RETRY-RESULTS.md.


Transport readback: the local installed storage3 synchronous download API returns response bytes
and passes no caller conditional headers; its options path handles image transformation. This is
local SDK evidence, not a claim about every version, deployed transport or Supabase S3 capabilities.
