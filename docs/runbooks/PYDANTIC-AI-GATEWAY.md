# Application Gateway routing

The backend's existing OpenAI-compatible transports use Pydantic AI Gateway when
`PYDANTIC_AI_GATEWAY_API_KEY` is present. The explicit provider transport is
`openai`; the confirmed endpoint is
`https://gateway-us.pydantic.dev/proxy/openai`. The endpoint path is a routing
choice, not an inferred upstream provider. Invalid endpoint/provider settings
fail closed instead of sending the Gateway key elsewhere or falling back direct.

Credentials belong only in the ignored, untracked, non-symlink `backend/.env` or
a hosting secret manager. The downloaded Connect file was transferred by a shell
append after those checks; existing content was preserved and Windows ACLs were
restricted to the current user. No credential value belongs in this document,
source, test output, or version control. Keep `.env` untracked.

The existing OpenAI SDK and HTTPX dependencies are retained. No Pydantic AI SDK,
global agent provider, or new model dependency is needed for these existing
OpenAI-compatible call sites.

## Application call sites

- `routes/ai/ai_vision.py`: image analysis sends its existing Chat Completions
  payload to the selected transport's URL.
- `services/ai_moderation.py`: review moderation constructs its existing
  AsyncOpenAI client with the selected transport's credential and base URL.
- AI health and review-moderation status recognize Gateway credential presence
  without revealing values or fragments.

When no Gateway credential is configured, the existing direct OpenAI behavior
remains. Gateway configuration has precedence when present. Existing moderation
and vision models, output limits, no-retry behavior and durable fail-closed
spending reservations remain unchanged. The requested `gpt-6-luna` model was
used for the separate one-request setup check; it was not silently added to the
application's spending allowlist. Gemini's native transport is unchanged.

## Local launch and verification

Normal backend startup already loads `backend/.env`. The isolated Logfire launcher
excludes application credentials by default; explicitly add `--enable-gateway`
to read only Gateway variables from that file. Never interrupt an active forecast
cycle merely to reload inference routing.

```powershell
.venv/Scripts/python.exe -u backend/scripts/run_local_logfire.py --enable-gateway
```

`backend/scripts/check_gateway.py` sends exactly one synthetic request with no
SDK retries or application/customer data. Running it again is another paid
request; do not use it as a recurring health probe. The observed setup request
used `gpt-6-luna`, returned HTTP 200 and "Raw Surf Gateway test OK.", used 25
tokens, and reported a Gateway cost estimate of USD 0.0000061. A read-only query
in the selected project confirmed service PAIG's `chat gpt-6-luna` record at
2026-10-18T14:36:20.633Z with matching requested/response models.

Offline validation: 88 tests passed and one PostgreSQL-specific test skipped,
covering existing image analysis, credential transport and spending regressions
plus five local Gateway routing checks. No further paid feature calls were sent.
Local test runtime omits Linux-only uvloop and native pygrib; this result is not
hosted CI or production qualification. No merge, push, deployment, hosted secret
change, provider activation or budget opt-out was performed.
