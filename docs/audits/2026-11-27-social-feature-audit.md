# Social feature audit, November 27, 2026

Reviewed the Raw Surf application at local dev revision `6c7026237`. The changes and results below are local.

## Earlier coverage

The October 4 audit repaired search, profile trust signals, crew history and note notifications. Its results are recorded in `audit/repair-2026-10-04/REMAINING-BATCH-RESULTS.md` and `backend/tests/test_audit_social_remaining.py`. The October 18 F-09 work exercised blocking across follows, DMs, friend requests, reactions, comments, profiles and lists. Those tests include a user who can still perform each action. The Grom preview component also had recovery tests using a mocked API.

## Findings and repairs

| Surface | What users could experience | Repair |
| --- | --- | --- |
| Following | Switching from For You changed the tab label but continued to show the same posts. | The signed-in viewer's follow list filters the database query before pagination. Following owns its cursor and skips the For You cache. |
| Feed pagination | Newer private or unapproved posts could consume the query window, hiding older eligible posts. A full final page advertised more results. A background refresh could rewind the cursor. | Apply account and guardian visibility before the page limit, fetch one extra eligible row and advance the displayed cursor only when displaying that page. Ignore older pagination responses after a refresh. |
| Empty feed and failed loads | Sample posts appeared with working-looking controls and IDs that had no corresponding server records. An empty manual refresh could leave old posts on screen. | Render the actual empty result, update the cache, and show a retry control when the initial request fails without usable posts. |
| Post reactions | A plain like read back as a shaka. Attempting to undo it could create another reaction. Pointer release and click both attempted to handle a tap, while keyboard activation could do nothing. | Remove the original like when toggling that shaka. The feed uses native click for a tap or keyboard activation and reserves long press for the picker. |
| Comment previews | A feed card could show a blocked author's comment even though opening the thread hid it. | Apply the existing excluded-author set before selecting the two recent comments. |
| Grom community preview | Routing treated `grom-preview` as a post ID. The intended handler also lacked the feed's publication filters. The UI sent private storage references directly to an image element. | Register the literal route first, select up to three public, guardian-approved posts from eligible accounts, and request protected media through the existing delivery endpoint. Render video when there is no poster. |
| Queued follows | Replaying an existing follow action used an unregistered URL. The queue dropped a 404 as permanent. | Use the follow endpoint used by the online profile flow. This repairs replay of an existing action. Enqueueing new offline actions was outside the verified paths. |

## Timing and verification

Git traces the Grom route order to April 30 (`06850acd84`), the sample-post fallback and refresh cursor assignment to at least May 7 (`d45ab09577`), and the small pagination buffer to May 7 (`8ca5506a67`). Guardian feed filtering arrived July 25 (`4ab0a868e`). The source and tests establish multiple defects with different histories. The first affected hosted release and the reason the symptoms became noticeable recently are unknown.

The repository's October offline test runner exercised the mounted FastAPI routers with temporary SQLite data, alongside SQL and source contract checks. All 43 targeted backend cases passed. With the original feed and reaction modules substituted from the baseline revision, three cases failed at the expected assertions. The preview returned 404, a shaka removal returned `added`, and a final page returned `has_more=true`.

Seven local Jest suites passed 56 tests covering feed actions, Grom preview recovery and media resolution, follow-state gating, story refresh, message composition, inbox lifecycle and post menus. The new feed hook checks cover pagination during a background refresh, empty results racing older pages, and reaction activation. Existing component tests use mocked services.

The backend environment reported two dependency-pin differences and five missing declared packages. Hosted PostgreSQL, the deployed app in a browser, storage delivery, realtime transport, device push, calls and live streaming remain unverified. These results do not establish full end-to-end social acceptance.

## Signed-in dev follow-up, November 27

The frontend service worker identified build `8409e370c`, matching the fetched dev head. The profile, post, reaction and on-demand files inspected here had no intervening committed changes from the original local baseline. The following observations were made on the deployed build before the local repairs.

- Clicking two different authors in the feed opened the correct profile headings and post grids. Reloading one author’s profile directly also rendered it. Both profile clicks logged a streak request rejected with HTTP 403. The May 23 backend change `b7872e836f` made streak reads owner-only. The frontend kept requesting streaks on other users’ profiles.
- The feed logged an Axios timeout at 12 seconds. Cached posts were visible. This observation identifies the client deadline. Server latency and the reason for the delay were not measured.
- On a visibly active feed shaka, one click moved the count from 3 to 2, then back to 3. Returning to the feed showed 3. The earlier SQLite route test independently reproduces a legacy like converted into a reaction when the user tries to undo it. The browser observations alone do not identify the stored row type.
- Two on-demand surfaces, Incoming Request and Active Session, built profile links from the displayed username. The profile API selects by profile ID. The May 3 card implementation carried this mismatch. Both dispatch payloads include the requester ID. The corrected cards retain the handle as link text and navigate by ID. This path was verified with mounted component tests, separately from the two live feed-author clicks.
- The July 25 profile handoff and commit `151e410de` document a different issue: a late follow-status read overwrote an optimistic follow. Its existing regression tests passed here.

The local profile now skips another user’s streak, isolates state across route identities, cancels obsolete primary profile reads and offers a retry after a transient failure. Feed reads now use the ordinary 15-second API client deadline. Nine frontend suites passed 61 checks across two invocations, including the two mounted requester-link cases and three profile-read regression cases. The earlier 43 backend checks cover the preceding repair. The follow-up added no backend changes.

SubQ and Reflection advised comparing click navigation, direct reload, console errors and deployment identity. Their advice informed the checks above. Sponsorship thank-you Shakas use a separate API requiring an eligible sponsorship. This live check exercised the feed reaction only. The deployed build has yet to receive or verify these local changes.
The live reaction list showed three shakas, including the signed-in viewer's. Clicking another reactor in that dialog opened the expected profile and its post grid.

## Emoji follow-up

Commit `da30f15db` stripped non-ASCII characters across the frontend. Commit `ac63fcfc1` repaired visible debris and added coverage for note insertion and reaction literals. This follow-up found additional failures even when the chosen emoji was encoded correctly.

| Surface | Finding and local repair |
| --- | --- |
| Crew chat | The picker offered clap, sunglasses and flex, which the API rejected. The API now accepts all ten picker choices and retains historical thumbs-up. Reactions on populated messages used to mutate an existing JSON object in place. Each toggle now locks the message and replaces the object and affected member list. Crew members can still use several different emoji on a message. |
| Feed and single posts | A removal, swap or rejected write could leave the previous emoji visible or a count out of sync. Quick activation uses the viewer's existing emoji. The reaction handler reconciles the viewer's state with the server action and the feed restores the last confirmed state if its recovery read also fails. |
| Modal comments and replies | Mobile read different fields from those returned by the comment API. The two modal layouts now share a toggle and render the returned viewer state and reaction count. Replies can undo an existing non-shaka reaction. Modal post buttons also accept keyboard activation. |
| Live stream | Viewer and broadcaster supplied the old packet option and the asynchronous send could reject outside the error handler. Both now request reliable delivery using the installed LiveKit client's option and await the send. |
| DMs and notes | The six DM message-reaction buttons are a subset of the API's allowed values. The note picker has twelve distinct emoji. The existing encoding checks passed. |

LongCat reviewed the approved generic question and suggested Unicode boundaries, concurrent toggles and retry handling. SubQ and Reflection reviewed the implementation findings and prioritized legacy thumbs-up, count reconciliation, failures and concurrent writers. All eleven crew emoji, including the variation-selector heart, were added and removed through the route handler using SQLAlchemy, with fresh SQLite sessions checking each write and another member's thumbs-up. Hook tests covered undoing a heart, a rejected comment write, an offline recovery read and a server action that differed from the optimistic prediction.

The final targeted runs passed 83 frontend checks across six suites and 72 backend checks across three files. An initial combined Python run terminated with a Windows access violation. The same three backend files passed when run in two smaller groups. The environment had two dependency-pin differences and five absent packages. Hosted PostgreSQL concurrency, two-device LiveKit delivery, physical touch gestures and the post-fix dev build still need live verification.

## Release review

A late reaction response from an earlier post could replace the currently open feed modal with that earlier post. The feed now checks the current modal ID when applying the response. Each post has its own modal state and pending requests, while browsing between posts preserves the browser history entry. Both modal layouts attach the keyboard focus trap to the visible dialog.

LongCat, SubQ and Reflection reviewed the release summary. They highlighted simultaneous updates, late responses, persisted emoji identity and two-client delivery. A regression test checks that a delayed update changes the original feed card while preserving a different open post or a closed modal.
