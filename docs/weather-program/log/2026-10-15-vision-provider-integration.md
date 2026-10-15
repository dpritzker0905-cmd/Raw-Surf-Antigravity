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
