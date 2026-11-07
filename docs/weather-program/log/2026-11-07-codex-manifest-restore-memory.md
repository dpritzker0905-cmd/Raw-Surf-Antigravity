# 2026-11-07 - Manifest restore transient-memory mitigation

## Scope and ownership

Base: `7efe2f3862eff8ac44e4d1f9e0cf00babb8bfffd` (`dev`). The owner asked to progress audit fixes and to merge qualified changes into dev. This candidate is separate from the existing marine session fixture PR #692. No open PR specifically covers restore-memory lifetimes. Merged #724 reduces publisher egress and explicitly leaves Render readers unchanged.

Only eight runtime lines change in `store_helpers._restore_from_supabase_inner`:

- Release the downloaded bytes, raw remote JSON and cache-busted HTTP response after validation and before local merge loading.
- Release local raw JSON after its validation.
- Release the full local model and temporary candidates before serialization, including on local validation failure. Entries actually merged retain their ownership in the new manifest.

No served forecast number, parser, selection/filter rule, lock, cache publication, retention policy, fetch cadence, upload, flag or deployment is changed. The existing serving cache is never proactively cleared. This is a transient allocation mitigation, not a demonstrated cure for the live OOM.

## Paired offline instrument

Evidence: `../evidence/2026-11-07-manifest-restore-memory/`.

`profile_restore.py` constructs 18,002 synthetic registrations, 20% estimated, with a 17.42 MiB JSON payload. It runs the real restore on a temporary directory with storage reads replaced and network blocked. After a warm restore it performs three changed-input cycles. Baseline uses the exact original function from dev, injected into the unchanged module globals without rewriting the checkout. Candidate uses the working-tree function. Python 3.12.10, Pydantic 2.11.7, Windows.

- Additional peak Python allocation during each restore: baseline **267.60 MiB**, candidate **188.98 MiB**. Reduction **78.62 MiB / 29.4%** in all three cycles.
- Raw written-file SHA256 and normalized JSON content SHA256 match in every corresponding cycle. All 18,002 registrations remain.
- End-of-cycle retained RSS does **not** materially improve: final baseline 326.98 MiB; candidate 326.05 MiB. Tracemalloc adds overhead; these are not Render/Linux RSS measurements or a total-process memory cap.
- Timing varies on the busy desktop and is not a performance claim.
- Synthetic metadata is not a captured production manifest. No live load test or live restore occurred.

Reproduce from the repository root, substituting a pinned Python 3.12 interpreter:

```text
python docs/weather-program/evidence/2026-11-07-manifest-restore-memory/profile_restore.py backend 18002 7efe2f3862eff8ac44e4d1f9e0cf00babb8bfffd
python docs/weather-program/evidence/2026-11-07-manifest-restore-memory/profile_restore.py backend 18002
```

## Verification

- Focused identity/lifecycle file: **17 passed**, including 11 new cases.
- Exact original dev restore function with the same new tests: **4 failed, 13 passed**. The expected failures are remote raw lifetime, unused local models, invalid local raw cleanup and HTTP response lifetime. The behavior controls remain green.
- Broader manifest/run-key/warming/memory cohort: **576 passed, 1 skipped**, 24 files. The first attempt could not collect a staging-canary test because the sparse checkout lacked its tracked fixture; after materializing the fixture the full selected cohort passed. No test was removed or waived.
- Fatal lint, 800-line backend gate (0 violations), lane partition and whitespace checks passed.
- Official floor re-derivation: dev run 42348439253 reads guards 3545 / 223 files, matching dev's map. Add 11 tests, no new file: expected **3556**, minimum **3550**, files **223**. Both floor files updated together.
- Initial docs-only memory audit: **0 FAIL, 84 WARN, 8 NOTE**. Existing warnings include stale STATE, unfurled merge receipts and overdue commitments; one existing STATE blame fallback is reported. Unrelated state and other owners' logs are untouched.
- Independent review: no blocking patch-introduced lifetime, error-path or concurrency defect. No new shared state or lock is introduced. Concurrent restore behavior itself was not newly proven.

Environment limit: 46/50 exact installed pins match; anthropic, pydantic-ai-slim, pygrib and uvloop are absent locally. Local evidence is not full CI/production qualification. Exact-head hosted gates remain required before release.

The failed-write regression proves the existing cached model object and successful identity hash survive a failed serialization. It does **not** prove uninterrupted serving: the existing write opens the local file with `w` before serializing, so failure can truncate disk. Atomic publication and broader retained-memory causes are outside this patch.

## Release boundary and rollback

Draft candidate only at this checkpoint. No main/prod change, service restart, L2 write, live weather request, merge or deployment. Release only after exact-head required gates and coordination. If released, observe ordinary scheduled restores and process memory; do not induce live load. Roll back the runtime cleanup with its paired tests/floors if needed. Preserve append-only evidence and ledger history.

## Final local qualification

The restore and floor-control files pass together: **53 passed**. Full fatal backend lint passed. Ledger verification passed with 2,074 canonical entries; the new fragment is separate. The repository LOC ratchet reports no new violations, but this is a sparse backend checkout: unchanged frontend files are absent, so that local result does not certify the frontend. No ratchet baseline was changed.

The final paired profile includes raw disk-file hashes as well as normalized JSON hashes. All three pairs match. Peak allocation remains 267.60 to 188.98 MiB. The candidate final-cycle RSS is 326.05 MiB versus baseline 326.98 MiB, confirming no material retained-RSS claim.

## Approved-clone qualification and release coordination

The initial linked-worktree commit was blocked by the independent-clone safeguard. The owner explicitly approved preserving the patch and evidence before removing only the new worktree created for this repair. All 2,510 worktree files (402,883,736 bytes) and eight worktree metadata files were archived and hash-verified. The original clone's branch, tracked contents and installed safeguard were preserved. Removing only the new branch's upstream metadata restored the exact approved Git configuration checksum; the unchanged safeguard then passed. No control was disabled or weakened.

The reviewed nine-file patch was applied in the same approved independent clone at the unchanged dev base. Every file matched its prior reviewed SHA256 before this append-only handoff update. The real staged patch passed the pinned secret scanner and unchanged 800-line Python gate. The apparent unrelated dirty file was proven byte-identical to its index before refreshing its metadata. The pre-existing review-category branch is retained.

The restore and floor-control tests were rerun in the approved clone: **53 passed**. The same four missing dependency pins still limit local evidence. Hosted CI on the published commit remains required. The owner reports a separate active weather infobox release; this candidate changes only restore object lifetimes and must not merge into that release window without coordination.

Authorization transcription correction: fragment line 2 lightly normalized the spoken wording. Fragment line 3 records the exact owner response. The cleanup scope and safeguard-preserving result are unchanged.
