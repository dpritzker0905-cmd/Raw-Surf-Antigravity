# Photo and surfboard vision provider

The shared backend serves the OpenAI integration and enabled lifetime budget at `a7c038919`.
PR337/338 added the main Gallery Hub review and board Scan controls; dev frontend serves `48284a5e`.
Real uploaded-photo analysis and board scan/review/save passed in dev. Production frontend remains locked at
`fc140024`. [Current acceptance receipt](../weather-program/log/2026-10-15-vision-ui-workflows.md).

## Using the controls

- Gallery Hub: open a folder, choose AI Tag, select a photo, then Scan Photo. Review the description and visual
  tags; select known surfers manually. Analysis does not identify people or assign them automatically.
- Boards: Add/Edit Board, upload/select a photo, then Scan Surfboard. Review the observations, choose
  Use suggestions in empty fields, then explicitly Save. Entered values are preserved; dimensions are not inferred.
- Each scan is explicit and sends one image to OpenAI. Errors are displayed without automatic paid retries.

## Saved-board clue candidate

Saved-board clue candidate (not yet deployed): Gallery Hub's explicit scan can also compare observed held/ridden
boards locally with saved board details for its linked session participants. Review names, board details, shared
features and conflicts; use only the scanned photo for manual assignment before tagging. No automatic identity
match, assignment or claim. Saved board/profile data is not sent to the provider; the same single guarded photo
request covers observation. [Candidate and qualification](../weather-program/log/2026-10-16-gallery-board-clues.md).

## Historical initial smoke and current budget

The owner authorized deployment plus smoke tests within a$10 testing budget. This run was manually capped at four
paid requests;14 endpoint cases and two matching-source health checks passed, with no persistent fixtures. Tests used
short-lived signed tokens with synthetic subjects, not normal account-login flows. Exact provider token usage and
actual billing charges were not exposed by these application endpoints. At the checked GPT-5.4 mini prices of$0.75/M
input and$4.50/M output tokens, an intentionally conservative400k-input/2000-output bound per call is$1.236 for all
four calls; this is an upper bound, not an observed charge. The actual512px inputs and short outputs are much smaller.

PR336 superseded that initial manual-only limit with the deployed shared lifetime $10 app guard. The latest
readback is $5.10 reserved / $4.90 available, enabled and initialized; these are conservative reservations, not
invoices. Never reset the counter. [Budget operation and removal](OPENAI-TESTING-BUDGET.md).
Other programs/direct calls using the key are outside this app guard; account billing settings were not changed.

## Configuration

- Reuse `OPENAI_API_KEY` from the backend environment. Never copy its value into this public repository.
- Optional `OPENAI_VISION_MODEL`: defaults to `gpt-5.4-mini`, which accepts image inputs and structured outputs.
- `RENDER_EXTERNAL_URL` resolves stored relative media paths. Arbitrary image URLs must use public HTTPS.
- No automatic paid-provider fallback. A missing key or unavailable quota returns503, transport timeout504,
  invalid upstream output502, model refusal422. Provider response bodies and credentials are not exposed.
- Base64 JPEG, PNG, WebP and nonanimated GIF are verified and limited to8MiB and20million pixels.
  URL inputs are fetched by OpenAI, never by the backend. OpenAI applies its own remote-image limits.
- At most two provider calls run concurrently; a saturated caller waits at most2seconds for a slot.
  Provider request timeout45seconds, output cap2000tokens, response storage disabled.

## Public behavior

All three endpoints require a valid JWT.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/ai/analyze-photo` | Validated description, visible people count, clothing/equipment descriptions and descriptive visual tags |
| `POST /api/ai/suggest-tags` | Same analysis; if a gallery item is named, verify ownership and analyze its stored preview/original URL rather than a substituted request URL |
| `POST /api/ai/scan-surfboard` | Validate optional board ownership, return observed attributes with unknown values null; `saved:false`, so the owner reviews before saving |

Person profile candidates, names, avatars and board-owner associations are never sent to this provider.
`suggested_tags` remains an empty legacy identity-match list; `visual_tags` contains descriptive strings.
The photographer modal displays the description and tags, with known session participants selected manually.
Changing photos invalidates pending results. Existing face-identity matching remains unavailable.

## Live provider checks, 2026-10-15

Render has both `OPENAI_API_KEY` and `GEMINI_API_KEY`; presence was checked without reading values back.
Two synthetic-image OpenAI probes returned429 with `credit_balance_exhausted`. Those probes used the initial
GPT-4.1 mini candidate; after official documentation marked it deprecated, the local default was changed to
GPT-5.4 mini. After the owner reported funding the API for testing, two new calls from Render succeeded with
`gpt-5.4-mini-2026-03-17`: photo output validated with zero people and descriptive tags; board output validated,
read `SURF TEST`, and left brand/model null. Both finished with `stop`; usage was1209 input/183 output tokens.
The probe used the same endpoint, model, request settings and equivalent Pydantic output schemas as the local
adapter, with a synthetic drawing created in memory. It did not import the local adapter into Render or exercise
the undeployed HTTP routes. No customer image or credential value was copied. This establishes working billing,
image input and strict output support, not real-photo accuracy or deployment acceptance.

The old Gemini service names `gemini-2.5-flash-preview-04-17`. Its configured key is rejected by Google's
model-list endpoint with400 `INVALID_ARGUMENT` / `API_KEY_INVALID`. A replacement key alone does not qualify
the old model or its separate matching service. The Cloudinary classifier reads filenames/descriptions; it
is not a real vision service.

Gemini's unpaid terms restrict personal information and use input/output for product improvement. The Gemini
API terms also exclude API clients likely accessed by under18s; Raw Surf has Grom accounts. Do not switch the
public app to Gemini on the assumption that its free tier is suitable. Internal synthetic-image testing is a
different scope. No provider switch or credential replacement was made by this integration.

References checked2026-10-15: [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision),
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Gemini terms](https://ai.google.dev/gemini-api/terms).
