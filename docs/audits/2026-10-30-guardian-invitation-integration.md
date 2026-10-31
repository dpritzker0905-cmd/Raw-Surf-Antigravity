# Guardian invitation recovery integration

Qualified against DEV `a8e6d0c7f071578a4200f7881f35f41b9adeb7e8` in an isolated integration branch. The owner's frozen invitation repair was transferred with all five original manifest hashes verified; only the four invitation files were copied. The historical PR644 deployment report was excluded.

Independent review and a fresh copied-source run passed all 89 guardian tests across nine suites. The new read-recovery suite is selected explicitly by CI. The actual CI report validator passed 62 synthetic positive/negative checks; removing its single inserted suite path reconstructs the original workflow exactly. Backend floor 3404 and reference 3406 are unchanged.

Fresh Chrome checks passed in light, dark and beach themes at 1280x720 and 390x844 using the copied component, shared Button and ThemeProvider. Initial failure, keyboard Retry, pending state and fictional invitation restoration passed in all six combinations without horizontal overflow. Space retry, repeated failure and successful empty recovery also passed. All browser scenarios recorded zero mutation attempts and linking callbacks. The private fixture blocks network connections. Its initial log-subscription timing issue was corrected before qualifying the browser results; production files were unaffected.

Component and new-test lint passed with zero errors/warnings. The existing full frontend lint-debt gate passed without changing its baseline. Code generation, clipboard and invitation-answer handlers match the base byte-for-byte. All original owner hashes remain unchanged. Local Node was 24.21.0; hosted CI uses the repository-pinned version and remains a separate release gate.

Release scope is frontend runtime plus its focused tests, runner, CI selection and audit notes. Backend, migrations, dependency manifests, provider configuration and weather trees remain unchanged. Candidate and actual DEV squash commits must carry `[skip render]` so the existing healthy backend remains running. GitHub CI and Netlify must run normally. Verify the new Netlify DEV artifact, Render's skipped-commit receipt and retained backend version independently; no main promotion or shared-backend restart is part of this release.

These checks establish synthetic invitation-read recovery. They do not establish live guardian identity/linking acceptance. Hosted CI, merge and deployment outcomes are recorded separately after completion.
