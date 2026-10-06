# Remaining workgroups: source checkpoint

This checkpoint adds source repairs across14 audit rows. It does not complete the six
workgroups or certify deployment, scientific skill, native GPU performance or payment concurrency.
All new served-value and performance switches remain disabled. No merge or deployment occurred.

## Source behavior

- PF03: two per-process owned series slots (one page, one reserved mini), total queue<=4,
  admission/build/encoding/gzip share the response deadline. Shielded workers retain their
  permits until work really finishes. Finite values and legacy unsupported-type serialization
  are preserved; gzip negotiation avoids double compression. CPU work cannot be preempted,
  and this is not a fleet-wide admission limit. `GRID_SERIES_RESPONSE_BOUNDS=0`.
- PF04: identical non-marine raster decode work is shared, subscribers receive independent
  transfer-safe buffers, cancellation belongs to each subscriber, flush epochs refuse stale
  writes, and hot decoded tiles use recency. Marine callbacks remain per request.
  `REACT_APP_RASTER_WORK_BOUNDS` is unset; no measured heap/GPU plateau claim.
- SEC05/06: five obsolete subscription imports repaired; unsupported purchase methods rejected;
  booking membership and paid status enforced; persisted live membership/locked price used;
  unknown sessions refused and claim queues bound to stored session. Included live photo credits
  use an atomic conditional UPDATE and participate in transaction rollback. PostgreSQL/payment
  concurrency and broader media/booking quota acceptance remain open.
- SEC10/SOC01/02: correct PostgreSQL enum label, SQL boolean predicates, initialized hashtag
  users result. Compiled SQL controls do not substitute for seeded PostgreSQL acceptance.
- OS06: observation/surf-log routes bind to the JWT actor before SQL; ratings constrained1..5;
  static stats route precedes the dynamic entry route. Observation timestamp migration remains open.
- B-M01: qualified exact corners pass validity checks while measured zero remains authoritative;
  `SAMPLER_EXACT_VALIDITY=0`. Island geometry B-M02 remains open.
- OS01: actual served marine/wind instants must be aware and agree before quality rating;
  unavailable/naive/mixed provenance refuses rating. `SIM_FORECAST_SERVED_GATE=0`.
- OS02/03: qualified composer current autofill retains finite zero, clears missing values,
  derives consistent direction and refuses historical-day autofill. Labels identify modeled
  conditions and unverified time. Actual hook controls pass; mounted modal/themes, response
  ownership and durable model/spot/instant provenance remain open. Composer flag is unset.
- AS02/05: Node24.21.0 pinned across frontend/build/CI; Netlify ignore resolves repository-root
  paths from the actual frontend base, includes dependency changes and builds on uncertain refs.

## Local evidence

- Full supported Node frontend:356 suites/3689 tests pass. Production compilation accepted;
  lint ratchet remains86 pre-existing errors/917 warnings. An earlier run had one existing
  SpotHub timeout; a later sandbox run had12 Git Bash DLL initialization failures. Final
  escalated run passed without relaxed assertions or exclusions.
- All160 newly added backend controls pass together, no skips. Expanded relevant controls:
  280 pass/2 existing skips, no failures. Coverage-floor/lane/flag controls68 pass.
  Local Python is a partial environment (two declared packages absent, not a virtualenv);
  full hosted Linux lanes are still required.
- Two prior-source causal replays:82 cases,44 fail/38 pass, no errors/skips. These cover exact
  corner validity, served-time gate and social defects; current82 cases pass. PF03 actual route
  and PF04 registered protocol controls pass, but this report does not invent prior-source
  contrast or science Jacobians for those unmeasured arms.
- Tracked selector628 files:185 guards/151 chain/289 estate, two existing fastmcp exclusions,
  one existing quarantine. Projected hosted counts2360/2049/970=5379 backend. Paired passed
  floors2354/2043/968 preserve existing margins; frontend floor356/3689.
- Changed/new Python fatal lint accepted; full repository lint still reports pre-existing
  scheduler timedelta, watermark global and quarantined StringIO debt. Repository LOC ratchet
  and backend645-file/800LOC check pass. No new exclusions or production skips.

## Actual staging target and connection

Read-only provider inventory identified the separate existing **Raw Surf App Dev** project:
private weather-products bucket empty, weather_manifest_pointer empty, actual auth.users count0.
The shared Render service has only its Production environment and shared Supabase settings;
it supplies no identified isolated staging runtime credential. No provider data was changed.

`manifest_staging_canary.py` is prepared but NOT executed: explicit non-shared target preflight,
actual store/publisher/REST CAS/reader, one initial publication and a forced two-writer race,
create-only overwrite refusal, owned nonce-scoped cleanup and empty-state read-back. Eight
target refusal/acceptance controls pass. Credentials are environment names only:
STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.

On owner authorization, a Dev-scoped Supabase MCP server was registered in local Codex config.
OAuth login failed during metadata discovery before an approval page opened. A separate public
metadata request returned JSON with malformed chunk framing; both Codex and curl failed to
decode it. Provider versus network-path cause remains unknown. Current chat exposes no
Supabase tools. MCP metadata/SQL access alone does not supply the source canary's runtime key.

Follow-up2026-10-05 00:45Z: owner normal terminal reproduces the error. Read-only inventory
identifies active Avast One26.9.11171.1011; normally validated TLS certificate issuer is
Avast Web/Mail Shield Root. Current sanitized codex_apps startup logs also report response
decoding failure. [Upstream issue48504](https://github.com/openai/codex/issues/48504) reports
the same version/symptoms and a confirmed HTTPS-inspection cause on another machine.
This supersedes the unknown-cause diagnosis: local Avast interception is proven; causality
awaits a narrow endpoint-exception retest. No antivirus setting was changed by this session.

Remaining source work: SEC07/08/09, OS04/05, SCI01/02, B-M02; AS04/device/full-map acceptance,
actual staging canary, live spot-hub p95, GPU plateau and PostgreSQL financial acceptance also open.

Primary guidance: [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp),
[create-only uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[asyncio shielding](https://docs.python.org/3/library/asyncio-task.html#shielding-from-cancellation),
[supported Node releases](https://nodejs.org/en/about/previous-releases).

## Hosted acceptance observed2026-10-05 01:02Z

CI37248136689 at receiptd7b10451 completed successfully: all11jobs. Source fingerprint
comparison against4eac3550 has zero differences across runtime/backend/frontend/workflows.
Frontend356suites/3689tests; guards2360pass/66skip/1xfail, chain2049pass, estate970pass,
289selected/287produced. Combined5379backend matches projection; floors/build/lint/imports
accepted. This supersedes hosted-pending notes; cloud/device/GPU/p95/science/financial
acceptance and nine remaining source rows remain open. No new exclusions or activation.
Owner confirms the API exception saved, but API TLS still Avast-intercepted and Codex
discovery fails; MCP normal public TLS/metadata works. No repeated OAuth flow started.

### 2026-10-05 01:11Z: Dev connector OAuth recovery verified

Owner saved explicit API HTTPS path exception and approved browser OAuth. Fresh normal
TLS validation returns Google Trust Services issuer for MCP/API hosts; discovery200/exit0
each. CLI login exit0; outside-sandbox MCP list explicitly enabled/OAuth (sandbox read
cannot see the credential status and reports Unknown). Endpoint-only recovery verified.
No global antivirus disable or provider data/config writes. Current chat tool snapshot
still lacks Supabase, so reload Codex and reopen this same chat before actual scoped
tool verification. Source cloud publication canary not executed; runtime credential
path remains separate. Ledger633 records owner approval and measured recovery.
