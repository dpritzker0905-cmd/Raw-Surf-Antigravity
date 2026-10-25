# 2026-10-24 (claude, GPU-frames session): the render backstop's no-progress cap and two residents taking turns

Branch `claude/clamp-cap-seen-sigs` from dev 749080841. Client only, no served number; ships ON with a kill switch. It fulfils the
commitment recorded 2026-10-23 (ledger fragment `claude--z8-step-after-pans`, due 2026-11-06).

## Ask
- The lead, 2026-10-23: "The cousin you found ... is real. Record it as a follow-up item in your fragment. Don't widen this PR for
  it." And 2026-10-24: "(b) The backstop no-progress signature fix (alternating residents never cap), its own small PR."

## The defect
- `useMarineScrubSettle`'s render backstop re-drives the settle check while a clamp (a coarse world grid, a too-small or a too-coarse
  regional grid at a zoomed-in view) is held. Its no-progress cap stops the fast re-drives after 3 passes on an unchanged ENGINE grid
  signature (kind + bounds), then probes every 45 s, 4 times.
- It compared the signature with the LAST one only. When two residents take turns, the signature changes on every pass and the cap
  never engages: the /grid tile and a series frame (13 x 13 and 17 x 13) in the 2026-10-23 reload-loop samples
  (log/2026-10-23-claude-settle-reload-guard.md), a stale 5 x 3 preview and the 13 x 9 viewport grid in the 2026-10-24 Lake
  Michigan replay (log/2026-10-24-claude-same-key-repeats.md). #505 ended the network loop this allowed; the re-drive churn
  (settle checks, clamp re-asks within their own cap) stayed possible.

## The fix
- `marineSettleWatchdogs.clampMadeProgress`: progress is a resident this clamp EPISODE has not held before. The episode is the view:
  model, layer, hour and the viewport at 0.5 deg; a new view, or the clamp clearing, starts a new one. A return to an earlier resident
  is no progress, so A, B, A, B caps on the 5th pass; each NEW resident is still progress, so a sharpening view is never capped.
- Kill: `window.__RAW_DISABLE_CLAMP_SEEN_SIGS__ = true` (the last signature only, as before).

## Verified
- Unit (marineSettleWatchdogs.clampProgress.test.js): turns A, B, A, B, A, B count 0, 0, 1, 2, 3, 4 (the cap at the 5th pass); an
  unchanged resident counts as before; five new residents never count; a new episode starts clean; the seen set is bounded at 16;
  the kill switch restores the old counting (turns never cap); the wiring in useMarineScrubSettle is pinned.
- Replays, one build (dev 749080841 + this), the control arm sets the kill switch. NEITHER scene isolates the alternation on current
  dev, so the replays show no harm, not the benefit; the unit tests carry the logic.
  - The 2026-10-23 reload-loop scene (scn_sibling_toggle.js, surf ON, ICON, 20 pans at z8 off Florida, #505's guard killed so the
    reload loop is back, DIAG=1 with the backstop counters, new): both arms capped once ~10 s after the pans (fix 76.6 / 78.8 s,
    kill 74.4 / 76.1 s after Waves), backstop re-drives 9 / 13 vs 12 / 12. The two residents no longer took turns here.
  - The Lake Michigan stale scene (scn_model_toggle.js, GFS <-> EURO x3 + PageUp, regional /grid stale 150 s, `--stale-fast 1`):
    re-drives 33 / 27 (fix) vs 35 / 26 (kill), caps 3 / 3 vs 3 / 2, the first cap at 183 / 67 s vs 193 / 199 s. Each episode (one
    view, model and hour) lasts ~20 s between the toggles and the +1 h steps, so a cap rarely has three passes to count.
- The commitment's check asked for "a replay where two residents alternate ... shows __MARINE_CLAMP_GIVEUP_COUNT__ > 0 within 30 s":
  not met by a replay, because no current scene alternates long enough in one view; the unit test pins exactly that sequence.
