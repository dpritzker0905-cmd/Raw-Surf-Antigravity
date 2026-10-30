# Support delivery contract — local proposal and ownership

David approved an authenticated in-app conversation plus a minimal new-public-reply email link notice. Email contains no support subject/body, attachments, personal details or authentication tokens. Email responses are not ingested. Existing preference, outbox, suppression, quota and retry behavior apply. No actual sending or shared migration is authorized.

This proposal is prepared locally for review. An attempted contract message to2866 was rejected by automatic approval review because it found no direct human authorization to message that chat. No retry, alternative transfer or ownership acknowledgement is claimed. Consumer integration remains separate until contract/ownership can be confirmed through an approved path.

## Contract

- In-app event type: `support_reply`; persisted Notification.user_id is the ticket owner, never a request-supplied recipient.
- Generic title/body only. JSON data: `{ticket_id, message_id, recipient_id}`. These are resource/account UUIDs, not access credentials. No subject, message text, sender name, attachments, URL or token in the payload. Consumer checks recipient_id against the current authenticated account and validates ticket_id before linking.
- Canonical destination `/support/tickets/<ticket UUID>`; inbox `/support`. Existing ProtectedRoute sign-in redirect represents the return path as `/auth?...&redirect=<encoded local path>`. No token in the link. Signed-in wrong accounts receive404 before any message is read; signing in does not confer access to another owner's resource.
- Public owner APIs: GET `/support/tickets`, GET `/support/tickets/{ticket_id}`, POST `/support/tickets/{ticket_id}/messages`. JWT identity establishes ownership; no caller-provided user_id selects an account. Creation reuses existing POST `/support/tickets`. Readers return public messages only, no staff profile/assignee/internal-note content or counts. New owner messages cannot set internal-note mode, priority or status.
- Staff reply idempotency: optional stable client_message_id UUID, bound to ticket/sender and exact content/note mode. Retries reuse the same public message/notification/outbox key; changed content under the same key conflicts. Legacy callers without a key retain existing behavior. Customer replies use the same request-key principle and never emit owner new-staff-reply notices.
- Existing email_messages is opt-in, including no-preference-row default false. Existing messages notification preference gates the generic in-app notice. Email queue uses message-derived dedupe key and carries only ticket UUID; it is committed atomically with the public message. Internal notes queue no owner notice/email.
- Support email is routine low-priority mail under existing rate/daily budget, suppression and retry controls, rendered separately so the CTA stays the actual ticket link. No background provider call is introduced in the request handler; existing sweeper redrives committed rows. Tests use fake senders/disposable rows only.

## File ownership

ce30: existing backend/routes/admin/support.py and AdminSupportDashboard.js; new backend/services/support_delivery.py and frontend/src/components/support/*; bounded mailer/templates.py, mailer/outbox.py and mailer/senders.py support-notice changes only, where peer status/plan shows no claim. New own fixtures/tests and this plan/log/fragment.

2866: notification consumer files, including notificationDeepLinks.js if explicitly confirmed. This proposal assigns no source transfer by itself. ce30 does not edit those files or that checkout. App.js is modified in a peer worktree; route mounting is held for its owner. apiClient.js and ProtectedRoute.js remain untouched. Auth.js support-return correction is a proposed bounded seam only after its unclaimed status is verified; no general auth redesign.

Frontend reader/route adapter can be implemented and tested independently; a mounted full-app flow is not claimed until the App.js owner integrates the route and consumer contract is confirmed. No source overlay, staging, commit, push, PR, merge, deployment, live provider or weather action is implied.

## SLA steering

David approved preserving original creation/history and response-clock origin on priority changes. Existing durations are1/4/24/72 hours, but fixed existing deadline versus recalculation from original creation using the new duration remains an explicit pending question. No priority/SLA code is changed while that distinction is unresolved. Independent delivery work proceeds.


## October30 UTC continuation — decisions and delivery outcome

David explicitly approved original-created_at plus the new priority's existing duration; this supersedes the pending SLA choice above. Implementation retains creation/history and rejects missing creation time for review instead of starting a new clock. Existing1/4/24/72-hour values preserved.

The two earlier cross-chat attempts were rejected/not delivered. New exact written human authorization in the parent ChatGPT conversation was submitted with accurate provenance (not represented as an in-admin user message). The one permitted new transmission was accepted for delivery to the existing2866 conversation at00:22UTC. This is delivery acceptance, not yet companion agreement. No alternate file relay or bypass was used.

The transmitted contract explicitly reserves notificationDeepLinks.js, NotificationsPage.js, NotificationsDrawer.js and bounded useNotificationInbox.js activation work/tests to2866, with existing other notification reservations preserved. Consumer v1 requires all three UUID fields and matching recipient; malformed/missing/mismatched support data causes no activation mark-read/navigation/close effects, including already-read rows, and no generic fallback. Existing global bulk-read/non-support behavior remains unchanged. Support is available to authenticated owner Groms through the explicit adapter prop while ToS remains in place. App.js mounting stays with its existing booking-lane owner. Await explicit companion acknowledgement; no consumer code has been imported into ce30.


## Companion acknowledgement received

Supported wait_threads readback returned the completed companion response at00:23:03UTC: contract v1 received and accepted;2866 explicitly reserves notificationDeepLinks.js, NotificationsPage.js, NotificationsDrawer.js, bounded useNotificationInbox.js activation and focused tests. It confirms three valid UUID fields, matching recipient, no invalid-payload activation effects and preserved non-support/bulk-read behavior; ce30 producer/inbox/delivery/Auth ownership and router-owner mounting remain separate. This is an actual acknowledgement, superseding the pending-ack state above. Companion reported no source edits or tests in that acknowledgement turn, so no consumer implementation or combined-tree acceptance is claimed.
