# Vision provider integration and credential investigation

Owner requests: integrate real photo analysis, tagging suggestions and board scanning; check and reuse the existing
Render OpenAI key. A delayed earlier credential answer asked for a new key; the owner resolved the conflict with
"Reuse the existing Render key". They also asked whether the earlier free AI setup was usable and how hard a later
provider change would be. No key, environment setting, public deployment or frontend publication was changed.

## Provider facts

- Render reports both OpenAI and Gemini credentials present, without displaying values.
- Two bounded synthetic-image OpenAI calls returned429 `credit_balance_exhausted`. No user photo was submitted.
- Gemini model-list request returned400; a focused diagnostic returned `API_KEY_INVALID`. Its old matching service
  uses a preview model; the Cloudinary classifier is a filename/description mock. These are not working alternatives.
- Official Gemini terms checked2026-10-15: free-tier data use/personal-information restrictions, and API clients
  likely accessed by under18s excluded. Raw Surf defines Grom accounts. Recommendation: internal synthetic tests
  only for free Gemini; do not silently switch public customer photos to it. OpenAI API vision is paid; no free-tier
  entitlement was verified for this account.

## Local implementation

`codex/openai-vision-integration` starts at9405b91fc, after the PR334 deployment receipt. OpenAI image inference
uses strict Pydantic/JSON schema output, fixed official endpoint, HTTPS or verified base64 media, bounded concurrency,
timeouts and output tokens. No raw provider errors, credentials or candidate profile metadata are returned/logged.
Default GPT-5.4 mini: official docs marked the initial GPT-4.1 mini candidate deprecated; the initial live probes
are billing diagnostics, not successful inference evidence for the final default.

Photo output supplies descriptive scene/clothing/equipment tags. Person identities are selected manually; profile
comparison is not implemented. Suggest-tags checks a named gallery item's ownership before any paid call and uses
the database item's image rather than the supplied URL. Relative media uses Render's configured public origin.
Board scans preserve ownership checks and return observed proposed attributes with `saved:false`; no inferred
attributes overwrite saved board data. The gallery modal displays descriptions and tags in light/dark/beach;
participant selectors are real buttons, and stale scan responses cannot overwrite the next photo's analysis.

## Verification

- RED: old helper returned503 for the provider-transport regression, after correcting a test setup mistake.
- Backend selection:121 passed,0 failed (39 new provider/HTTP contracts plus existing authority, transport-redaction,
  sensitive-route and floor tests). Local Python3.12 lacks declared pygrib/uvloop; this is not hosted/runtime parity.
- Frontend:4 suites/19 tests passed, including three themes, manual selection, provider failures and stale responses.
- ESLint shrink-only gate passes (existing86 errors/913 warnings); no baseline increased. Focused backend fatal lint,
  whitespace, file-size and root LOC ratchets pass. CI selector assigns the new file to estate:308 selected files;
  projection1618 passed and floor1616 retain margin2. Hosted CI has not run on this local change.
- Production build passes with the hosted workflow's `CI=false` warning policy. An initial Windows npm command
  failed on POSIX environment syntax; the equivalent Node/Craco invocation was used. A strict `CI=true` attempt
  failed on the repository's existing accessibility warning estate; the separate lint ratchet passes.
- Live success remains blocked by OpenAI quota. No deployment of this integration; no claim of real image accuracy.
  Local transport tests verify actual request/response boundaries with an offline provider, not model perception.

Adjacent existing finding: `/gallery/item/{item_id}/assign-surfer` verifies a caller-supplied photographer ID without
a JWT dependency. This integration does not change that endpoint; its manual-assignment authority needs a separate
repair. No claim is made that the broader gallery authorization backlog is closed.

Ledger1222-1224 records provider checks, local implementation and this receipt. No served weather number changes.

## Funded OpenAI retest

Owner: "Okay, let's use OpenAI. I used $10 and funded the api for testing purposes". Retain OpenAI and reuse
Render's existing key. No credential, environment setting, billing setting or deployment was changed by Codex.

Two bounded live requests from Render using `gpt-5.4-mini` succeeded; actual model `gpt-5.4-mini-2026-03-17`.
Only an in-memory512px synthetic blue graphic with a white board-shaped oval and `SURF TEST` text was sent.
Photo: strict schema validated, zero people, description and seven visual tags, finish `stop`,639 input/90 output.
Board: strict schema validated, board detected, readable `SURF`/`TEST`, brand/model null, finish `stop`,570 input/93 output.
No customer media or real credential appeared in code/output. The remaining account balance was not inspected.

This resolves the earlier quota blocker for the final model. The probe reproduced the local adapter's request
settings and equivalent Pydantic schemas; it did not execute the local adapter inside Render or exercise the
undeployed application routes. Real-photo quality, hosted CI and deployment acceptance remain pending.

## Separate qualified DEV frontend deployment

The master release task requested use of this session's working authenticated Netlify browser after its own
frontend/config parity and current weather/payment testing-window checks. Its reported qualified PR331 frontend
matches remote DEV9405b91f. This is independent of the local OpenAI integration, which remains excluded.

Direct owner confirmation in this chat: "Deploy dev at 9405b91f". Fresh `git ls-remote` confirmed full approved SHA
`9405b91fca838e9178f408f0a3d725899570d5d1`. Used the existing dev branch deployment's Options > Retry with latest
branch commit. Netlify readback: successful, branch-deploy/dev, exact approved SHA; build18:30:48Z to18:33:05Z.
No production Publish/Unlock, settings, flags, source push or Render action occurred.

Public readback18:34:12Z to18:34:13Z: DEV service-worker version9405b91f/HTTP200; production stillfc140024/HTTP200;
backend healthy at363c6d738; DEV `/map` HTML shell200. Netlify success header was screenshot-reviewed. These are
deployment identity/availability checks, not native/browser functional, checkout, weather or OpenAI acceptance.
Detailed deployment identifier and scalar receipt are retained outside tracked public docs in the session artifact.
Master owns canonical combined ledger/STATE reconciliation; this branch's local receipt is a proposal, not a DEV push.

## PR335 publication

Owner requested: "Can you open a PR for the OpenAI vision integration and make sure hosted CI passes before we
deploy it?" Fresh remote DEV remains9405b91f. Published the existing feature branch normally and opened
[PR335](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/335) against dev, attached to this task.
Description distinguishes synthetic live provider checks from undeployed endpoint/real-photo acceptance, retains
the shared-backend rollout boundary and notes the existing manual-assignment authorization backlog. Hosted checks
must pass on the final publication head; no merge, Render deployment or credential change authorized/performed.
Ledger1228-1229 records publication and PR creation. No served weather number changes.

## Final hosted verification

PR335 final published head83ca36160b862e7b964e5201d1ecc584aa10c34d: CI38799749502 succeeded. Hosted frontend430
suites/5558 tests passed; estate1618 passed/2865 skipped (projection1618 confirmed, floor1616); forecast chain2444
passed; simulation composition2658 passed/66 skipped/1 xfailed. Build, lint, imports, BOLA, floors, file size, ledger,
encoding, LOC and Lighthouse passed. Netlify preview/header/redirect checks passed; informational Pages changed
is NEUTRAL. GitHub readback reports CLEAN/MERGEABLE with18 success contexts,1 neutral,0 pending/failures.
Public preview service worker returns200/version83ca3616. This does not exercise the undeployed backend routes.

Superseded CI38799673246 and Lighthouse38799673072 on prior head1e723032a were canceled after publishing the
final head to free capacity; final-head checks were allowed to finish. The PR description now contains the actual
hosted totals and run link. A local record-only successor preserves this receipt without changing the qualified
public PR head or restarting its checks. No merge, dev push, Render deployment, credential or live flag change.

## Authorized PR335 shared rollout and endpoint smoke

Direct owner authorization: "Go ahead and merge PR #335 into dev, deploy it to the shared backend, and smoke-test
the vision features. Keep the production frontend locked and stay within the $10 testing budget."

Fresh PR335 readback remained CLEAN/MERGEABLE at checked83ca36160; all required hosted checks succeeded.
Merged at2026-10-15T20:42:37Z asf2d339e64a086537a010b158a33840babd85d5b0 with deployment-skip markers for a
controlled manual rollout. Full merge tree equals qualified83ca36160. Fresh remote DEV matched immediately before
Render action. The specific-commit dialog warned it would disable Auto-Deploy; canceled it and used Deploy latest
commit after confirming DEV, preserving service settings. Render succeeded/live on exactf2d339e64; public health
matched before/after smoke. No key, billing, flags, production publish/unlock or main change.

Four paid public HTTPS requests against deployed routes passed: analyze-photo on synthetic board graphic;
suggest-tags on the public Raw Surf logo; scan-surfboard reads SURF/TEST, unknown brand/model null and saved:false;
scan-surfboard on logo returns board_detected:false and saved:false. All output validated with deployed Pydantic
schemas. Ten additional cases passed without provider calls: three routes each missing/invalid JWT401, nonexistent
gallery/board404, invalid base64400 and private-image URL400. Total14 endpoint cases plus two matching health checks.
Used ten-minute real-signed JWTs with random synthetic subjects, kept only in memory; no normal login claim, customer
photo, persisted fixture/account/tag/board write or cleanup required. Existing cross-owner403 coverage remains hosted
test evidence, not a new persisted-owner public smoke result. No additional model calls requested after these four.

Model default GPT-5.4 mini confirmed from running environment without exposing key values. The app does not return
provider usage, so actual tokens/charges unknown. Official model pricing checked today:$0.75/M input,$4.50/M output.
A deliberately conservative400k-input+2000-output bound per request caps this run at$1.236, within$10; not an actual
charge. Earlier two successful synthetic provider probes used1209 input/183 output tokens. No account/project HARD
spending cap or auto-recharge restriction was verified/changed. Continuing shared DEV/production calls are paid and
are not constrained by this manual four-call limit; app concurrency/timeouts/output limits are not monetary budgets.

Public health20:50:34Z: matchingf2d339e64, healthy, database connected, scheduler running, L2 restore complete13466,
no restore errors and zero5xx in observed request telemetry. A startup connection-limit warning was visible in Render;
the subsequent database and readiness checks passed. This is recovery observation, not proof against future contention.
Real stored relative media, real surf photos, device/browser/manual-assignment acceptance remain unverified.

Record correction: merged STATE anchored at1224 while its valid ACTIONS prefix actually ended1229. Existing verify
accepted that older valid anchor. This receipt preserves every canonical line and moves the local anchor to the actual
new head. It does not claim the prior green ledger check proved anchor freshness. Master retains combined canonical
record reconciliation; no wholesale import of the master's older unpublished PR331 ledger fork.

Dev frontend retry succeeded with exactf2d339e64 after backend smoke. Public readback20:52:07Z-20:52:08Z:
DEV service workerf2d339e6/200, productionfc140024/200, DEV map HTML200, shared backend healthyf2d339e64 with
DB connected and L2 complete13466/no restore errors. Production publishing remained locked; no Publish/Unlock.
Private deployment receipt contains service/deployment identifiers outside this public repo. Source smoke script
contains only environment-variable names; no bearer/key value was copied. Local deployment-record branch carries
these receipts without a records-only push triggering another shared restart. No served weather number changed.
