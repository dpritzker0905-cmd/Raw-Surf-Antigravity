# Support repair queue — preservation and remaining decisions

Owner: Codex, ce30/raw-surf, chat01a188c2-90f8-7b11-a690-39f8cfdd9957, branch codex/admin-support-selection-20261029. Fresh October29 continuation requests resuming the same three conversations within existing ownership and authorization; report precise holds if only decisions/integration remain. No replacement chat or source overlay.

## Preserved candidate

Completed locally: ticket selection/draft isolation and accessible controls; full list pagination/filter/search/error/race handling; independent metrics refresh/failure states; measured-count versus unavailable averages; Waiting Internal controls; explicit SLA creation-cohort label; reopened-resolution consistency; random ticket references with targeted native unique-index arbitration and bounded retries. Reports and exact evidence remain under docs/audits/2026-10-29-admin-support-*.md.

Fresh recheck: **83/83 prior source/test/harness/report hashes unchanged**, SQLite allocator **17/17**, native PostgreSQL17.11 allocator **17/17**, reopened lifecycle **26/26**. Owned disposable PostgreSQL cluster stopped, pg_ctl status3 and OS listener absent. Prior UI78 and Chrome6 evidence is retained and hash-bound; those UI/browser runs were not repeated during this source-unchanged continuation. HEAD72b4652d5753423cce18b9ad1d1de95f0afcb7e7 remains local/uncommitted/unpublished. No production source was edited this turn.

## Remaining support queue

| Audit item | Confirmed current dependency | Decision / owner | Disposition |
|---|---|---|---|
|176, reply delivery | reply_to_ticket stores messages; no recipient notification is created by that handler. Targeted frontend search finds no user ticket reader; notification helper has no support destination. Inbox cards clamp body to two lines. A notice alone does not establish readable follow-up. | David chooses user ticket inbox plus in-app notices, or email delivery. ce30 owns support producer/dashboard; companion2866 owns notification inbox consumers. User ticket reader/entry surface needs an explicit scoped plan. | Product question pending; no notice-only or provider patch. |
|464, user ticket entry/follow-up | POST /support/tickets exists; inspected frontend callers use admin ticket endpoints. No user-facing ticket GET is defined in this module, and targeted routing/caller search establishes no ticket reader. Other clients/entry points remain unverified. | Same delivery/entry-flow decision; ce30 can plan producer/new reader work after scope selection. | Dependent on176 workflow; no new adjacent feature invented. |
|175, payment-error support handoff | BookingPaymentSuccess.js and DispatchPaymentSuccess.js route Contact Support to general /messages without a support recipient or ticket context. | Approved support entry destination required first; booking/payment file ownership must be reconciled before edits. | No arbitrary support account, conversation or URL selected. |
|179, remaining SLA timing portion | Priority changes call calculate_sla_due from the current instant. The audit did not establish whether resetting, preserving or anchoring to creation is intended. Reopened-resolution portion already repaired. | David supplies SLA priority-change policy; ce30 owns support update handler. | Existing deadline policy preserved. |

These are the remaining documented support findings in this lane. They require product scope/policy or consumer ownership coordination. No additional already-authorized, policy-independent support repair was selected. Admin analytics/moderation and other adjacent audit sections were not adopted as substitute work.

## Ownership reconciliation

Read-only current conversation and shared repository plan review confirms:

- ce30 retains backend/routes/admin/support.py and frontend/src/components/admin/AdminSupportDashboard.js with its existing candidate/evidence. No source transfer or integration authorized.
- booking-availability-repairs retains weekly/monthly leaderboard/replay work, migration readiness and related models/scheduler/stat schema reservations. This continuation does not enter that lane.
-2866 has resumed its pending WebRTC cancellation work. Its existing handoff also reserves backend/routes/notifications/notifications.py, NotificationsDrawer.js, NotificationsPage.js, useNotificationInbox.js, useUnreadCounts.js and notificationService.js. Clean Git status is not a transfer of that ownership.
- Primary/booking/2866 support target Git statuses are clean at this recheck. No other checkout writes or messages; no owner acknowledgement claimed. Shared coordination documents were read only. No direct Claude messaging, app or internal-folder inspection.

The delivery-flow question is pending in this chat. Silence does not select a channel or transfer files. The next source change depends on that answer and any required ownership reconciliation; integration/release holds remain separate.

## Evidence, boundaries and next action

Evidence: docs/audits/evidence/2026-10-29-admin-support-remaining-holds/. entry-hashes.json/verification.json bind83 preserved files, fresh17/17 allocation results on each engine,26/26 lifecycle results, source observations and PostgreSQL cleanup readback. Existing fixtures were copied to this new evidence folder to preserve earlier outputs; no new acceptance behavior or production change. Actual declarations/functions/models and disposable fictional data, no normal app/.env/weather startup. UI/browser receipts are retained historical local evidence, not fresh runs or deployed acceptance.

No shared database/migration/flags/paid resource/live transaction/provider delivery/security probe/commit/push/PR approval/merge/deployment action. No weather source/runtime/STATE/canonical ACTIONS/SCOREBOARD or served-number changes. Only this session's log/ledger fragment records the preservation and decision hold. No goal status is changed and no scheduled continuation is created.

Next action: obtain delivery-flow selection for176/464, reconcile consumer/file scope, then implement and test that concrete workflow in this existing worktree. SLA deadline policy requires a separate explicit decision. The completed candidate remains available for future dependency-complete integration review; no release authorization is inferred.

Final repository gate readback follows below.

Final readback: canonical ledger2074 entries OK; docs-only memory audit0 FAIL,63 WARN,12 NOTE, exit0. Existing weather commitment warnings are outside this lane. Preservation83/83, fresh allocation17/17 on each engine and lifecycle26/26 pass; owned PostgreSQL stopped/no listener, collector narrow lint and whitespace pass. Session fragment line17 records this decision hold. No product answer or ownership transfer received at closeout; dependent source changes remain held, with all prior repairs preserved.


## October30 UTC — product holds superseded; integration remains separate

David approved authoritative authenticated in-app tickets plus generic email link notices and original-created_at plus the new priority duration. These supersede the delivery choice and SLA policy holds recorded above. ce30 implemented owned API/reader/mailer/Auth/request-key/SLA units with fake-provider qualification; see docs/audits/2026-10-29-support-delivery.md. The updated contract transmission was accepted after materially new written parent-chat authorization; explicit companion reservation acknowledgement remains separate. App.js mounting remains with its existing booking-lane owner; no route/consumer overlay or source transfer. Normal redacted pre-commit hooks/focused local commit preparation are approved, while push/PR/merge/deploy/shared migrations/live sends/weather actions remain held.
