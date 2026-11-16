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
