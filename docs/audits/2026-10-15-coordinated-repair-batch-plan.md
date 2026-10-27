# Coordinated repair publication and DEV integration

Prepared 2026-10-15 00:40Z. This is a held integration plan, not a deployment receipt.

David's updated instruction, relayed by Shredder: "we can do all the verifying separately" and "push it all at the same time". This supersedes a commerce-only rollout window. The explicit weather-owner hold remains in force. No uncommitted or unqualified weather changes, main promotion, flag activation, customer/payment mutations or deployment/access configuration changes are included.

## Frozen inputs and current blockers

| Lane | Source and evidence | Readiness |
|---|---|---|
| Commerce | Published PR331 `b220a2e89fad9224b89974724446d975348cf05c`; application source `0f650146908dafbe6013dc45dd6d5a7e0003d621`; [exact qualification](evidence/2026-10-14-commerce-connections/final-head-qualification.json) | 18 successful hosted checks plus one informational neutral; 425 suites/5530 tests. Local `aee31164c6f5cd757f0ade4983409afdd8b40a73` is clean and includes two unpublished records-only commits. Source qualification is unchanged. |
| Wave | Frozen `ee6631796ec3d5abf7c6043662ac64da432b5e0d`; owned `docs/weather-program/wave-palette-clarity-2026-10-15.json` and `docs/weather-program/log/2026-10-15-wave-palette-clarity.md` in the wave branch | Owner supplied portable evidence/ledger proposals; bundle identity read back. David accepted scoped synthetic BEACH/LIGHT appearance at ee663179, dark unchanged. Local `evidence/` is untracked. No independent push/PR/rollout. Combined technical qualification and post-integration verification remain required. |
| Weather | Committed `772c1a6f510fe61d235cf714443d3757b535054e`, plus active uncommitted F2 work; owner log `docs/weather-program/log/2026-10-15-forensic-f2.md` in its isolated checkout | No immutable qualified head for the current continuation, and no explicit safe-window clearance. Late-label losses remain; enlarged casing failed full-map qualification and was removed. Physical phone/Safari/thermal/native orientation unavailable; F2 default off, F4 pending. |

At the read-only snapshot, remote DEV is `131d5d9e434124d9bf510edb9eed2e8238723313`. These hashes must be refreshed before assembly and again before integration. The weather checkout is never used as an integration workspace.

## Ordered integration method

1. Each owner completes its own authorized repair checkpoint and supplies an immutable commit, explicit included file/commit scope, tests tied to source hashes, remaining gaps and rollback. Weather must distinguish retained runtime from rejected trials. Wave finishes its independent review and portable evidence packet. Do not rerun already passed lane suites simply to wait.
2. Agree on one publication/rollout window with both owners. Weather must explicitly acknowledge that window; current localhost independence and message delivery are insufficient. No commerce-only DEV merge during this hold.
3. Refresh remote DEV, lane heads, PR331 checks and deployment configuration read-only. Create a new isolated integration worktree and branch from current DEV. Do not reset, edit or cherry-pick unreviewed work from either owner's mutable checkout.
4. Assemble only owner-qualified commits/files, preserving their source provenance and rollback boundaries in a manifest. Application files must match the qualified lane blobs except for separately reviewed conflict resolutions. Check cross-lane ownership again: commerce consumers/hooks, marine palette/legend, and wind/F2 remain separate. Backend/auth/schema changes require the weather owner's explicit included scope and applicable authorization; they are not inferred from a branch name.
5. Reconcile records with one integration writer. Start from the current DEV ledger and use `action_ledger.py append` for missing fork actions/proposals; never concatenate or hand-edit chains. Preserve original fork commits, sequence/hash provenance and evidence; reconstructed records carry their original action time and a mapping to new canonical sequence numbers. Deduplicate only demonstrably identical actions. Merge append-only decision/scoreboard content without deletion, and update STATE with asserted exact replacements. Each owner retains its own session log.
6. In the coordinated window, publish the completed qualified lane refs and the assembled draft candidate without changing DEV. Keep PR331 available until its replacement is qualified; document whether the combined PR supersedes it. This separates remote source review from the later DEV update. Source publication does not establish runtime acceptance.
7. Qualify the exact combined head once: ledger/memory/encoding/secret/LOC gates, hosted build and existing CI, plus focused checks only for composition, conflict resolution or changed assumptions. Preserve original lane receipts. Schedule any necessary GPU/browser checks sequentially with owners; no duplicated heavy suite or shared-backend load.
8. After exact-head checks, independent reviews and current owner-window clearance, integrate the combined PR through one normal, head-matched squash update to DEV. Do not merge the lane PRs into DEV one by one or use administrative bypass. If DEV/source heads change, re-evaluate the candidate before integration.
9. Read back the merged commit and automatic deployment receipts. Match Netlify DEV context/branch/source explicitly; PR previews and the current frozen-production deploy do not qualify DEV. Match Render source/status/timestamps, then perform only agreed bounded health/runtime checks. Record actual outcomes and remaining gaps; no manual deploy or settings changes are implied.

## Ledger and deployment evidence

Read-only ledger-prefix comparison: DEV has 1176 entries; commerce has 1189 and weather's active file has 1257. Both preserve all 1176 DEV entries. Their append histories diverge, so a mechanical file merge would not produce one valid canonical chain. Weather's active 1257-entry file is not an approved import; await its frozen checkpoint. Wave's proposed action remains separate in its branch at `docs/weather-program/log/2026-10-15-wave-palette-ledger-proposal.json`. These cross-lane paths identify frozen source files; they are not yet imported into the commerce branch.

Render is configured for DEV commit auto-deploy; its filter ignores docs/audit/Markdown only, so frontend changes can run the backend lifecycle. A single eligible DEV update avoids knowingly requesting three successive DEV updates. It does not guarantee exactly one deployment: provider retries, external concurrent pushes and Netlify branch behavior must be read back. No deployment/security settings will be changed to enforce a count.

Commerce's exact preview is ready, but is not a DEV rollout. Current Netlify project metadata points to `prod-frozen-3bd38a83`, not DEV; a fresh DEV deployment receipt remains required. Latest Render live source in the read-only snapshot is `f9320c27dc0863db727e674a6f38cd6a4a1d1438`, finished 2026-10-13. No batch rollout has occurred.

## Acceptance limits

All 12 master launch gates remain open. Commerce missing-return fulfillment/operator recovery/provider acceptance, weather F2 edge/rim/casing/device acceptance and pending F4, wave physical-device/live-frame acceptance, and dated forecast scoring/monitor gaps are not closed by publication or hosted CI. Keep each lane's passed, failed, blocked and unrun evidence distinct.

## Wave visual-feedback hold

2026-10-15T00:49:49Z: David reports better beach palette colors but large/congested/coarse marks in the delivered comparison. This is preliminary feedback, not acceptance. The existing wave owner is diagnosing capture scaling/native resolution, viewport/DPR/zoom, canvas resolution, fixture/grid and mark size/density against the identical baseline. No renderer redesign, source change or rollout is authorized by this feedback. Separate wave visual review remains incomplete; the combined batch hold remains in force.

## Bounded weather checkpoint and next master-plan slice

2026-10-15T01:15:36Z: David clarifies that the weather program can continue after this batch. Request a bounded already-qualified immutable slice and explicit safe rollout window; an existing verified checkpoint is acceptable if its scope is provided. Unqualified active D-039 work is excluded rather than making completion of all F2/F4 a prerequisite. The explicit hold remains. Scoped beach/light synthetic appearance is accepted; optional real-forecast pre-review is declined; technical/post-integration qualification remains. No source or flag redesign is implied.

Independent preparation completed for the next P0 G02 slice: [durable checkout intent and missing-return/operator recovery](2026-10-15-g02-checkout-intent-preparation.md), with five immutable candidate source fingerprints and an offline fault/retry matrix. Candidate ownership/adoption and separately qualified runtime environments remain dependencies; no candidate code was imported or tested.
