# Profile Follow-State Race — Claude Desktop Handoff

## Scope

User report: logged in as `@davidsurf`, followed `@matt_bender`; the relationship persisted, but the profile button remained **Follow** until leaving and re-entering the profile.

## Forensic conclusion

This was a client-side stale-read race, not a backend follow failure:

1. `Profile` opens and starts `GET /follow/check?follower_id=<viewer>&following_id=<profile>`.
2. Viewer taps **Follow** before that request resolves.
3. `useProfileActions.handleFollow` posts `/follow/<profile>?follower_id=<viewer>` and optimistically sets `isFollowing=true`.
4. The earlier check response returns its pre-mutation `false` and overwrites local state.
5. A new profile visit fetches the persisted relationship and correctly renders **Following**.

## Implemented change

- Added `frontend/src/utils/followStatusGate.js`: a small per-profile version gate.
- `Profile.js` captures a gate snapshot before a status read and applies its response only if that snapshot remains current.
- `useProfileActions.handleFollow` calls the injected invalidator immediately before the optimistic follow/unfollow transition.
- This applies to both the direct `/follow/check` read and its `/following/<viewer>` fallback.
- No API routes, database schema, authorization semantics, or backend relationship behavior changed.

## Verification

- `CI=true craco test --watchAll=false --runTestsByPath src/utils/followStatusGate.test.js` — passed.
- Targeted ESLint on changed source and test — passed.
- `git diff --check` — passed.

## Durable record

The decision, evidence, and debt are in `.codebase-memory/adr.md` under **Profile follow-state stale-read remediation (2026-07-25)**.

## Remaining debt / next safe step

Follow state remains independently managed in several surfaces (profile, feed, storefront, follower modal, and single-post). Do not copy this mechanism blindly. If consolidating later, first inventory the route contracts and define a single client follow-state/cache invalidation policy. Add a browser-level deferred-network Profile test when a reliably logged-out test context is available.