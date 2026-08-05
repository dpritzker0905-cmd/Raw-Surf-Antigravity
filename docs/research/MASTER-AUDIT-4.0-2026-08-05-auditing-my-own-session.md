# MASTER AUDIT 4.0 — auditing my own session
**2026-08-05 · 19 commits on `dev` · adversarial re-test of everything I shipped**

> **One line:** 19 commits, re-tested against production. Most claims held under wider measurement;
> **two did not, and one of those had already shipped.** The frontend half of the work is **not
> live** — Render deploys the backend from `dev`, Netlify serves production from `main`, and `main`
> is 11 commits behind.

---

## §0 METHOD — WHAT WOULD MAKE THIS AUDIT WRONG

This is an adversarial pass over my own work: every load-bearing claim re-measured, preferring a
**wider** range than the one that produced it, and preferring **production** over local.

Falsifiers, stated up front:

* the deployed SHA is `1cf2eb33` — my latest commit — so production is running everything below.
  If it were not, every "verified live" line would be about a different build.
* the frontend claims are measured on the **local dev harness** (`:3011`), because production does
  not have that code (§4). Dev-build FPS/perf claims: none made.
* ✅ **the full backend suite has since FINISHED: 2,325 passed / 2,928 skipped / 0 failed (30:04).**
  That is the instrument that caught my undeclared flag last time (2,295 passed / **1 failed**), so
  its verdict is the one that mattered. The +30 passes match the tests added this session exactly
  (4 two-regimes + 13 behavioural parity + 7 alert quality + 3 ranking + 3 gate-asymmetry).

---

## §1 CLAIMS THAT HELD UNDER RE-TEST

### ✅ The main deliverable reaches the user, end to end

`directional_conflict` — the disclosure that the size and the quality disagree — was on **0 of 1005**
served spots when I started. Re-measured against production just now:

| stage | evidence |
|---|---|
| `rate_one_spot` produces it | 7/7 mutants caught |
| Pydantic boundary declares it | bidirectional wire contract (the M2 hole closed) |
| `/spot-ratings` API | **198 / 1005 = 19.7%** |
| CDN blob the glyph actually reads | **2,892 / 10,638 = 27.2%**, generated 01:39Z |
| frontend mapper | 4 tests + an exact-shape `toEqual` |

★ And it **confirms my own reasoning rather than merely agreeing with it**: I argued the 15.4%
"at the exposure floor" count was a LOWER bound, because `limiter` is an argmin and the 75.73°–90°
band binds without sitting at the floor. Live: **19.7% carry it against 15.5% at the floor.** Right
direction, right margin.

(19.7% vs 27.2% is population, not contradiction — the API census is GFS-only at one frame over 8
viewports; the blob is 3 models × 2 hours over all 1,773 spots.)

### ✅ `main` is protected, and the protection actually blocks

`10 required checks · enforce_admins: true · no force-push · no deletions · linear history`, and
CI/Lighthouse/LOC all now trigger on `push: [dev, main]`. **Verified by rejection, not by config** —
the identical push that was silently `Bypassed` with `enforce_admins:false` is now
`GH006 ... (protected branch hook declined)`.

### ✅ The a11y deletion created zero unnamed controls — my riskiest change

I deleted 74 `aria-label="div"` after sampling only **3** elements. Behavioural re-test in the live
DOM:

```
interactive 108 · visible 83 · unnamed 19 · byTag { A: 9, INPUT: 10 } · unnamedButtons: 0
stillTagLabelled: 0
```

I stripped labels only from buttons. **Zero buttons are unnamed.** The 19 are 9 icon-only `<a>` nav
links in `BottomNav.js` (**not in my diff** — verified) and 10 `<input>`s: real pre-existing debt,
now counted by the ratchet I armed.

### ✅ The 111 km glyph window is not a zoom artefact

Measured at zoom 8.29 **and** zoom 12: cells are 0.25° in both — the marine grid's resolution is the
upstream product's, not zoom-dependent. At world zoom the coarse tier is 10°, so 111 km is
**conservative**.

### ✅ Gates

`loc_ratchet` exit 0 (12 grandfathered, 0 new, 0 regressed) · ESLint gate green at baseline
(154 errors / 925 warnings, the 775 jsx-a11y now ratcheted) · **10 of 10 required CI checks green on
`dev` HEAD** · ERA5 campaign healthy, 76/150, 70 banked.

---

## §2 ⛔ CLAIMS OF MINE THAT WERE WRONG

### ⛔⛔ "The Weggel slope changes nothing" — it changes **+75%** on big-wave days. THIS ONE SHIPPED.

Commit `753c7d4d` reported the contamination correctly and then concluded it was inert. That
conclusion came from **5 sea states topping out at 8 m**. Re-measured on a wider range:

```
ORIGINAL:   9 spots ×  5 seas (Hs ≤  8 m):   1 of  45 moved, by 0.3%
WIDER:     10 spots × 54 seas (Hs ≤ 18 m):  33 of 540 moved (6.1%)
                                            WORST  Pipeline 18 m/8 s → +75.4%
```

Every mover is Pipeline, and its geometry says why:

```
Pipeline     depth 2534.5 m / width 25.8 km → slope 0.0983 → gamma 1.250  SATURATED
Mavericks    depth  101.5 m / width 44.0 km → slope 0.0023 → gamma 0.838
Cocoa Beach  depth   24.0 m / width 73.3 km → slope 0.0003 → gamma 0.823
```

A 2,534 m "shelf depth" is not a shelf — Oahu's north shore drops into deep ocean. Spots with real
shelves are untouched.

⇒ **Inert in the everyday regime, NOT inert on big-wave days — the safety-critical one.** Corrected
in `c0223a62`: the file renamed (its old name asserted the disproved claim), a third test pinning the
big-wave regime, and the overstatement removed from `surf_transform.py` and from the parity test
that repeated it.

⚠️ Still not *fixed*, for a narrower reason than before: wiring a real nearshore slope moves
big-wave heights at deep-water spots by up to 75% — an owner decision plus a size A/B. And 1.25 may
be roughly **right** at Pipeline (a genuinely steep plunging reef; literature γ ≈ 1.0–1.2), reached
from a number that is not a slope. That is the "right by cancellation" shape; patching it blind
would trade a defensible number for an undefended one.

### ⛔ The orphan CI lane hung every run — I shipped a local green that was environment-specific

244 passed / 0 failed in 179 s locally, reproduced twice. In CI the same 243 files gave **5 failures
and a 24-minute hang**, with `WebSocket broadcast webhook failed: Connection refused`. My job was
also the **only** backend job without `timeout-minutes`. Reverted in `346b69cc`; CI green again. The
verified half — the five ERA5 guards, 63 tests — stayed, because CI itself confirmed those.

---

## §3 INSTRUMENT ERRORS — NINE, AND WHERE EACH WAS CAUGHT

| # | error | caught by | shipped? |
|---|---|---|---|
| 1 | canvas recorder reported "map goes blank" — `preserveDrawingBuffer:false`, 298/299 frames blank | its own control | no |
| 2 | blamed the outage on my promotion — used an **hourly** probe to rule out a **5-minute** event | the deployed SHA | **yes** (in a commit msg + report; corrected) |
| 3 | glyph magnitude measured on a wave-height grid (`phys_speed === speed`) | the control | no |
| 4 | parity harness compared **pre-gate** glyph vs **post-gate** sim | the test going red | no |
| 5 | …then the same mistake on the **label** | the test going red | no |
| 6 | `"gate_single_model_surface" in src` satisfied by the **import line** | mutation M3 | no |
| 7 | producer↔boundary differential blind to a **removed** key | mutation M2 | no |
| 8 | orphan-lane floor 250 — measured before 63 tests moved out | re-deriving after the move | no |
| 9 | alert guard tripped on its **own comment** quoting the removed string | the test going red | no |
| 10 | **"Weggel changes nothing"** — bound measured on a narrow range | this audit | **yes** (corrected) |

★★ **Not one was caught by a suite going green.** Every one fell to a control, a mutation, a
replicate, or a wider range. Two reached a commit; both are corrected in the record rather than
quietly amended.

★★★ **The recurring shape, three times in one session:** `"x" in src` is almost never a needle only
the real thing produces. Import lines, comments and docstrings all satisfy it. All three are now AST
checks over live constructs — a `Call` node, an `os.environ` read, a non-docstring string literal.

---

## §4 ⛔ THE FRONTEND HALF IS NOT LIVE

Render deploys the **backend** from `dev`; Netlify serves **production** from `main`; `main` is
**11 commits behind**.

```
production  rawsurf.netlify.app       → main.e1515b31.js
dev preview dev--rawsurf.netlify.app  → main.be9571b6.js      (different bundle)
```

| fix | in production? |
|---|---|
| `directional_conflict` on all four surfaces (backend) | ✅ |
| `find_best_spot` ranking; alerts state the quality (backend) | ✅ |
| glyph: best-within-111 km → nearest cell | ❌ still `max` |
| fourth whitelist dropping the caveat before the glyph | ❌ still dropped |
| 74 `aria-label="div"` | ❌ still announcing "div" |

⇒ **One fast-forward promotion ships all three.** `dev` is green on all 10 required checks, and
because required checks attach to the commit, the fast-forward satisfies protection without a PR.
Not done here — this turn's ask was an audit, and the last promotion coincided with an outage I
initially misattributed. It is the top queue item.

---

## §5 WHAT I DID NOT DO

* ~~The full backend suite had not finished~~ — **it did: 2,325 passed / 0 failed.** No regression
  from any of the 19 commits, and the skip count is unchanged at 2,928.
* **The orphan lane** (244 tests that run nowhere) is reverted, not solved.
* **ERA5 sample banking** — refuted, not implemented: `samples` holds only scalar breaking heights,
  so it is not the training set the plan assumes.
* **`warnings` through the mappers** — refuted: 0 files in the entire frontend consume `.warnings`,
  so mapping it would create another inert field.
* **The 12 pre-existing "2-of-3" whitelist fields** — pinned as a ratchet, not adjudicated.
* **19 unnamed interactive elements** (9 nav links, 10 inputs) — measured, pre-existing, untouched.
* **Memory index is 21.2 KB** against a 17 KB compaction mark — over, and I added to it.
