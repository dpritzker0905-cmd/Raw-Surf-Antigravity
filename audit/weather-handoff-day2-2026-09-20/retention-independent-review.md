# Independent retention-repair review

2026-09-20. Read-only design review against d82032f5 source, coordinated with the implementation
agent before its retention edits, followed by final source/test review below. No live storage
acceptance or production-incident attribution is claimed.

The bounded scope is appropriate: opt-in strict reads/writes for the skill ledger, preflight
of all monthly objects that will be touched, acknowledged archive writes before removing scored
rows from pending, and create-only writes after a missing-object response. Legacy calibration
readers/writers retain their existing interface and behavior unless they request strict mode.
No retention policy, provider forecast, served rating, credential, bucket policy or production
object changes are necessary for this fix.

Required distinctions communicated to the implementation agent:

- Only an explicit supported missing-key response may become absence. Missing configuration,
  timeout, 503, malformed JSON, permission errors, unknown/HTML 404, `NoSuchBucket`, and
  successful HTTP 200 containing JSON `null` must fail the strict path before writes. A decoded
  pending/month value must be a list of dictionaries; `[]` is a healthy empty-object control,
  not the same state as no object.
- `404 NoSuchKey` is not absolute proof of nonexistence: Supabase documents that permission
  masking can also produce it. A subsequent create-only upload must refuse an existing object;
  neither modern 409 nor legacy 400 conflict responses may trigger an upsert retry. The primary
  docs describe both status conventions, so handling only one numeric code is insufficient.
  [Storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes),
  [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
- Strict upload success must be positively acknowledged by the actual uploader after HTTP
  200/201. Missing configuration, designated-writer rejection, failed store initialization,
  timeout and non-success responses must not silently return success. Wrapper tests should
  reject fake `None`/`False` acknowledgments and verify default legacy behavior separately.
- Preflight all touched months before the first write. Write archives before pending removal.
  If one month fails after another succeeds, leave previously stored pending rows retryable.
  Retry reads the already-committed month and deduplicates it, then finishes remaining work.
  A pending-write failure after archive success must likewise surface failure and permit a
  subsequent deduplicated retry. No success report should be returned after an unacknowledged
  write.

The design is **not transactional or concurrency-safe for existing objects**. A successful
read/merge/upsert can still overwrite another writer's intervening append, and an eventually
stale successful read can have the same effect. Supabase explicitly documents last-writer-wins
behavior with upsert. Create-only protects first creation; it is not compare-and-swap for later
updates. A future atomic design needs coordinated ownership, conditional writes, immutable
segments or a transactional ledger. [Documented concurrency behavior](https://supabase.com/docs/guides/storage/uploads/standard-uploads#concurrency).

Retry claims are limited to data already persisted: newly collected in-memory forecasts are
not durable until their pending write is acknowledged. Existing pending expiry/cap rules remain
in force. This repair cannot recover older lost rows or establish that production loss occurred.

The Supabase skill and current primary documentation were checked. Its markdown changelog
endpoint was unsupported by the web reader; the HTML changelog was reviewed instead. No relevant
Storage REST breaking change was identified in the current entries; this is not a claim about
every historical service version. [Changelog](https://supabase.com/changelog).

Verification scope: the direction-only full-chain run preceded these storage changes and cannot
validate them. New strict-storage tests and the affected ledger/calibration/store tests must run
after implementation. Source review must confirm acknowledgments are not merely mocked at the
ledger boundary and that conflict tests capture the real upload header.

## Final implementation review

Read the complete working diffs in `buoy_calibration.py`, `forecast_skill.py`, `store.py`, and
`buoy_residual_retention.py`, plus all cases in `test_forecast_skill_retention.py` and the affected
existing-fixture changes. **No new production ordering or compatibility blocker found in this
bounded repair.**

Verified against actual code:

- `buoy_calibration.py:517,549` rejects unavailable configuration, JSON null, unreadable bodies
  and wrong archive container types. Final absence handling accepts HTTP 404 with either
  `NoSuchKey` **or documented legacy `not_found`**. Unknown, bucket and tenant errors remain
  failures. Neither recognized code proves absence, so `(rows, exists=False)` is preserved
  through to create-only upload.
- `store.py:331,367,393,399` retains legacy best-effort behavior by default, emits the actual
  `x-upsert: false` header when requested, and only acknowledges strict success after HTTP
  200/201. All other statuses, including both 400/409 conflict forms, fail without an overwrite
  retry. The serializer at `buoy_calibration.py:499` uses identity `is True`; `None`, `False`
  and truthy `1` cannot stand in for acknowledgment.
- `forecast_skill.py:596–620` completes pending/month reads and merge preparation before the
  first write, then writes monthly archives before pending consumption. A failure leaves prior
  pending evidence available. The tests demonstrate month-boundary partial success, failed
  pending persistence and timeout after a committed archive write, followed by deduplicated
  retry. Fresh in-memory forecasts still depend on a successful final pending write.
- `buoy_calibration.py:743–747` applies strict read/write handling to the hot archive and adds
  its summary only after acknowledgment. Failure preserves the existing report-only behavior.
  `buoy_residual_retention.py:63–86` preflights all monthly rollup reads before writes and uses
  the same strict create/update distinction. Partial monthly success is idempotent on retry.

The new tests execute the actual loader, JSON serializer, `ProductStore` upload and ledger/rollup
entry points; the network and forecast-provider inputs are controlled. The fixture patches only
the store constructor to avoid disk setup, leaving the actual class/method intact. The saved
`retention-affected.xml` at review time independently confirmed **213 tests, zero failures/errors/skips**, with
**69 cases** from the new retention test file. That run took 10.88 seconds wall time; its XML
suite time was 10.742 seconds. These are local affected-suite results, not a
substitute for the separate post-storage full-chain/hosted checks.

One actionable **test-only** finding was accepted by the implementation agent: the hot-archive
fixture dates observations to September 1 but initially left `bc.datetime.now()` on the real
clock. Since the actual merge prunes beyond 90 days, healthy controls would eventually fail.
The requested correction freezes the fixture clock while retaining the real merge/runner.
Coordinator follow-through: after the full chain passed 1,148 cases, the test-only fix was applied
and all 213 affected cases passed again (10.57 seconds wall time; 9.801 seconds in the final XML).
The final receipt replaces the earlier same-path XML. No production change was needed for this finding.

The scope still does not guarantee permanent retention through arbitrary outages. Hot merging
retains its existing **90-day / 20,000-row** bounds (`buoy_calibration.py:585,590`), and the hot
write at line 744 precedes the windowed monthly rollup at line 754. Persistent rollup failure can
therefore outlast the hot window and lose unarchived rows through the unchanged pruning policy.
The approximate 14-day depth mentioned in comments is workload-dependent, not the age constant.
Existing-object concurrent/stale-successful-read upserts and full row/scientific validation also
remain outside this repair. These limits do not invalidate the corrected failure/absence and
acknowledgment contracts, but they must not be reported as solved.
