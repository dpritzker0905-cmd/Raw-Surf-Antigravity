# Competition Mode switch accessibility and save recovery

The preceding API readback repair passed a fresh forensic check: its exact one-line response change,
protected guardian sources and all 37 regression/floor checks remain valid. Original audit finding 1221
then remained in GromHQ: Competition Mode had no accessible name, no checked state and no in-flight guard.
The actual component issued two requests for rapid same-child activation in the local regression.

The runtime change is confined to the Competition Mode controls in GromHQ.js. Each remains a native
non-submit button, now exposed as a named switch with checked and busy states and visible keyboard focus.
A synchronous per-child lock prevents overlapping saves, while React state disables that child's switch
until completion. Other children remain available. Existing API URL, requested boolean, success update,
toast wording and error behavior are preserved; failure retains the saved value and permits retry.

## Verification

- Nine new regression cases failed before the change; all nine pass afterward. The combined guardian UI
  suite is 37/37, including the 28 existing recovery, label and guardian-panel cases. Tests cover stored
  null/enabled/other tiers, duplicate activation, pending state, independent two-child completion ordering,
  failure/retry with unchanged intent and names/state across all three themes.
- Six actual Chrome fixture scenarios, light/dark/beach at desktop 1280x495 and mobile 390x844. Space and
  Enter activated the switch; pending disabled only the selected child; failed saves retained checked
  state; retry succeeded. Each scenario made exactly three in-memory fictional attempts and no real
  network writes. Applied theme classes and absence of horizontal overflow were verified explicitly.
- The real component, shared UI controls, ThemeProvider and CSS were bundled. Auth/API were explicit
  fictional seams. A screenshot timeout and initially unconfirmed theme readings were corrected before
  qualifying the final matrix; they are not counted as passing theme evidence. No production family
  setting was read or changed.
- Scoped lint: zero errors; warnings decreased from three to two. Both remaining diagnostics match
  preexisting unrelated controls. New tests have zero errors/warnings. Webpack and whitespace checks pass;
  GromHQ remains 789 lines, below the 800-line cap.
- Reversing only this toggle slice reconstructs the original GromHQ.js exactly. Earlier parental readback
  and GromManage label repair hashes remain unchanged. The earlier readback forensic helper's GromHQ
  observer is now intentionally superseded by this positive UI repair, not an unexplained drift.
- The owned fixture server stopped, its OS listener is absent, and viewport was restored to unset/default.
  Mobile resizing used an explicitly coordinated window while the separate support release owner paused
  dashboard writes; that window was released before their work resumed.

Evidence remains in the private guardian-controls-recovery folder: toggle-baseline.json, toggle-final.json,
toggle-lint.json, toggle-lint-preservation.json, toggle-browser-results.json, toggle-preservation.json and
screenshots. Durable UI cases are GromHQ.competition.test.js, included in the retained guardian launcher.

The repair is local and uncommitted on the existing guardian branch. No permission, competition policy,
backend, migration, provider, security-probe, weather-source, restart or deployment change. Browser viewport
emulation is not physical-device, screen-reader or authenticated full-app acceptance.

Shared handoff, plan, memory and actual Claude coordination are updated. The separate support owner retains
its directly authorized release lane; its concrete safe-window request received Claude's actual 23:45Z
restart-safe/no-weather-hold acknowledgment, based on paused program/design rather than new live checks.
No release or migration action was performed by this guardian lane.
