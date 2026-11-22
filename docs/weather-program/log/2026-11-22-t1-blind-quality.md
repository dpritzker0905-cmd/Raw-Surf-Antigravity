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
