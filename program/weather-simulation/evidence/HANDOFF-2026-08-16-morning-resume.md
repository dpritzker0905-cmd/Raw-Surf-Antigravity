# MORNING RESUME — 2026-08-16

**Start here. Run this first:**

```bash
bash program/weather-simulation/recheck-state.sh
```

It is read-only and prints, in one pass: local/remote SHAs, every worktree, what is actually
**deployed** on dev/prod/backend, main-vs-dev, open PRs, the last run of every CI lane that matters,
the ledger's blocked-on-you and ready-now lists, and how to re-verify the halo fix in 20 seconds.

---

## 1. What happened last night, in one paragraph

The coastal halo is **solved and owner-confirmed**. It was never a shader, a coverage gate, a mask
texture or a stack-order bug — it was **one MapLibre style layer**, `ocean-mask-buffer`, painting
near-black over the marine field and over coastal land. It is now **opt-in only**, the fix is
deployed to the dev alias and verified in the shipped artifact, and it is protected by an
append-only proof log plus a mutation-tested guard so it cannot silently regress.

## 2. State at hand-off

| | |
|---|---|
| `origin/dev` | `784b4c6c` — contains the fix; deployed and verified |
| dev frontend | rebuilt to `784b4c6c`; `ocean-mask-buffer` → `visibility:"none"` with **no console overrides** |
| `origin/main` | see recheck output — PR #9 was merging at hand-off |
| production frontend | `3bd38a83` unless the merge changed it — **see §4, this is the open question** |
| backend | deploys from `dev` on every push |
| ledger | `program/weather-simulation/COMPLETION_LEDGER_4.2.csv` — 60 rows, 7 VERIFIED, 2 awaiting promotion, 10 blocked on the owner, 38 open |

## 3. The halo — what is proven, and the traps

**Painter:** `ocean-mask-buffer` (`OceanMask.js`), a 10–60 px line offset 5–30 px outward into the
ocean, `line-opacity` **1.0 until z8.5** ramping to 0 by z9.5, colour `rgba(16,29,43,0.90)`.

**Mechanism:** that colour is near-black, while the basemap water it was designed to blend into
composites to a **medium slate** (`water` `hsl(197,15%,43%)` @ 0.25 over `land` `hsl(214,17%,31%)`).
It has never matched. So it darkens whatever it sits above. On convoluted coasts a 60 px stroke with
round joins self-overlaps and the 0.9-alpha overlaps compound into **faceted dark blobs over land**
(Cape Canaveral, Merritt Island).

**Affected band z1–z9.5, worst z4–z8.5.** The opacity ramp is the *only* reason close zoom ever
looked clean — which is why every close-zoom check in eleven weeks cleared the real culprit.

⛔ **Three traps, all of which produce a FALSE NEGATIVE:**
1. `setLayoutProperty('ocean-mask-buffer','visibility','none')` is **silently reverted** by
   `OceanMask.js` on every sync tick while a marine layer is active. Measured: set `none`, read back
   `"visible"` 2.5 s later. **Use `line-opacity`.**
2. **Single-zoom verification is inadmissible** — every buffer property is zoom-interpolated.
3. `getStyle().layers` **omits custom layers**; `webgl-marine-particles` only appears in
   `map.style._order`.

⛔ **Reordering is NOT the fix — this was my wrong first answer and the owner caught it.** Moving the
buffer below the marine field clears the band over water and lands the near-black line above
`ocean-mask-fill`, darkening coastal **land** instead. The symptom moves; it does not clear. Recorded
as a rejected hypothesis in the proof log so the next person does not re-run it.

**Cleared, not implicated:** the SAFE_DEGRADED clip (`aa026f7f`) and the wash min-combine
(`7becd023`) were both *engaged and correct* in the very frames showing the halo, and the halo
appeared in all three coverage regimes (`unknown`/`safe_degraded`/`covered`). Neither governs a style
layer. `7becd023`'s "halo ROOT-CAUSED" claim is **refuted** — a real ordering bug, but not this one.

## 4. THE ONE THING TO CHECK FIRST IN THE MORNING

**Did the production frontend actually move off `3bd38a83`?**

```bash
curl -s https://rawsurf.netlify.app/service-worker.js | grep BUILD_VERSION
```

- **If it changed** → production carries the fix. Verify optically at the owner scene, then close
  `C4-P0-09`.
- **If it still says `3bd38a83`** → the repo side is done and the blocker is Netlify-side. The repo's
  own history records "one fast-forward ships it" being disproved three times. `netlify.toml`'s
  production `ignore` rule only skips a build when `frontend/src` is unchanged, and we changed it —
  so the build should have run. That points at **auto-publishing being off or the deploy being
  locked**. Owner action, one place:
  **Netlify → site `rawsurf` → Deploys → unlock / enable auto-publishing → publish the newest build.**
  Do not attempt to work around this in the repo.

## 5. Ready to work now — no owner input needed

Highest value first, all read-only or self-contained:

1. **`C4-P0-07`** — optical proof of the fix on the deployed candidate: control coast + light/beach
   themes + the full zoom ladder. The vector and method are in the proof log; this is mechanical now.
2. **`C4-MR-01` / `C4-MR-02`** — the two faces that have **never had a single commit**: particle/crest
   validity (untouched since 2026-07-07) and an explicit INVALID mask state (`-S CLAMP_TO_EDGE`
   returns 20 commits, none of which ever added a validity companion). These are the remaining real
   marine correctness gaps.
3. **`C4-UX-01`** — re-verify the scheduled surf-alert quality language on the current SHA.
4. **`C4-OP-04`** — the Windows/CI build break (`NODE_OPTIONS=... craco build` is Unix-only syntax).

## 6. Blocked on the owner — ask these in the morning

1. **P0 SECURITY — rotate two committed credentials.** Confirmed present in tracked `BRAIN_RULES.md`
   (Supermemory key, line 60; Qdrant Cloud endpoint + key ~line 200, also in `.antigravityrules`),
   and in git history across 20 commits. **Rotation must happen at the provider before removal** —
   deleting the lines does not revoke a leaked key. Never printed; only located.
2. **Production frontend unfreeze** (§4).
3. **Test account / `storageState`** for headless authenticated optical testing (`C4-P0-02`). Place at
   `.secrets/zl-auth.json`; never paste credentials into chat.
4. **PR triage** — #7 and #10 are still open; #10 duplicates the promotion path.
5. **Who owns the renderer lane** (`C4-GOV-01`) — a second Claude context pushed to `dev` twice during
   yesterday's session, from this same shared worktree.

## 7. Environment facts that will bite otherwise

- **Every push to `dev` is a production backend deploy.** `dev` has **no branch protection at all**
  (HTTP 404), so nothing gates it.
- **Concurrent contexts share this worktree and `dev`.** Use `git commit -o <paths>`; nothing isolates
  a push. Never stage `backend/uploads/forecast_cache/*.json` — they are not ours and they show dirty
  on every ingest cycle.
- **A new commit to `dev` resets PR #9's checks.** Do not commit while a promotion gate is pending.
- **`OceanMask.js` LOC ratchet: 905.** It sits at 904. Any edit must be net ≤ +1.
- **Local Python is broken** — use `~/AppData/Local/Python/bin/python3.exe`. Windows stdout is cp1252:
  print ASCII only.
- **The code knowledge graph is STALE** and `status:"ready"` is not freshness. Pair every miss with a
  positive control from the same file; use git/text search for anything committed since 2026-08-15.
