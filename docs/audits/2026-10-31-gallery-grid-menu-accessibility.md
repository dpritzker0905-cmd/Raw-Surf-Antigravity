# GalleryGrid item-menu accessibility — 2026-10-31

Current-DEV candidate: `codex/gallery-menu-a11y-20261031`, based on `2de2c729549a5661974491a1bd2f2a9bc15bb9d5`. The historical 2866 branch is preserved and is not merged wholesale. The pre-repair GalleryGrid Git blob exactly matched DEV: `a323ae5b47b7bacfc6ff5666585734a1d219666a`.

## Repair

Only GalleryGrid.js and its adjacent GalleryGrid.test.js change runtime/test behavior. Native Edit and Delete names replace icon names; menu icons are decorative. The trigger exposes expanded/controls state, stays visible under keyboard focus, and sits above the dismissal overlay. Opening focuses the first enabled action (or trigger when all are disabled); Escape and outside dismissal return focus. Edit still receives the item, Delete its ID, disabled deletion remains inert, and bulk selection/detail callbacks are preserved. Native buttons remain native buttons; no incomplete ARIA menu model is introduced.

## Verification

- True behavioral baseline: 12 failures and 3 passes among the original 15 regression cases. Final focused suite: 21/21, zero failed/pending, on Node 24.22.1 in this current-DEV candidate.
- Browser: 6/6 isolated component cases, light/dark/beach at 390 and 1280 pixels, with opposite-size resize. Actual ThemeProvider and Tailwind/index.css; explicit card-token assertions (100%, 12%, 5%) and root-class checks. Native Tab/Enter/Space, Escape/refocus, actual overlay/trigger hit-testing, outside click, reopen, callback arguments and disabled deletion pass. External requests are blocked; media and edit/delete callbacks are fake. No customer deletion or provider mutation occurs.
- Source SHA-256 before/after browser execution is pinned in browser-results.json. Touched lint: zero errors, six inherited component warnings; test zero findings. Full frontend lint ratchet passes with inherited 86 errors / 901 warnings.
- Isolated component compilation passed. Production build and hosted exact-candidate checks are recorded separately below when complete; none is inferred from component tests.

## Harness corrections and permission boundary

Initial CRA discovery and NODE_ENV errors preceded behavioral testing. Original sandbox Chrome loopback navigation failed ERR_NETWORK_ACCESS_DENIED. David directly requested approved permissions; the same loopback fixture subsequently ran with accepted require_escalated approval. No denied request was rerouted through another actor/profile/transport. Initial mobile opacity assertion incorrectly required 1.0 rather than intentional 0.8. An early beach fixture used the wrong class; it was replaced by the actual ThemeProvider. The final fixture also retains theme selectors during scoped Tailwind compilation and asserts actual computed card tokens. Earlier preliminary six-case results are superseded by the source-bound provider/CSS run.

## Evidence and release limits

Local scratch evidence: `C:/Users/David/.codex/visualizations/2026/10/29/01a188b7-7c1a-7e20-baaa-2c32d5631eb1/gallery-menu-20261031/`: verify.cjs, browser-results.json, unit-candidate.json, lint-results.json, candidate-full-lint.log, candidate-build.log, compilation receipts, screenshots and reviewed patch. These files contain synthetic data only.

This is browser viewport/component qualification, not physical-device, hosted/full-App or provider proof. Existing broad E2E does not automatically prove Gallery menu coverage. DEV merge requires exact-candidate review and full-green checks with explicit skip accounting. No main promotion, migrations, shared primitives, other UX worker files, live data, provider/config changes, or weather source/runtime/log/ledger changes are included.

## Frozen source

- `frontend/src/components/GalleryGrid.js`: `64041955c3227464a5935bb804681735dac965ac54f28469044fe37cd2353fe4`
- `frontend/src/components/GalleryGrid.test.js`: `d5ca363570fe1a59b8d57932180fd80ab9f883d9602980a4ebf51718982cd6e5`

## Production-build setting

The first local production build used CI=true and exited 1 because inherited lint warnings were promoted to errors. Current DEV .github/workflows/ci.yml lines 217-222 explicitly set CI=false for Build frontend; the normal CI-compatible rerun is recorded in candidate-build-standard.log. No tracked lint/build configuration or warning baseline was changed.

## Current-DEV integration checkpoint

The standard production build (CI=false, matching the repository workflow) exited 0 on pinned Node 24.22.1, with inherited warnings retained. Normal commit hooks passed for source checkpoint 84b0860c117032bfc7a60095818e3c00e7bc2e3b. Fresh remote DEV readback remains 2de2c729549a5661974491a1bd2f2a9bc15bb9d5. Source identities still match the frozen 21-test and six-browser-case receipts. Draft PR/hosted checks and any preview acceptance are separate pending release gates; no merge or deployment is claimed.
