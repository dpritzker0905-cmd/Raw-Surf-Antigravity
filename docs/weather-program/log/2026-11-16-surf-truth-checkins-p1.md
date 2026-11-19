# 2026-11-16 · surf-truth-checkins · T1 crowd truth, P1: blind, scale-labelled observations

Task (director, for David 2026-11-16 23:19 EST, per the research lead's T1 brief in the senior-research-lead log,
03:28Z section): turn the app's own check-ins and reports into licence-clean breaking-height truth. P1 = blind
observation; P2 gamification, P3 privacy, P4 aggregate export follow as their own PRs.

## Measured before building (read-only, Supabase "Raw Surf App Antigravity", 2026-11-16)

| table | rows | last write | rows with a height |
|---|---|---|---|
| check_ins | 9 | 2026-04-18 | 6 (free text, no scale) |
| surf_reports | 4 | 2026-03-19 | 3 (free text, no scale) |
| condition_reports | 189 | 2026-06-22 | 3 (`wave_height_ft`, no scale) |
| surf_passport_checkins | 9 | 2026-04-03 | 0 |

Why so few: `POST /api/check-in` and `POST /api/surf-reports` declared `user_id` as a REQUIRED query parameter,
and the client never sends one (it posts the body; identity is the JWT), so every call was a 422. There is no legacy
truth to import: the stream starts clean with this PR.

Also found: `POST /api/condition-reports` had NO authentication (anyone could post a report, a story and a feed post
as any photographer). The map go-live route (`/photographers/{id}/go-live`) writes no condition report at all, so it
has no parent row for an observation (follow-up, not fixed here).

## What P1 does

- New private tables `surf_observations` and `observation_media` (RLS on, anon/authenticated revoked, the
  strava_oauth_states pattern). One observation per parent report (DB unique on surface + ref_id).
- `POST /api/surf-observations`: the client sends only what was seen (number or legacy range, unit, scale,
  typical vs sets) and the entry screen. The server sets `source='observed'`, `forecast_shown_before` (from its audit
  of the screen: check-in and go-live modals show no forecast -> false; the spot page shows forecast rows -> TRUE, so
  those reports are recorded as not blind), converts to face metres (Hawaiian x2, Caldwell 2007), computes the
  region default scale (Hawaiian in Hawaii, face elsewhere) and whether the user overrode it, GPS distance to the
  spot, and the photo's hash and EXIF position/age as read by the upload route from the bytes. Unknown fields are
  refused (422), so `source` etc. cannot even be attempted.
- `/upload/conditions` records the server's own hash + EXIF of each go-live photo.
- Fixes: `/check-in` and `/surf-reports` take identity from the JWT (a sent `user_id` must still match);
  `/condition-reports` now requires JWT identity; go-live returns `condition_report_id`.
- UI: one shared `BlindHeightInput` (native radio groups in fieldsets, labelled number input, scale named in words,
  ✓ marks selection; semantic tokens; beach-mode field per the global beach input rule). In CheckInModal (also moved
  off hardcoded zinc to theme tokens), the duty-station ConditionsModal, and the spot page's report modal.

## Evidence

- Backend: `tests/test_surf_observations.py`, 34 pass (real HTTP + JWT, SQLite). Mutations: dropping
  `extra="forbid"` fails 4 tests; Hawaiian factor 1.0 fails 3.
- Frontend: `BlindHeightInput.test.js` 7 pass; touched suites 82/82; eslint ratchet passes (a11y debt -6);
  `craco build` exit 0. Three-theme render at 375 px: shared notes `t1-p1-blind-observation/`.
- LongCat (paid, one call): 5 findings, none needing code (screen->surface is 1:1 and the parent row fixes the
  surface; EXIF is forgeable by design and documented as a consistency check; no per-spot scale field exists; the
  daily window is UTC). Recorded in the PR.

## Limits

- `forecast_shown_before` is per entry screen, not per impression: a user may have seen a forecast elsewhere earlier.
- EXIF is read by the server but lives in the file; it catches carelessness and reuse, not a determined forger.
- No XP is paid (P2). Photos are still stored with EXIF in the PUBLIC conditions bucket (P3 strips/blurs).
- Nothing here changes a served number; no SCOREBOARD row.

## 00:20Z Schema aligned with the research lead's P4 spec (before merge)

The research lead (owner of the latent-truth aggregator, David 23:23 EST) sent the fields P1 must store. Added, all
server-set: `observer_role` ('anchor' from the `SURF_TRUTH_ANCHOR_IDS` allowlist of profile ids, else photographer /
surfer from the profile role), `flow` ('blind_v1'), `observed_at_device` (the device clock, kept as a claim; flag
`device_clock_skew` beyond 15 min), and `normalization_version` ('norm_v1', replacing `scale_version`). Clients cannot
send `flow` or `observer_role` (422). Tests 34 -> 37.

Deliberately NOT in P1, by agreement of roles: the typical->H1/10 factor, scale and set uncertainty (log-sd),
'unknown' scale for legacy rows, censored intervals, the size-dependent bias and the spatial-consensus flag are model
terms or derived flags of the OFFLINE aggregator (P4), which reads the raw columns. `face_m` stays "face metres in the
declared scale and sense". Consent / blur fields are P3. The analysis-only forecast snapshot is better joined offline
from archived runs than computed on the 1-CPU box at write time.

## 00:50Z Advisor's three conditions (PASS WITH LIMITS at 526f5659a) closed

1. Anchor: the height field's placeholder was "e.g. 3", a number shown before a blind answer. Now "height". Found the
   same kind of anchor in two more places and removed them too: the Hawaiian help text ("a 6 ft Hawaiian wave has a
   12 ft face") and the go-live Spot Notes placeholder ("Clean 3-4ft sets..."). A Jest test now asserts that the
   input region shows no digit before the answer (the legacy range labels appear only on request).
2. The POST reply returned the quality flags, which would tell anyone gaming the checks which one fired. It now
   returns only `id`, `height_scale` and `scale_default`; flags, face_m and provenance verdicts stay server-side
   (test).
3. Parent-less check-in observations (today's check-in already existed): the spot is the client's word, there is no
   freshness check and the per-report unique index cannot apply. They are now flagged `no_parent` so P4 can drop or
   down-weight them (test).

Backend 37 -> 39 tests, frontend 7 -> 8; floor fragments updated.

Limits the advisor asked to state (not conditions):
- Fixing the 422s REVIVES two routes dead since March/April: `POST /check-in` again writes `check_ins` rows and
  updates `user_streaks` (current/longest streak, total check-ins); `POST /surf-reports` again writes `surf_reports`,
  which the spot page's public "today's reports" list shows to other users.
- `surf_observations` and `observation_media` are created by the startup bootstrap on the shared database at the
  next deploy.
- A range is scored at the geometric centre of its interval and "8ft+" at its floor; 'typical' vs 'sets' is stored
  but not mapped to the chain's H1/10. Both are P4's; every analysis must keep `input_kind` and `set_or_avg`.
- The daily cap is a count then an insert, so two concurrent posts can pass 20. Harmless at this volume.
- For David (not blocking): the private rows store each user's device position and the photo's EXIF position, and
  go-live photos still sit in the public `conditions` bucket with EXIF until P3.

## 01:05Z Research lead confirmed the three choices; two adds

Confirmed: face_m in the declared scale and sense (display column; P4 fits from the raw columns); no 'unknown' in
blind_v1 (legacy goes in later as flow='legacy_*', never truth); forecast snapshot joined offline to the run CURRENT at
received_at. Added `client_build` (the deploy's git short hash from `src/buildVersion.js`, a claim, shape-checked) and a
norm_v1 docstring: face_m_low/high are only the entry's own range; "8ft+" is right-censored (high null).
`entry_screen` was already stored (checkin_modal | golive_conditions_modal | spot_report_modal). Advisor note answered:
grom parents count as photographers because /condition-reports admits the same role set. `SURF_TRUTH_ANCHOR_IDS` is
unset until David sets it on the service, so every row is non-anchor until then. Tests 39 -> 40.

## 01:40Z P2 built locally (stacked on P1; PR opens after P1 merges)

XP for blind observations rewards quality, never agreement (`services/observation_rewards.py`, amounts in
`services/xp.py` XP_RULES, granted only through `grant_xp`):
- Base 5 XP only past the quality gate: a parent report, no duplicate photo, no far GPS / far or stale EXIF / clock
  skew / unverified media, some location evidence (GPS within 10 km or EXIF within 1 km), and a device id.
- Caps on paying observations: 3 per account per UTC day, 1 per account per spot-day, 3 per device per day across
  accounts, 30 per spot-day. Capped rows are kept as truth and pay nothing.
- Random audit: 1 in 10 gated rows is held until an admin passes it (`/api/admin/surf-observations/audits`,
  `get_current_admin`; no self-audit; the queue shows no forecast).
- Bonuses (corroborated +5, first-of-day +5, quiet-spot +10) pay only once another ACCOUNT on another DEVICE files a
  gated observation at the same spot within 90 min. Corroboration is presence, not agreement: heights never compared.
- The client sends a random install id (`deviceId.js`, localStorage; survives sign-out by design); the server keeps
  only its sha256.
Evidence: 15 reward tests + P1's 40 + the XP single-path guard = 64 pass. Mutations: a gate that reads the height
fails the value-blind test; corroboration that requires agreement fails the corroboration test. Frontend 10 pass.

## 10:30Z Anchors A built locally (stacked on P2): table + append-only log

David's yes (09:16 EST, research lead's session) to anchor observers, with an admin area to control and monitor
them; the director split it into small PRs. A = `surf_truth_anchors` (active / probation / suspended) and
`surf_truth_anchor_events` (append-only: a Postgres trigger refuses UPDATE/DELETE), both RLS-locked. One service,
`services/surf_truth_anchors.set_status`, writes the row and the log line together with the acting admin and a
required reason. `observer_role` now reads the table: 'anchor' only while ACTIVE, 'anchor_probation' while on
probation, the ordinary role when suspended. The `SURF_TRUTH_ANCHOR_IDS` env var is gone (it was never set, so no
row was ever recorded as an anchor). 9 tests; P1 + P2 suites updated; 63 pass. Next: API, admin UI, model.

## 18:50Z Advisor conditions on #980 (three) and #981 (one) closed

#980: the audit list returns no height, unit, range, scale or typical/sets (test); kill switch `SURF_OBS_XP` via
runtime_flags (default on; '0' marks new rows 'paused', never paid later, no corroboration; tests); what XP is worth
stated on the PR: levels, badges, leaderboards and profile/roster display only, not redeemable, not in dispatch
priority (`dispatch/schemas.py`), so the client-claim gate risks leaderboard fairness only; tighten to
server-verified photo evidence before XP ever becomes redeemable.
#981: the log is now really append-only: service_role gets SELECT, INSERT only; row-level UPDATE/DELETE trigger plus a
statement-level BEFORE TRUNCATE trigger; the docstring says exactly what remains (an owner acting outside the app
could drop the triggers). Owed after deploy: UPDATE, DELETE and TRUNCATE each attempted in a rolled-back
transaction must raise. Pushed as a merge of #980's branch (no history rewrite).

## 19:10Z Anchors B built locally (stacked on anchors A): admin API + append-only admin action log

`/api/admin/surf-truth/anchors` (list, with 30-day observation counts), `.../anchors/{profile_id}/status` (status +
required reason; writes the anchor event log AND the admin action log in one transaction; self-appointment allowed
and marked), `.../anchors/{profile_id}/events`, `/api/admin/surf-truth/actions`. Strict JWT + admin role on all.
New `surf_truth_admin_actions`, locked like the anchor log (RLS, SELECT/INSERT grant, UPDATE/DELETE/TRUNCATE
triggers). P2's audit verdicts now also write it. No admin body can carry a reported number (extra='forbid', no
height field; tested). 14 tests; all surf-truth suites 80 pass; route-identity check: none new.

## 21:40Z Decision: no second-admin rule for anchor promotion

David, 2026-11-16 16:34 EST (typed in the director's session): "I dont think its an issue for any admin to promote someone to an anchor. We can always change the admin rights levels later." Any admin may make anyone an active anchor; self-appointment stays logged with self:true.

## 22:30Z Anchors C: the admin "Surf truth" area

New top-level admin tab "Surf Truth" (`UnifiedAdminConsole`) with six Radix tabs (role=tablist, arrow keys; scrolls
sideways on a phone): Anchors (list, status changes through one dialog with a required reason, the admin action log),
Observers (per-observer counts; "Make anchor" uses the same audited dialog), Coverage (per-spot counts and totals),
Quality queue (the audit sample: photo, place, time, flags; pass/fail), Model and Consent/privacy (state what is TRUE
today and which part builds the rest; no placeholder numbers). Two read-only admin endpoints back Observers and
Coverage (`routes/surf_data/surf_truth_monitor.py`). No view or response shows a reported height (tested both ends).
Shared ui primitives + semantic tokens only. Rendered at 375 px in light, dark and beach mode (notes:
`t1-p1-blind-observation/admin-surf-truth-3-themes-375px.jpg`); the audit card's phone stacking was adjusted after
that render and not re-rendered. Tests: backend 6, frontend 4 (90 admin Jest pass); lint ratchet passes.

## 23:20Z T1 P4 export built (stacked on anchors C): private, pseudonymized rows for the offline fit

The research lead recommended I build both the export and the fit, with the research lead reviewing the fit before
any run (builder and checker kept apart); the director assigns. The export is the safe next step either way.
`POST /api/admin/surf-truth/export` (admin, logged) writes `surf-truth/exports/<date>/<run>.jsonl` + manifest to the
PRIVATE `weather-products` bucket (create-only), the bucket #948's private rows use. Rows carry the raw entry, scale,
typical/sets, flags, distances/ages, quality and XP status, role, anchor status AT received_at (event log), the spot
(public id, coordinates, region) and received_at. Identities only as HMAC-SHA256 pseudonyms under the env var
`SURF_TRUTH_EXPORT_KEY` (fails closed without it, 503). Never exported: names, profile ids, device or photo positions,
photo URLs, face_m. Only flow='blind_v1'. Correction to my own pre-registration wording: the export is ROW-LEVEL
(pseudonymized, private), not aggregate; "aggregate-only" applies to anything shown outside private storage.
7 tests (one mutation: a pseudonym returning the raw id fails the no-identity test); surf-truth suites 96 pass.
Owed by David: set SURF_TRUTH_EXPORT_KEY (>= 32 random bytes) on the Render service before the first export.

## 2026-11-16 22:59Z Clock correction, and the advisor's limits on #990 (header read from `date -u`)

CLOCK CORRECTION (append-only). Every earlier "HH:MMZ" header in this file was ESTIMATED, not read from a clock; at
least one ran ahead ("23:20Z": the export commit 06a1c1a70 is 2026-11-16 22:44Z). The authoritative time of every
section is its git commit time. From here on, header times are read from `date -u`.

#990 limits taken (advisor 22:52Z by the advisor's clock):
- received_at is exported rounded down to the minute; the module header now says the export is PERSONAL DATA:
  pseudonymous, not anonymous (spot + minute + stable key re-identifies against the database).
- Key rotation re-keys every observer; the manifest records a key fingerprint so a fit never mixes two keys, and a
  rotation means a full re-export.
- `since` is exposed on the route; anchor status is looked up per profile (events indexed by profile).
- Orphans: data object, then manifest, then log line. The fit reads only manifested exports; an orphan is ignored.

PROPOSED retention and deletion rule, for David with the consent question (P3 builds it; no real export runs before
his answer): keep at most the 3 newest exports; any account deletion triggers, within 7 days, a fresh export and the
removal of every older export and every orphan; a key rotation removes all exports made under the old key. Standing
item, also David's: the service-role key the fit will use in Actions should be restricted to a GitHub Environment.

## 2026-11-17 02:29Z CLOCK CORRECTION (from `date -u`; append-only)

The header '18:50Z Advisor conditions on #980 (three) and #981 (one) closed' ran AHEAD of the clock: it was committed at 2026-11-16T18:30:13Z, 20 minutes before the time it
states. It was an estimate, not a clock reading (LESSONS L-P10). Every earlier "HH:MMZ" header in this lane's logs was
estimated; their authoritative times are their git commit times. Since 2026-11-16 ~22:56Z the lane reads `date -u`.

## 2026-11-17 02:46Z CLOCK CORRECTION (from `date -u`; append-only)

The header '19:10Z Anchors B built locally (stacked on anchors A): admin API + append-only admin action log' ran AHEAD of the clock: it was committed at 2026-11-16T18:36:17Z, 34 minutes before the time it states (an estimate; LESSONS L-P10).

## 2026-11-17 02:51Z CLOCK CORRECTION (from `date -u`; append-only)

The header '22:30Z Anchors C: the admin "Surf truth" area' ran AHEAD of the clock: it was committed at 2026-11-16T22:09:00Z, 21 minutes before the time it states (an estimate; LESSONS L-P10).

## 2026-11-17 02:57Z CLOCK CORRECTION (from `date -u`; append-only)

The header '23:20Z T1 P4 export built (stacked on anchors C): private, pseudonymized rows for the offline fit' ran AHEAD of the clock: it was committed at 2026-11-16T22:46:20Z, 34 minutes before the time it states (an estimate; LESSONS L-P10).

## 2026-11-18 01:04Z Post-deploy check: the two surf-truth logs refuse UPDATE, DELETE and TRUNCATE in production (header from `date -u`)

Owed since anchors A/B. Production Supabase (the Antigravity project), read-only except one block that rolls itself back:
- Catalog: `surf_truth_anchor_events` and `surf_truth_admin_actions` exist with RLS on, 2 non-internal triggers each, and
  `service_role` holds INSERT but not UPDATE on both.
- Behaviour, as `postgres` (the table OWNER, so grants do not apply and only the triggers stand): one DO block inserted
  a synthetic row into each table, then tried UPDATE, DELETE and TRUNCATE. All six were refused with
  "<table> is append-only"; the inserts succeeded. The block then raised, which rolled back everything; a follow-up
  query found 0 probe rows in either table.
- Positive control: the inserts in the same block succeeded, so the refusals are the triggers, not a broken table.
## 2026-11-18 01:37Z T1 P3 (part 1): a deletion request now reaches the surf-truth tables, and the GDPR routes run at all (header from the UTC clock)

Found while starting P3: `/compliance/delete-my-data` anonymizes the profile instead of deleting it, so the CASCADE
foreign keys on `surf_observations` / `observation_media` / `surf_truth_anchors` never fire. A deleted account's
observations (device GPS, photo EXIF positions, install-id hash) survived. Worse, BOTH GDPR routes raised before
finishing: the deletion on `Follow.followed_id` (the column is `following_id`), the admin export on that, on
`Review.reviewed_id` (`reviewee_id`) and on `Booking.surfer_id` (no such column; `creator_id`). And six of the
profile fields the deletion "cleared" are not columns (phone, instagram_handle, website, board_description,
is_active, is_deleted): those assignments silently did nothing, and the real home/on-demand positions were never
cleared.

Fixed (`services/surf_truth_erasure.py` + `routes/compliance_pkg/gdpr.py`): the deletion erases the user's
observations, photo-fact rows and anchor row in the same transaction, un-attributes their audits of others (the
verdict stays), and clears the real social-URL and location columns (a rename now raises instead of silently
skipping). The admin export includes the user's surf-truth rows. 4 tests run the real handlers on SQLite; mutation:
dropping the erasure call fails the route test.

NOT done, for David: (1) the append-only anchor-event and admin-action logs keep the profile id and admin reasons
after a deletion: legal call; (2) exports already in private storage (pseudonymous) wait on the retention rule;
(3) Profile has no deleted flag and the auth account is not removed, so `is_deleted` never existed: a design
question for the account owners, not this lane; (4) the report photo stays in the `conditions` bucket with its
report (owned by those features).
## 2026-11-18 02:08Z T1 P3 (part 2): opt-in consent, snapshotted on each report, enforced by the export (header from the UTC clock)

David chose the consent flag next. Built so it needs no legal decision to be safe, and so counsel can change the
words without a release:
- `surf_truth_consent_events` (new, private, append-only by trigger like the anchor log): every grant and withdrawal
  with the wording version and screen. The newest event is the choice in force; NO event means NO (opt-in). Kept
  after an account deletion as the proof of consent (like ToS acknowledgements); included in the GDPR export.
- `GET/PUT /api/surf-observations/consent` (strict JWT; the body takes only `granted` and a known `source`; the
  server sets the version). The wording is served from `services/surf_truth_consent.py`: an ENGINEERING DRAFT
  (`draft-2026-11-18`), not reviewed by counsel.
- Each observation records the consent in force when received (`consent_training`, `consent_version`; NULL on
  older rows = no).
- The export keeps a row only if its observer had opted in when it was made AND is still opted in at export, so a
  withdrawal stops every later export from using any of their rows. The row schema is unchanged (the fit's
  contract); the manifest states the rule and how many rows it excluded.
- UI: one native checkbox at the foot of the blind-height form on all three report screens, wording from the
  server, state in words ("On"/"Off"), hidden if the server cannot answer so a report is never blocked.

Tests: backend +7 (opt-in default and append-only history; the body cannot set version, owner or source; the
snapshot; the export's then-and-now rule), Jest +4. Mutation: an export without the consent filter fails the
then-and-now test. 110 surf-truth backend tests and 89 Jest tests in the touched trees pass.

For David: the wording (`CONSENT_TITLE`/`CONSENT_TEXT`) and whether internal forecast VALIDATION, as opposed to
training, needs this consent at all. Today the export treats both as needing it (the safe default).
## 2026-11-18 03:03Z Admin: the Surf Forecast panel tells the truth about flags (header from the UTC clock)

David asked for a comprehensive, working admin for the surf sim's logic. A read-only survey of the admin found the
Surf Forecast panel (Admin > Surf Forecast) had fallen behind D-065. Fixed here, no served number moves:
- Each flag row now shows its real value (numeric settings such as SURF_REFRACTION_KR 0.873 were shown as on/off),
  its source (environment / guardrail manifest / code default) and, when the guardrail set it, the guardrail's
  reason, who and when, plus the fix version that would clear an automatic off. Flags read only by a workflow lane
  are marked: the serve box's copy says nothing about the lane's. The manifest's own health is shown (read time,
  entries, or the read error).
- The panel's text said flags are env vars and never a silent toggle; it now explains D-065 precedence.
- Search, and groups: set by guardrail / changed from default / guarded / numeric settings.
- A failed blob read is shown as a failure (it rendered as "-" or 0); the regional-tile-first and Gulf-fill
  counters the backend already returned are shown.
- Deleting a user condition report is confirmed in a themed dialog (was window.confirm) and written to admin_logs
  (was only a server log line).
- Themes and ARIA: semantic tokens with meaning in words (hardcoded emerald/amber/red removed), table headers with
  scope, a unique label per delete button; the console's section bar is a labelled nav with aria-current, and its
  title colour no longer hardcodes yellow in light and beach.
- The size climatology read moved off the event loop at both call sites (a blocking L2 read on the 1-CPU box).
Backend: `services/admin_flag_board.py` builds the rows; `surf_forecast.py` stays under the 800-line cap (798).
Tests: backend +9 (kinds, guardrail entry, lane marking, every registered flag has a row, the deletion is logged),
Jest +5 (the panel had none). 131 related backend and 438 admin Jest tests pass; lint ratchet passes (debt down).
NOT checked in a browser: the admin needs an admin login.
Next, from the same survey (each its own PR): data and ingest health (/api/health/data), a per-spot geometry and
rating inspector, guardrail run history and the owner's re-enable, the surf-truth export button and anchor history.
## 2026-11-18 03:15Z Admin: data and ingest health in the Surf Forecast panel (header from the UTC clock)

David chose the health view next. Admin > Surf Forecast now opens with "Data and ingest health", which reads
`/api/health/data`: the report the external uptime monitor polls, computed from the SERVED manifest on read (no
database, no forecast fetch), so it is cheap enough for the panel's 60-second refresh. It shows the overall verdict
in words, the freshest run's age, the manifest's writer, every alert, and per lane (GFS/ICON/EURO x
marine/wind/weather, plus the precomputed ratings): verdict, newest-run age, lag behind the freshest lane, reach
ahead, the model cycle's age and status, and source. A critical report arrives as HTTP 503; its body is still the
report and is shown as an alert, not as a load failure. The report now carries the limits it judged against
(`thresholds`: stale and critical hours, minimum reach per model, the EURO 06/18Z reach, the ratings limits), so
the view states what "stale" means without re-deriving environment overrides.
Tests: backend +1 (thresholds, including an override), Jest +4 (words not colours, the 503 path, unreachable, the
limits). 150 data-health backend and 100 admin Jest tests pass; lint ratchet passes. Not checked in a browser (admin
login). Stacked on #1029.
## 2026-11-18 03:33Z Admin: a read-only spot inspector in the Surf Forecast panel (header from the UTC clock)

David chose the spot inspector next. Admin > Surf Forecast > Spot inspector: search a spot, then see the catalogue
row, the geometry the chain uses there (`resolve_surf_geometry`: shore normal and its source and match distance,
the MOP swell normal, break depth, shelf, coastal/nearshore, swell magnet), its local size reference, and every
PRECOMPUTED `rate_one_spot` frame for it (score, level, breaking height in m and ft, period, swell direction, the
limiting factor and its multiplier, why, confidence, geometry readiness), filterable by model.
It is not a second forecast path (ONE FORECAST COMPOSITION) and cannot load the 1-CPU box: the new routes
(`routes/admin/surf_spot_inspector.py`: GET /admin/surf-forecast/spots?q= and /spots/{id}) read only the offline
geometry asset and the cached L2 objects, off the event loop, and never call estimate_surf_at or fetch weather. A
failed read is reported in the response and shown as an alert.
Tests: backend +4 (frame selection and order without replay inputs; geometry never raises; the route reads cached
objects only, 404, search; a failed blob read is reported), Jest +3. Route identity guard still passes (18). 103
admin Jest tests pass; lint ratchet passes. Not checked in a browser (admin login). Stacked on #1030.
## 2026-11-18 03:47Z Admin: the guardrail's record in the Surf Forecast panel (header from the UTC clock)

David chose guardrail history next. Admin > Surf Forecast > Guardrail (D-065) reads, read-only, the two objects the
guardrail keeps in the private bucket: the live runtime manifest `control/flags.json` (each entry with state, reason,
who, when, evidence) and `control/flags-actions.jsonl` (every decision it APPLIED: disable / clear, with the run).
For a fix the guardrail turned off it says how it comes back: a new fix version in the code (current version shown;
when the code is already newer than the entry, the view says the next run clears it) or the owner's words through
the workflow's manual run, with the workflow link and a copyable `gh workflow run` command. That run is deliberately
not an admin button: the guardrail workflow is the only writer of the manifest. When nothing is recorded the view
says why (decisions are recorded only in enforce mode; a dry run reports in its GitHub issue).
Backend: `services/admin_guardrail_view.py` (no write path; a test checks the module has no POST/PUT/upsert) and
GET /admin/surf-forecast/guardrail (off the event loop). Tests: backend +3, Jest +3; route identity guard passes; 106
admin Jest tests pass; lint ratchet passes. Not checked in a browser (admin login). Stacked on #1031.
## 2026-11-18 04:42Z T1 P3 (part 5): go-live photos lose their GPS before they reach the public bucket (header from the UTC clock)

The Surf truth Consent tab had recorded it since anchors C: go-live condition photos go to the PUBLIC `conditions`
bucket with their original file data, so a phone photo's GPS position (and camera serial, times) was readable by
anyone holding its link. `services/media_metadata.py` now strips the stored copy, losslessly (the image data is
never re-encoded): JPEG drops every APPn except JFIF/ICC/Adobe and COM, then puts back a minimal EXIF holding ONLY a
non-upright Orientation so photos do not turn sideways; PNG drops eXIf/tEXt/iTXt/zTXt/tIME; WebP drops EXIF/XMP and
fixes the VP8X flags and RIFF size. The server's own facts (hash, EXIF position and time, for the blind-observation
checks) are still read from the ORIGINAL bytes and kept in the private `observation_media` table. A malformed
JPEG/PNG/WebP is refused (400) rather than stored unstripped. The upload reply says `metadata_stripped`.
NOT stripped yet (follow-up): HEIC/HEIF (Pillow here cannot rewrite it) and video (needs a video tool); and the
surf-report photo path, which is a different upload route. Already-stored photos keep their metadata until a
backfill is decided.
Tests +6 (each format: GPS gone, pixels identical, orientation kept; the route: public copy clean, private record
kept, malformed refused); mutation: keeping APP1 fails. 99 related tests (incl. the upload identity suite) pass.
## 2026-11-18 05:01Z T1 P3 (part 6): go-live videos too: location kept privately for the check, removed from the public copy

David asked whether to keep the photographer's GPS in go-live media to help confirm location. Answer recorded: yes,
PRIVATELY, which part 5 already did for photos (observation_media keeps the position read from the original; the
observation checks flag exif_far beyond 1 km and exif_stale beyond 3 h; the app's device GPS is the primary check).
The gap was video: its location was never read, and stayed in the public copy. Now `services/video_metadata.py`
(pure Python, no ffmpeg: Render's Python runtime is not known to have it, and installing a binary dependency was not
done) walks the MP4/MOV boxes, READS the ISO 6709 location (QuickTime ©xyz or Apple's
com.apple.quicktime.location.ISO6709) and creation date for the private record, then NEUTERS every movie- and
track-level `udta`/`meta` box in place (type -> `free`, payload zeroed): the length is unchanged so no chunk
offset moves, the media data is untouched, and the file is patched on disk (no in-memory copy of a large video).
`write_public_copy` now handles photos and videos for the route, off the event loop; routes/uploads/core.py shrank to
792 lines. WebM (browser recorder, no GPS) and HEIC remain unstripped and say so (`metadata_stripped` false).
Tests +3 (read then neuter, length and media unchanged; non-ISO left alone and malformed refused without a file; the
route keeps the location privately and not publicly); mutation: skipping track-level boxes fails 2; the 53-test
upload identity suite passes. Stacked on #1035.
## 2026-11-18 13:42Z T1 P3 (part 6, advisor HOLD fixed): a bounded box walk, and no unstripped file left behind on any error

The advisor held #1038 at fb531cf5b for two defects, both now fixed. (1) Unbounded memory: `strip_video_in_place`
built `list(_boxes(...))` at three levels, so a 500 MB upload of 8-byte boxes was about 62 million tuples (~11 GB)
on the one shared server, sendable by any signed-in uploader. The walk is now lazy (neutering keeps every length, so
no position still to be read can move) and shares one budget of `MAX_BOXES` = 4096 boxes per file; beyond it the
file is refused with MetadataError and removed. A real phone MP4 has a few dozen boxes at these levels. (2)
`write_public_copy` removed the written file only on MetadataError; it now removes it on ANY exception, so an
unexpected error can never leave the unstripped copy where the route would publish it.
Tests +2 (a flood of 4,106 boxes is refused with no file left while a real-shaped file still strips; an unexpected
error leaves no file). Mutations: dropping the budget fails 1; catching only MetadataError fails 1.
Limits the advisor recorded, NOT fixed here: GoPro GPMF / DJI telemetry tracks (a full GPS track inside the media
data), top-level `uuid` boxes, and the mvhd/tkhd creation times, which stay.
## 2026-11-18 13:53Z T1 P3 (part 2, advisor HOLD fixed): the consent text says only what is true

The advisor held #1024 at 6ffd34254: the text said "(with the spot and time, but never your name)" and "from then on,
none of your reports are used, including earlier ones". The export is PSEUDONYMOUS, not anonymous (observer and device
codes, distances, EXIF age, app version), and nothing purges exports already made when someone withdraws. New text
(CONSENT_VERSION `draft-2026-11-18b`) names what each used report carries, says the code can be traced back to the
account, says later checks leave out all the person's reports, and says copies made before a withdrawal are not
changed. A stronger promise belongs only in the change that builds the purge, under a new version. Test +1 pins each
phrase to the export's FIELDS (guards fragment +8). Still a DRAFT for counsel.
## 2026-11-18 14:50Z Supabase service-role key moves into the `supabase-service` GitHub Environment (dev/main only)

The key was a repository secret, readable by any workflow run from any branch in this public repo, a pull request
from a branch pushed here included. David created the environment `supabase-service` (deployment branches dev and
main, no reviewers so the 4-hourly ingest is not held) and put the key in it (step 1, his action). This change gives
every job that reads `SUPABASE_SERVICE_ROLE_KEY` that environment: 22 workflow files, 24 jobs. It also drops the
`pull_request` trigger of `consensus-flip-sweep.yml`, the only key-reading workflow that ran on PRs (it could no
longer get the key; it stays dispatchable on dev). Nothing breaks before step 3, because the repository copy still
exists. STEP 3 (David, after merge): delete the REPOSITORY secret `SUPABASE_SERVICE_ROLE_KEY`, then dispatch one
workflow on dev to confirm. After that, dispatching these workflows from a lane branch is refused by design.
Checks: all workflow YAML parses; 242 workflow-shape tests pass (4 failures in `test_audit_e2e_trace_override` are a
Windows bash timeout on the untouched `e2e-tests.yml`).
## 2026-11-18 15:21Z T1 P4: the export needs the OWNER'S server switch, not just an admin's tick box

The advisor recorded on #1033 that its approval check box is client-side only. Worse, the export route itself is already
on dev (`POST /api/admin/surf-truth/export`) and `SURF_TRUTH_EXPORT_KEY` is set on Render, while the consent filter (#1024),
retention (#1034) and counsel's wording are not merged: any admin could have written an unfiltered export. Now the route
refuses (403) unless the server's environment has `SURF_TRUTH_EXPORTS_ENABLED` exactly `1`, which only David can set
(Render env); default OFF. This is a privacy gate, not a served number, so it does not follow D-065's ship-on rule.
The retention job's fresh export (#1034) is left as is: it only REPLACES exports, and none can exist unless the switch
allowed the first one. Tests +5 (unset, empty, 0, true, yes all refused with nothing written or logged); removing the
gate fails 5. Guards fragment +5.
## 2026-11-18 16:40Z #1043 advisor HOLD fixed: a guard that every key-reading job carries the environment

The advisor held #1043 at 1cc1ba285: (1) it removed consensus-flip-sweep's `pull_request` trigger and so failed `test_consensus_flip_sweep` (fixed at bbd7c8fac: the guard now pins the NEW rule, no PR trigger, dispatchable, environment declared, script run); (2) nothing asserted that every job naming the key declares the environment, so the next workflow
that forgets would silently lose its key once the repository secret is deleted (open PR #1025's `sst-g4-collect.yml` already names the key without it). New `tests/test_workflow_key_environment.py` scans every workflow: each job that reads
`secrets.SUPABASE_SERVICE_ROLE_KEY` (in the job or the workflow `env`) must declare `environment: supabase-service`, and no
key-reading workflow may run on `pull_request`. 24 jobs today; tests +26 (estate fragment +26).
