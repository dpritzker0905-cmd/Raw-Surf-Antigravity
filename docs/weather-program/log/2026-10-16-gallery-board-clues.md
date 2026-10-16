# Gallery Hub saved-board clues (owner request2026-10-15 ET)

UTC session checkpoint2026-10-16 00:14Z. Branch codex/gallery-board-clues from the published final vision receipt;
application source base is canonical dev48284a5e. Prior receipt commits are included without changing that source.
Trevec context tools were unavailable; used targeted rg/source reads. No served weather number or scoreboard change.

## Contract and implementation

Owner: connect surfers' saved board details to Gallery Hub photo suggestions as clues for manual review;
keep the lifetime$10 cap enabled and production frontend locked. This candidate does not identify a person from
their face/body or automatically assign/tag/claim media. It does not enable the legacy filename/Gemini matcher.

- Main Gallery Hub explicitly requests board clues with the existing /ai/suggest-tags photo scan.
- JWT-owned photo and owned parent gallery are checked before any provider attempt. Candidates come only from
  the folder's linked, owner-controlled live/booking/dispatch participants. Cancelled/unrelated participants
  and live grom-buyers are excluded. No arbitrary request-supplied surfer IDs or whole-app profile search.
- Same single guarded OpenAI request,2000output limit and existing fixed standard-tier/pinned-model reservation.
  Provider sees only the stored photo and a generic schema/prompt. Saved board/profile data stays local.
  Structured observations attach equipment to a described person position, with explicit holding/riding versus
  nearby/unknown. Low/uncertain associations and absent people cannot produce clues.
- Local comparison uses legible brand/model text, board type/fins/tail, and a small controlled set of colors and
  patterns from saved board notes. Whole phrases only; uncertain/negated or clothing/person clauses are ignored.
  No measurements inferred, no probability/identity score. Generic overlaps stay limited; ties and differences
  remain visible. Read at most201board rows, compare200; return at most20clues with explicit truncation notice.
- Review shows surfer/saved board, observed person position, each overlapping photo/saved detail and conflicts.
  Explicit Use only this photo for manual assignment narrows selection without choosing/tagging a surfer or
  making another request. Existing manual assignment remains separate. Changing photo invalidates old results.
- Missing session/saved details/no overlap is an honest empty state. Standalone old photo clients remain compatible.
  No schema migration, provider switch, credentials, cap implementation or deployment/configuration change.

## Fresh local qualification

- Initial expected RED: new module/schema absent.15 isolated SQLite/pure tests then passed; expanded final clue,
  HTTP/provider, ownership and cap run129passed/1PostgreSQL-only skipped. Real SQLite exercises own-session scope,
  cancellation/buyer exclusion, booking/dispatch membership, foreign relinks and endpoint-to-saved-row linkage.
- One guarded transport call tested; saved names/boards/substituted URL absent from provider body. Budget denial
  makes zero provider requests and no retry. No scan changes tag/claim/quiver records.
- Full frontend434suites/5578tests passed; changed integration includes explicit one-photo selection without
  assignment. Build passed via installed Craco entry point with PowerShell environment syntax; npm's inline
  NODE_OPTIONS assignment is POSIX-only. Generated build version files restored, excluded from source.
- Frontend lint debt gate passed; changed backend lint passed; CI floor contracts36passed. New19clue cases plus
  five provider/authority cases project estate1650 ->1674; floor1672 retains margin2 in workflow and staleness pin.
- Initial restricted Windows SQLite runs stalled and were interrupted; same isolated tests passed after approved
  sandbox escalation. Local Python lacks two declared packages; local results are not hosted/runtime parity.
- Actual candidate components rendered in isolated390x844frames in light/dark/beach with synthetic responses.
  Each root theme class verified, client/scroll widths390, height844, two ambiguous candidate cards, and explicit
  review button reached/clicked without provider or assignment. This proves local layout/controls, not deployed
  mobile/provider accuracy. Mock labels identify synthetic data; no customer media or live surfer assignment.

No paid requests or live writes in this feature task. Previously read enabled ledger5.10reserved/4.90available;
fresh status verification and hosted exact-head checks are recorded in subsequent append-only checkpoints.
Production frontend worker remainsfc140024. Shared backend remains on the prior capped release until a separately
qualified rollout. Source/hosted/runtime acceptance are distinct; this candidate is not declared live.

Fresh read-only Render status: effective OPENAI_TEST_BUDGET_ENABLED=true, initialized=true, limit10, reserved5.1;
available4.90 unchanged. Public production service workerfc140024 unchanged. Earlier claimed Netlify tab expired;
no publishing/settings action performed. Local test frames confirmed actual root classes light/dark/beach-mode.
