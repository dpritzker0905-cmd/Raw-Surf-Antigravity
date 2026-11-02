# Guardian settings load recovery

The next unrepaired Priority 2 family workflow finding was the initial-load failure in GromManage
(original feature-audit continuation, guardian settings section). If either activity or spending read failed,
the page rendered initialized or previously selected controls and allowed saving them. Deferred responses
for an earlier child or parent could also replace the current selection's settings.

Only `frontend/src/components/GromManage.js` changes at runtime. A session keyed by child and parent starts
with loading state, ignores abandoned read completions, and exposes editing only after both reads succeed.
Failed reads show an accessible, theme-aware error with Retry and Back actions. Retry performs reads only.
Stored zero spending values now render as zero rather than an empty field. Existing permission defaults,
switches, save payloads, backend rules, server-confirmed control readback and ignored-key warnings remain.

## Evidence

- Qualified original component: 1/10 new recovery checks passed; 9 failed for missing error/retry recovery
  and stale child/parent responses. The retained guardian panel suite passed all 10 cases.
- Repaired component: 14/14 recovery/retained-save checks plus the 10 unchanged guardian panel cases passed.
  Final reviewed source was rerun successfully. API/auth/router hooks are explicit fixture seams; this is
  normal read/retry behavior, not an authentication or child-access security test.
- Actual Chrome local fixture: six scenarios, light/dark/beach at 1440x1000 and 390x844. Each hid editing on
  failure, restored saved controls on retry, reported four fictional reads and zero writes, and had no
  horizontal overflow on the error screen. Enter activated Retry. Real component, shared UI controls,
  ThemeProvider, Tailwind configuration and stylesheet were bundled; auth/API data were fictional.
- Scoped repository ESLint: zero errors, two preexisting spending-input label warnings; the new test has
  zero errors or warnings. Whitespace check passed. Local Webpack compilation passed. No full-app build,
  hosted CI, physical-device, assistive-technology, or deployed guardian acceptance is claimed.
- The owned loopback server stopped and the OS listener table showed no listener at its former port.

The preceding support-email batch was freshly rechecked: 43 isolated API/outbox cases and 144 fake-provider
mailer/template/webhook tests passed. All four runtime source hashes match the qualified live-source manifest.
Stored creation and staff-reply Gmail evidence remains consistent with distinct outbox/provider IDs,
first-attempt delivery, SPF/DKIM/DMARC PASS and the correct authenticated ticket destination. No additional
live email was sent during this recheck.

Private receipts, screenshots, isolated launchers, source hashes and JSON results are in the session's
`guardian-controls-recovery/` and `support-email-delivery/forensic-recheck-20261030/` evidence folders.
The standalone component tests are retained in `GromManage.recovery.test.js`; run them with the frontend's
normal Jest entry or the sibling evidence launcher using an existing frontend dependency directory.

## Ownership and release boundary

Branch `codex/guardian-controls-load-recovery-20261030` starts at merged DEV
`fb2d2e5def5ec8bcea1b2a39918f7740ba034a90`. The primary checkout and Claude's existing control implementation
were not overlaid. Claude's actual weather chat was notified that this is an isolated guardian-only repair.
The shared handoff, private plan and memory are updated. No backend/configuration/migration/provider changes,
security probes, weather edits, restart, commit, push, merge or deployment occurred for this repair.

A separately reproduced support creation retry gap after staff priority/tag edits was handed to its
independently authorized owner in another isolated lane. It is not included here; no support schema or
financial/product policy was changed by the guardian repair.
