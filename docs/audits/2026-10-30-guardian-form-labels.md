# Guardian form labels and save-action names

Following a fresh forensic recheck of the load-recovery repair, original audit finding 1230 remained:
both guardian save buttons had the accessible name `Loader2`, and neither spending label identified its input.

The runtime change is confined to GromManage.js: per-instance React useId values connect the two labels
and inputs; both save buttons use their visible action names and explicit non-submit button types.
Spending calculations, payloads, permission switches, pending state and server readback are unchanged.

Verification:

- Previous batch: four recorded file hashes match, with all 24 guardian tests passing freshly.
- New label tests: 0/4 before, 4/4 after. Combined result is 28/28. Cases cover both idle and saving action
  names, unchanged payloads, numeric field editing and four unique label/input IDs across two views.
- Six Chrome fixture scenarios: light/dark/beach at desktop 1440x1000 and mobile 390x844. Clicking each
  visible label focused its own field; both save names were correct; no horizontal overflow. The real
  component, shared controls, ThemeProvider and CSS were used with fictional auth/API. Four reads and
  zero writes were observed in each case. No real family data or settings were accessed.
- Scoped ESLint is now zero errors and zero warnings, removing the two preexisting label warnings.
  Webpack compilation and whitespace checks pass. The fixture listener stopped and is absent from the
  OS listener table; the temporary browser viewport was reset.
- Reversing only this slice's import, ID, label and button-name edits reconstructs the preceding verified
  GromManage.js SHA256 byte for byte. The previous recovery test file is unchanged. This establishes
  preservation of the preceding load/error/retry and child/parent request-isolation repair.

Source remains local and uncommitted on `codex/guardian-controls-load-recovery-20261030` at base fb2d2e5.
No backend, spending policy, migration, provider configuration, security probe, restart, weather edit,
commit, push or deployment. Browser emulation is not physical-device or screen-reader acceptance.

Private evidence remains under the existing session's `guardian-controls-recovery/`: labels-baseline.json,
labels-final.json, labels-lint.json, labels-browser-results.json, labels-preservation.json and six screenshots.
The new durable tests are in GromManage.labels.test.js and included in the retained guardian test launcher.
Shared repair handoff, private plan, memory and actual Claude coordination record the outcome.
