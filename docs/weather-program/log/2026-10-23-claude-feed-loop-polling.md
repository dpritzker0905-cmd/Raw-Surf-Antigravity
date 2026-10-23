# 2026-10-23 (claude, request-diet session): the /feed stories loop, doubled badge polls, consent calls on load

Written 2026-10-23T03:30Z. Branch `claude/busy-chatterjee-1f1130` from dev `ff5b7066f`. Evidence:
`evidence/request-rates-2026-10-23.json`. Changes no served number (no surf height, rating, glyph, hub or sim value):
no SCOREBOARD row.

## Ask
The owner, 2026-10-22 22:55 EDT, via the lead: "start a session to fix the /feed request loop, the doubled polling, and
check the automatic TOS / push calls." Source: the lead's live DevTools trace of dev (bundle `54718262`, 2026-10-23
~02:15Z): 432 GET /api/stories/feed in ~2 min from one /feed tab; /map polling ~0.4 req/s with both unread-count
endpoints sent twice; POST /api/compliance/acknowledge-tos and POST /api/push/subscribe during page load.

## Root causes
1. **Stories loop** (`hooks/useStoriesActions.js`). The fetch effect also asked for the location; every answer was a NEW
   `{lat, lon}` object -> a new `fetchStories` -> the effect ran again -> another fetch and another location request.
   It loops only when location is allowed (a denied request sets no state). The live list shows it: the repeats start
   right after the first located request, all with the same coordinates. The realtime channel effect depended on
   `fetchStories` too, so the Supabase channel was torn down and re-subscribed every round as well.
2. **Doubled badge polls.** AppLayout mounts Sidebar, TopNav and BottomNav together (CSS hides them per breakpoint).
   Sidebar polled both counts, TopNav the notification count and BottomNav the message count: each endpoint twice
   every 30 s, hidden tab or not.
3. **Push on load** (`PushNotificationInit`, `routing/AppLayout.js`). It called `subscribe()` whenever
   `Notification.permission === 'granted'`. That permission is per ORIGIN; the backend keys subscriptions by
   (user, endpoint). For the account that said yes it is an idempotent re-sync ("Already subscribed"); for ANY other
   account signing in on that browser it created a subscription with no click. Logout removes nothing. No in-app
   control calls `unsubscribe()`, so no explicit opt-out was being overridden. Reported to the lead at ~03:05Z.
4. **TOS on load: not automatic.** The `acknowledge-tos?user_id=` URL is only `TosReacceptanceGate.handleAccept`, the
   "I Agree" button, disabled until the box is ticked. Offline (below) the dialog stayed up 60 s with 0 POSTs and the
   tick + click sent exactly 1. The forensics agent's transcript has no click before the POST and the lead drove no
   browser then; the MCP Chrome window is a visible window, so a person may have clicked through it. Why the dialog
   showed at all for an account that had accepted: the backend records acceptance under the JWT's id but
   `/tos-status/{user_id}` reads the path id the client sends (`user.user_id || user.id`), the 2026-10-18 audit's
   "ToS keyed user_id vs profile id" finding. Not fixed here (backend identity semantics; follow-up).

## Change
- `useStoriesActions.js`: location asked once per user (its own effect); a same-position answer keeps the same object;
  the realtime channel is one per user and reads the latest fetch through a ref.
- `hooks/useUnreadCounts.js` (new): ONE module-level poller for both badges (the `useActiveSession` pattern):
  one interval while anything subscribes, no request while the tab is hidden, one catch-up request on return after a
  missed tick, shared in-flight request, a failed endpoint keeps its last count. Sidebar, TopNav (its drawer's
  `onCountUpdate` is the hook's `refresh`) and BottomNav read it.
- Hidden-tab guard (`document.visibilityState`) on the 30 s polls: map overlays (`useMapData`), friends on map,
  pending dispatch requests (`useMapInteractions`), the feed's live users, and Sidebar's 60 s feed refresh.
- Push: a per-account opt-in record on this browser (`rs-push-optin-<id>`), written by a successful `subscribe()` (the
  prompt's Enable click) and by the surf-alerts Enable path, cleared by `unsubscribe()`. `PushNotificationInit` re-syncs
  only for an account with that record. Trade-off: accounts that opted in BEFORE this change have no record, so their
  existing server subscription stays but is no longer re-posted on load (an endpoint rotation is not re-synced until
  they click Enable again).
- Tests: `useStoriesActions.feedLoop.test.js` (RED on the old code: 11 identical feed requests and 11 channel
  subscriptions in 10 act rounds), `useUnreadCounts.test.js`, `PushNotificationInit.consent.test.js` (RED on the old
  code: a never-opted-in account subscribed), `TosReacceptanceGate.consent.test.js` (pins today's behaviour). Mutation
  checks: TOS button enabled without the tick, and the poller without its hidden guard, each fail a test.
- Harness: `frontend/scripts/offline-backend/scn_request_rates.js` (phases feed / map / map_hidden / tos).

## Measured (offline, `scn_request_rates.js`, 60 s windows, geolocation granted, no live traffic)
| Page (60 s) | Non-weather requests/min before | after |
|---|---|---|
| `feed` | 11218 | 29 |
| `map` | 37 | 33 |
| `map_hidden` | 18 | 0 |
| `tos` | 9708 | 31 |

| Endpoint, per minute | feed before / after | map before / after | map hidden before / after |
|---|---|---|---|
| stories feed | 11187 / 2 | 0 / 0 | 0 / 0 |
| notifications unread-count | 4 / 2 | 4 / 2 | 4 / 0 |
| messages unread-counts | 4 / 2 | 4 / 2 | 4 / 0 |
| dispatch active (8 s, already shared) | 8 / 8 | 9 / 9 | 0 / 0 |
| surf-spots (harness: empty stub retries) | 0 / 0 | 6 / 6 | 6 / 0 |
| live-photographers | 0 / 0 | 2 / 2 | 2 / 0 |
| friends/map | 0 / 0 | 2 / 2 | 2 / 0 |

| TOS dialog, no clicks for 60 s | before | after |
|---|---|---|
| dialog shown | True | True |
| acknowledge POSTs with no click | 0 | 0 |
| POSTs after tick + click (control) | 1 | 1 |
| dialog still up after click | False | False |


The offline stub answers instantly, so the loop ran at ~186 req/s here against ~3.6 req/s live (432 in ~2 min: each round waits on the network). `surf-spots` 6/min is the harness's empty-stub retry ladder (an empty global list counts as transient); live it is 2/min. The only write in any window is the TOS control click.
Live estimate for a signed-in /map tab: ~0.41 req/s before (the trace: 59 in 144 s) -> ~0.34 req/s visible (the two doubled badge polls gone), and 0 req/s while hidden (the 8 s dispatch check already paused there; now
every other poll does too).

## Checks
- Jest, whole tree (`craco test`): 492 of 494 suites passed; the 2 failures were timeouts under load
  (`authRedirectLoop`, `netlifyIconStoredTailScope`: a 5 s `bash` spawn) and both pass when re-run alone (17/17).
- `node scripts/check_eslint.js`: no rule over baseline. `loc_ratchet.py` / `check_file_size.py`: no new violation.
- No live traffic: every backend call in the harness was answered locally or stubbed; no `/api/health` probe needed.

## Follow-ups (not done here)
- TOS id keying (acknowledge by JWT id, status by path id): the reason the dialog re-appears in a fresh browser.
- Every story INSERT anywhere makes every open /feed tab refetch after 2 s (the realtime handler): a herd per post.
- Logout does not remove the browser's push subscription: a signed-out account's pushes still reach that device.
- `surf-spots` is re-fetched in full every 30 s on /map (up to ~1 s per answer live) though spots rarely change.
