# 2026-11-03 · claude · Forecast-window surf alerts (dark `ALERTS_FORECAST_WINDOWS`)

Session: a delegated subagent of the lead. Draft PR #704 (ledger `ledger.d/claude--alerts-forecast-windows.jsonl:1`, flip commitment `:2`). Branch `claude/alerts-forecast-windows`, cut from `origin/dev` at
`dfed518e8`. Owner's words being executed (2026-11-03, relayed by the lead): "keep moving forward on our fixes",
"Whatever's state of the art makes sense", and earlier "we need better surf forecasting and any logic for surfers that
makes sense to be state of the art". DRAFT PR only: nothing merged, nothing flipped, no env/Render/Netlify/main
change, no call to the live backend, no notification sent. **No served number changes with the flag off** (the off
path is pinned call-for-call and byte-for-byte), so no SCOREBOARD row is owed now; one is owed at the flip.

## The defect (re-verified on dev `dfed518e8`)

- `backend/scheduler/surf_alerts.py:47` resolved `model="GFS"` CURRENT conditions (`forecast_days=1`) every 15 min.
- `backend/services/surf_alert_delivery.py:46-52` fired on min/max height only (1 h cooldown, so every hour in range).
- `time_windows`, `tide_states`, `preferred_conditions` (`models/surf_alerts.py:52-54`) were stored, never read: an
  alert saved as "dawn, offshore, low tide" fired at 3 a.m. in an onshore gale on a high tide.
- Not changed here: the manual `POST /alerts/check` (`routes/surf_data/alerts.py:321`) is the same GFS-current logic.

## Design

| Piece | File | Role |
|---|---|---|
| Decision (pure) | `backend/services/surf_alert_windows.py` | windows, preferences, tier/lane/horizon, de-dup, message |
| Producer (runner) | `backend/services/weather_pipeline/alert_horizon.py` | `precompute_spot_ratings` (so `rate_one_spot`) for alert spots at +0..+72 h hourly, all lanes, obs gate, slim, upload `spot_ratings/alert_horizon.json` |
| Producer hook | `backend/scripts/precompute_ci.py`, `.github/workflows/precompute.yml` | step after the glyph precompute, only when the flag is '1'; never fails the run |
| Consumer (Render) | `backend/scheduler/surf_alert_windows.py`; branch at the top of `check_surf_alerts_task` | one cached GET, one alert query, one notification query, arithmetic, atomic claim |
| Registry | `backend/routes/admin/surf_forecast.py` `_RATING_FLAGS["ALERTS_FORECAST_WINDOWS"]` | default '0'; where: precompute workflow env AND Render env together |
| Replay | `backend/scripts/alert_window_replay.py` | offline evidence (below) |

A window is a maximal run of >= `ALERTS_WINDOW_MIN_HOURS` (2) consecutive local hours, same local day, where every
hour is daylit (sun above -0.833 deg at mid-hour, `sim_daylight`), inside a saved time window (none = any), the
served breaking height is inside [min, max] ft, the level is >= `ALERTS_WINDOW_MIN_LEVEL` ('fair'), the tide matches
(levels: `surf_rating.parse_best_tide` bands; trend: `tide.py`), and the wind matches every saved axis (OR inside
surface / direction / speed, AND across; offshoreness split 0.34 from `rating_why`; glassy < 3 kt from
`wind_quality`; light < 10 kt from the alert UI; clean = < 5 kt or offshore <= 20 kt). Unknown wind or tide fails the
hour. `messy, hollow, steep, mellow, powerful, peaky, walled, uncrowded` cannot be read from the frames: they never
gate and are listed in the notification's `unevaluated_conditions`. One push per alert per run, the earliest window
that is due (starts within `ALERTS_NOTIFY_LEAD_H`, 24) and overlaps no window already sent for that alert.
Message: `Good window at {spot}: {day} {start}-{end}, {height}, {rating level}`.

- **Tier:** `Profile.subscription_tier` through a read-only mirror of `LayerAccessResolver.js` (`TIER_ACCESS` +
  `getUserTier`), parsed back out of the JS by `tests/test_surf_alert_windows_contract.py`. No new ladder: the
  copy fails CI the moment the two differ. Horizon = min(`ALERTS_FORECAST_HORIZON_H` 72, tier days x 24, the
  model's `capabilities.py` marine horizon). At the default 72 h no tier binds (free = 3 days); models do (free/guest:
  GFS only).
- **Lane:** a stored user lane, if permitted and present; otherwise the producer's first configured model
  (`SPOT_RATINGS_PRECOMPUTE_MODELS`); otherwise the first permitted. No file of the branch names a model (test).
  ⚠️ No lane is persisted server-side today (the client keeps `rawsurf-active-model` in localStorage), so every
  alert resolves to the served default. Persisting the lane on the alert is the follow-up.
- **Local time:** spots carry no timezone, so clock windows use the nautical zone round(lng/15) h: equal to the
  standard zone on most surf coasts, 1-2 h off under DST or political zones (Portugal, Spain, Hawaii). Daylight uses
  the true sun. A stored spot timezone is the follow-up that removes this.
- **Fail safe, logged:** horizon missing, older than 12 h, spot absent, no frames in the horizon, no permitted lane,
  bad config: nothing sent; per-run reason counts are logged, at WARNING when any alert had no forecast.

## Cost (the 1-CPU box)

Measured on this laptop (`scratchpad/alw/cost.py`, synthetic, best of 5):

| Path | Unit | Measured |
|---|---|---|
| Rejected: live per-hour rating on the box | one grid product parse (15,023 vectors, 2.46 MB, the measured regional size) | 51 ms best, 63 ms median |
| | per run, 72 hourly hours x 2 domains, ONE region ONE model | ~144 parses ~ 7-9 s CPU every 15 min, and a 128-product / 5-min cache churned under the map |
| Chosen, consumer on the box | 50 spots / 100 alerts (3 models x 25 frames) | object 1.0 MB, parse 6 ms, parse + all decisions 90 ms |
| | 300 spots / 1,000 alerts | object 6.1 MB, parse 56 ms, parse + all decisions ~1.0 s |
| | the arithmetic itself | `compute_surf_rating` 4.9 us per call |

Hourly frames triple the object (50 spots ~3 MB). Producer, on the GitHub runner (precompute run 41673519539,
2026-11-03 16:22Z): 1,773 spots x 2 frames per model took 335 s GFS / 110 s EURO / 124 s ICON = ~53 ms wall per
spot-hour (concurrency 8). Alert horizon = alert spots x 73 h x 3 models: 50 spots ~ 11k ratings ~ 10 min. The job
used 28 of its 55 min; `ALERTS_HORIZON_BUDGET_S` (900) truncates nearest-hours-first beyond that and logs
`truncated=True`. Hours past +24 h load lazily from L2 (`PREFETCH_WINDOW_DAYS` is '1'); consider '3' at the flip.

## Evidence (offline replay, `backend/scripts/alert_window_replay.py`)

Data (public, fetched 2026-11-03 into the session scratchpad, never the app): NDBC realtime2 41113 + TRDF1 (Cocoa
Beach), 46254 + LJPC1 (Scripps Pier), 44100 + DUKN7 (Duck); CO-OPS hourly predictions 8721604, 9410230, 8651370;
2026-09-19 .. 11-03 (45 days). Truth = the served chain (`estimate_surf_at` + `compute_surf_rating`) on observed
inputs at each spot's geometry. Forecasts = truth inputs + AR(1) lead-dependent errors, Hs MAE 0.30/0.33/0.39 m at
24/48/72 h (SCOREBOARD 2026-09-29), wind errors ASSUMED (no measured wind lead skill exists yet). Precision = share of
sends that were right (today: "it is good by your preferences now"; new: the announced window overlaps a realised one
>= 1 h). Recall = realised windows announced before they ended. Fires/week summed over the three spots.

Default config (hourly frames, notify lead 24 h), 5 seeds per error level. sigma 0 = perfect-forecast CONTROL.

| Alert | Error | Realised windows | NEW sends/wk | NEW precision | NEW recall (>= 6 h ahead) | TODAY sends/wk | TODAY precision | TODAY recall |
|---|---|---|---|---|---|---|---|---|
| size only, 2-6 ft | control | 109 | 5.7 | 1.000 | 0.963 (0.963) | 111.6 | 0.279 | 0.954 |
| | calibrated | 109 | 10.2 | **0.731** | 0.952 (0.932) | 105.2 | 0.272 | 0.936 |
| | x2 | 109 | 12.4 | 0.673 | 0.927 (0.870) | 92.1 | 0.252 | 0.894 |
| morning+afternoon, offshore, light wind | control | 20 | 1.0 | 1.000 | 0.950 (0.950) | 131.4 | 0.030 | 0.950 |
| | calibrated | 20 | 2.5 | **0.457** | 0.930 (0.890) | 125.5 | 0.030 | 0.930 |
| | x2 | 20 | 4.2 | 0.255 | 0.850 (0.750) | 114.6 | 0.029 | 0.890 |
| dawn+morning, clean, mid/high tide | control | 60 | 3.2 | 1.000 | 0.967 (0.967) | 160.6 | 0.076 | 0.950 |
| | calibrated | 60 | 5.3 | **0.663** | 0.957 (0.947) | 157.9 | 0.076 | 0.950 |
| | x2 | 60 | 6.0 | 0.577 | 0.953 (0.947) | 149.3 | 0.074 | 0.937 |

- Today's loop sends 10-50x more often (every hour in range, night included) and is right 3-28% of the time against
  the user's own saved preferences; the new logic is right 46-73% at calibrated error with recall within 0.01-0.02.
  Size-only with no level floor on either side (`ALERTS_WINDOW_MIN_LEVEL=very_poor`): new 0.840 vs today 0.468 (lead gate off, 3 seeds).
- Frame spacing, perfect forecast: 3-hourly frames score precision 0.856 / 0.575 / 0.805 (size / offshore / dawn),
  hourly 1.000 on all three; at calibrated error 0.615 / 0.215 / 0.529 vs hourly 0.650 / 0.258 / 0.581 (lead gate
  off). Hence hourly producer frames by default.
- Notify lead (calibrated error): 0 (send on entering the horizon) 0.650 / 0.258 / 0.581, recall 0.978 / 1.000 /
  0.983; 48 h 0.660 / 0.313 / 0.625; **24 h 0.731 / 0.457 / 0.663**, recall 0.952 / 0.930 / 0.957. With no gate
  most sends happen at 48-72 h lead (1,833 of 2,500) at precision 0.591; with the 24 h gate, 24-48 h sends (made
  just before a window enters the gate's reach) score 0.799.
- Caveats, stated: forecasts are synthetic (real truth, modelled error; wind error assumed); the buoys are
  nearshore, so absolute heights run high and the same chain grades both sides; 3 spots, 45 autumn days; window
  hits count >= 1 h overlap. The realised-truth ceiling: one forecast cycle every 4 h, so a window born and gone
  between cycles is missed by both policies. Raw: `alert_window_replay.py --data <dir> --sigma 0 1 2 --seeds 5`.

## Tests and gates

- `tests/test_surf_alert_windows.py` (decisions), `tests/test_surf_alert_windows_scheduler.py` (the real task,
  faked DB; flag-off identity; producer), `tests/test_surf_alert_windows_contract.py` (mirrors and the flag):
  101 tests, guards lane. Floor via `rederive_floor.py --lane guards --add 101 --add-files 3`: 3366 -> 3467,
  MIN_PASSED 3460, MIN_FILES 217.
- Mutation checks (22 single-line mutants of the decision, scheduler and producer; `scratchpad/alw/mutate.py`):
  21 killed. The survivor is equivalent: dropping the alert-id filter in `notified_windows` cannot change a
  decision, because windows are keyed by alert id anyway. Killed include: daylight, tide, AND-across-axes, time
  windows, min and max size, de-dup, tier cap, default lane, staleness, flag default, unknown wind/tide passing,
  level floor, minimum window at the horizon end, the flag-off route, the claim, the producer's gate and budget, the
  notify lead, the missing-forecast WARNING.
- flake8 `--select=E9,F63,F7,F82` clean on every touched file; `check_file_size.py --max-lines 800`: 0 violations
  (largest new file 435 lines); `test_flag_lane_parity.py` and the existing alert suites green locally.

## Reflection (Beam, high effort) and what it changed

Asked for the top 3 risks and whether the cost split is right. Verdict: the split is right (heavy rating on the
runner, one cached read on the box). Its three changes and what was done:

1. "Gate long-lead fires by precision": measured in the replay, then adopted as `ALERTS_NOTIFY_LEAD_H` = 24 (numbers
   above). A stricter far-lead level floor was not added: the replay's 48-72 h sends were not the worst bucket.
2. "Fix timezone handling": not fixable without a stored spot timezone; documented as the module's caveat and a
   follow-up, and named in the flip gate.
3. "Make dedup atomic and key-based": the claim is already an atomic `UPDATE ... RETURNING` with the cooldown, in the
   same transaction as the in-app row, so a second process cannot claim the same alert inside the cooldown and sees
   the committed window after it. A unique-keyed table would need a migration; not done. Also adopted: a WARNING
   when any alert had no forecast (producer truncation or staleness is a lane failure, not "no surf").

## Flip gate (the owner's word, D-001)

1. The replay (or a live shadow of the producer, flag on in precompute.yml only, read offline) shows precision of
   window alerts against realised windows >= today's, per alert type, with recall not materially lower.
2. The producer's `truncated` is False for the live alert-spot count, inside the precompute budget.
3. The owner accepts the two product decisions this makes: the 'fair' level floor (`ALERTS_WINDOW_MIN_LEVEL`) and
   the nautical-zone clock until spots carry a timezone.
4. Flip `ALERTS_FORECAST_WINDOWS` '1' in precompute.yml first (producer only, nothing sent), confirm the object,
   then in the Render env. SCOREBOARD row at the flip.

## Update 2026-11-03 (later): one tier echo, not two (the lead's instruction after #698 merged as `35feaaac6`)

- The alert module's own copy of the tier ladder (`TIER_ACCESS`, `canonical_tier`, `tier_rules`, `model_horizon_h`)
  is deleted. Alerts now read the backend's single echo of LayerAccessResolver, `services/forecast_tier_window.py`:
  `canonical_tier`, `tier_horizon_hours(tier, model, capabilities)` for the horizon (min with
  `ALERTS_FORECAST_HORIZON_H`), and a new `TIER_MODELS` / `allowed_models(tier)` for the model lane, added THERE and
  pinned to the JS `models: [...]` arrays by `tests/test_forecast_tier_window.py` (+2 tests, chain lane).
- `tests/test_surf_alert_windows_contract.py` drops its ladder and getUserTier tests (19, now covered by #698's
  test) and gains one that pins alerts to the echo and forbids a ladder in the alert module.
- Mutants re-run on the moved seam: horizon ignoring the echo, lane ignoring the tier, and a wrong `TIER_MODELS`
  row are all KILLED.
- Floors re-derived from dev after #698: guards 3366 + 83 = 3449 (MIN_PASSED 3443, MIN_FILES 217); chain
  dev's map 3414 + 2 = 3416 (MIN_PASSED 3410).
