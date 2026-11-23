# 2026-11-22 — T1 lane: blind surf quality on observations (prerequisite of gates/surf-tide-v1.md section 0)

Append-only. Lane T1 (crowd truth and privacy), asked by the director for the surf-tide registration (#1147).

## What was built (dark: SURF_TRUTH_BLIND_QUALITY code default '0'; no served number changes)

- **Field:** `surf_observations.quality_level` holds one of `surf_rating.LEVELS`, in words ("Very poor" to "Epic"), on
  the same row as the blind height. Beside it are `quality_version` ('blind_q1', the question and its labels) and
  `forecast_seen_claim` (the app's word). The new columns are nullable; the startup bootstrap adds them.
- **Acceptance (server, `services/blind_quality.decide`):** a level is stored only when all three hold:
  1. the flag is '1';
  2. the entry screen is audited blind (`forecast_shown_before = false`: `checkin_modal`, `golive_conditions_modal`);
  3. the app sends `forecast_seen_for_spot: false`.

  Otherwise the height is kept and the level is dropped with a flag:
  - `quality_off`: the flag is off;
  - `quality_not_blind`: the spot page form;
  - `quality_after_forecast`: the app says a forecast was shown;
  - `quality_exposure_unknown`: the app said nothing.

  The reply does not say which happened (it reveals no check verdicts).
- **No reward reads it:** a test sends the same report with and without a level, and the XP outcome is identical.
- **Kill switches:**
  - Server: SURF_TRUTH_BLIND_QUALITY via runtime_flags (env > manifest `control/flags.json` > '0'), so it can be
    turned on, and off again, without a deploy.
  - Client: `window.__RAW_DISABLE_BLIND_QUALITY__ = true` hides the question and stops it being sent.
- **Consent and privacy wording:** the forecast-data consent default (now `draft-2026-11-22f`, was `-18e`) and
  privacy section 11 say "the wave heights and surf quality you report". Production read 2026-11-22 (read-only):
  0 consent events, 0 grants, 0 surf_observations, no published `forecast_consent` or `privacy` document. So the
  version change asks nobody to agree again.
- **The export is unchanged:** export schema 2 does not carry the level yet. Carrying it needs export schema 3 and
  `scripts/surf_truth/prep.py` to accept it. That is the gate's scorer work, a follow-up.

## Per-screen blindness proof (gate section 0: "The prerequisite PR must show that per screen")

| Screen | Asks quality? | Shows a forecast, rating, tide factor or best_tide? | Proof |
|---|---|---|---|
| CheckInModal (feed check-in) | yes | no | ENTRY_SCREENS `checkin_modal` → false; `src/tests/blindQualityScreens.proof.test.js`: no forecast, rating or tide import, no forecast endpoint, no best_tide / tide_fit / rating field |
| ConditionsModal (photographer go-live) | yes | no | ENTRY_SCREENS `golive_conditions_modal` → false; same proof test. Its notes placeholder said "best at mid-tide" (a tide-preference anchor) and now reads "What you see, in your own words" |
| SpotConditions report form (spot page) | never | yes (forecast rows above the form) | ENTRY_SCREENS `spot_report_modal` → true; the server drops any level (`quality_not_blind`); the proof test asserts it never passes askQuality |
| Everywhere else in the app | n/a | some | Every surface that renders a forecast, rating or tide read calls `useNoteForecastShown`. After any of them, the question is not asked for the rest of the session and the server keeps no level. The proof test fails when a new surface imports a forecast module without recording it. Pure modules are listed, and a test checks they render no JSX. The scan found 5 surfaces the first list had missed (ExploreTrending, MapMarkerLayers, SpotReportContent, SpotForecastChart, usePointTide), now covered. |

Also on the check-in screen: the existing "Conditions" select (Glassy / Clean / Choppy / Messy / Blown Out) is the
surfer's own word, not ours, and stays. The levels are the server's words and contain no digits (tested).

## Limits (for the advisor)

- Exposure is SESSION-WIDE and per browser tab (sessionStorage). It cannot see another tab, another device, another
  app or an earlier day. `forecast_seen_for_spot: false` means "this tab has shown no forecast since it opened".
  It does not mean the person never saw one.
- It is a client claim. A modified client can send false. The server cannot verify it.
- Session-wide exposure is strict: anyone who opened the map or a spot page before reporting is not asked. That
  costs volume and can select who answers. The gate's selection audit (section 2) must report it.
- The ordering on the check-in screen puts "Conditions" (texture) before the quality question. That is the
  surfer's own observation, but it can anchor the level. Not measured.
- The local ESLint ratchet reported counts below its baseline on this worktree. The baseline was not rewritten here.

## The production read behind "0 grants" (advisor limit at c1e24c6ca)

- Who: this session (lane T1, Claude Code, as part of this build), on 2026-11-22.
- How: the Supabase MCP connector's `execute_sql` on project `jnfbxcvcbtndtsvscppt` (production). The credential is
  the connector's own signed-in account. No repository credential was used: no environment variable, and neither
  `SUPABASE_SERVICE_ROLE_KEY` nor `DATABASE_URL`.
- What: four read-only SELECTs. Only counts, names and flags were read; no row contents or personal data.
  1. `count(*)` of `surf_truth_consent_events` (all, and `granted`) and of `surf_observations`: 0, 0, 0.
  2. `doc_type, version, is_active` of `tos_content` where `doc_type in ('privacy', 'forecast_consent')`: no rows.
     So no admin-published privacy or consent document is live, and the app serves the built-in defaults.
  3. `column_name` from `information_schema.columns` for five `surf_observations` columns: all five exist.
  4. One attempted query named a `content` column that does not exist and errored before reading anything.
- Nothing was written.

## Owner approval of the wording, and where it is edited (2026-11-22)

- **Approved:** David (owner), in the T1 session: "Approve the consent and privacy wording change, and make sure its
  all changeable in the admin backend". This settles the advisor's wording hold on #1151 (D-084). The flag
  `SURF_TRUTH_BLIND_QUALITY` stays off; turning it on is a separate word from him. The map-file question
  (MapForecastOverlay, MapWeatherControls) is still with the director and Codex.
- **Editable in the admin backend (checked, no code change):** both texts are in Admin > Compliance > Legal documents
  (`components/admin/LegalDocumentsEditor.js`, rendered by `AdminComplianceDashboard.js`):
  - "Privacy Policy" tab (doc_type `privacy`): section 11 is one of its sections.
  - "Forecast data consent" tab (doc_type `forecast_consent`): one checkbox label and one text.

  Until an admin publishes, the editor loads the built-in defaults (`GET /compliance/tos-content/current?raw=true`),
  which are the approved words. Publishing goes through `PUT /compliance/tos-content` (admin only,
  `get_current_admin`), then deactivates the old version. A new consent version asks everyone who opted in again.
  Under the existing version, a change of words is refused. Covered by `tests/test_forecast_consent_wording.py`
  (including `test_default_wording_until_an_admin_publishes` and
  `test_a_version_keeps_its_text_and_a_new_version_asks_again`) and `LegalDocumentsEditor.test.js`.

## The Codex-reserved map files are released by the owner (2026-11-23)

- **Files:** `MapForecastOverlay.js` and `MapWeatherControls.js`. Each gets two added lines: the
  `useNoteForecastShown` import and one call at the top of the component.
- **Owner's word:** David, in the director's session (transcript 3285d99c-2bfe-40f6-8698-6474419931cc).
  - At 2026-11-23T00:21:27Z the director asked: "Release the Codex-reserved files for #1149 and #1151, as you did for #923?"
  - At 2026-11-23T00:23:23.455Z David answered "Yes, release them", his own input.
- **Verified:** the advisor checked it in that transcript and recorded it in the shared `ADVISOR-MERGE-GATE.md`
  (NOTE "#1149 / #1151 reserved files", 2026-11-23T00:24Z). The director logged it in the shared Codex note.
- **Codex:** #755 must rebase over these two files.
- **Unchanged:** the allowlist fallback is not needed and was not applied. The flag stays off. This lane does not merge.

## The flag goes ON, after three outside reviews (2026-11-23)

- **Owner's word:** David, in the T1 session: "Turn on the blind quality flag if its SOTA direction. Bounce things off
  longcat, subq, and reflection".
- **The reviews.** All three got the same brief: the design summary, the limits above, and the question ON / STAY
  DARK / ON AFTER X. It carried no code and no secrets. Their output is advice, not instructions.
  - Reflection (Beam-1.0): **ON**. It named consent and selection bias, the Conditions anchor, 7 words against a
    0-100 rating, and client-claimed blindness. Treat the labels as noisy truth.
  - SubQ (savant-1.4): **ON AFTER X**. X: consent-gate the level; move the question above "Conditions" or randomise
    the order; consider "Not sure"; freeze the level-to-schema-3 mapping. It called the direction "close to best
    practice". The answer was cut off by its token limit after point 3.
  - Longcat (LongCat-2.5): **ON AFTER X**. X1: ask only people whose forecast-data consent is on. X2: fix or measure
    the Conditions anchor. It also asked us to record offered vs answered, to freeze the scorer mapping before
    collection (ordinal levels, not interpolated scores), and to keep the proof test blocking. It answered "yes" on
    the SOTA question: forecast-blind, exposure-audited, unrewarded, against a pre-registered gate.
- **What changed before the flip (the shared conditions):**
  1. **Consent gate.** The server stores a level only while the person's forecast-data consent is in force. Without
     it, the height is kept and the level is dropped with `quality_no_consent`. The app shows the question only when
     the consent toggle is on, just below it. Turning consent off clears an answer already given. Reason: data
     minimisation. The level has one use, checking the forecast, and the consent covers exactly that.
  2. **Anchor removed on check-in.** The "Conditions" select (Glassy ... Blown Out) now comes after the blind height
     and quality questions. A proof test pins the order; the old order fails it. Go-live has no texture select.
  3. **Flag default `'1'`.** The kill switches are unchanged: `SURF_TRUTH_BLIND_QUALITY=0` in env or in the manifest
     `control/flags.json` stops it without a deploy, and `window.__RAW_DISABLE_BLIND_QUALITY__ = true` stops it on
     the client. No served number moves, so there is no SCOREBOARD row.
- **Not done, recorded for the scorer work (export schema 3, `prep.py`):**
  - "Not sure": skipping the optional question already means that, so no option was added.
  - "Offered vs answered": the server cannot see "offered", so it is not recorded. The drop-reason flags separate the
    blindness, consent and kill-switch drops.
  - Freezing the level mapping before the gate reads any level: the scorer must treat levels as ordered categories,
    as the gate pre-registers.
- **Tests:**
  - Backend: 12 in `test_surf_observation_blind_quality.py`, adding the no-consent case. The kill-switch and default
    tests were rewritten.
  - Frontend: 33, adding consent on/off/clear, the question below the toggle, and the check-in order.
  - Floors: guards 12, frontend 33 tests in 2 files.
