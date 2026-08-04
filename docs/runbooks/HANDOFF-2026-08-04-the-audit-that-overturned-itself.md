# HANDOFF 2026-08-04 — the audit that overturned itself, and the campaign that keeps dying at its checkpoint

**Range:** `d095ed3a → 56e66f71` (this session's commits) plus REVISION 1.1 to
`docs/research/MASTER-AUDIT-1.0-2026-08-03-all-weather-features.md`.
**Read first:** `standing-work-rules-user-mandate.md` · `THE-SOTA-LEDGER-…` ·
`MASTER-AUDIT-1.0` **§REVISION 1.1 before its body** · `model-lane-capabilities-and-horizons-2026-08-03`.

---

## §1 THE STATE OF THE ERA5 CAMPAIGN — running, and it has now died twice for different reasons

**RUNNING** (pid confirmed, `--all --upload`, target verified `jnfbxcvcbtndtsvscppt`).
**Resume is PROVEN WORKING**, and the same log file carries the before/after:

```
spots in scope after resume filter: 1773     <- original start, nothing banked
spots in scope after resume filter: 1673     <- restart: exactly the 100 banked spots SKIPPED
```

Three separate defects have now been fixed in this one lane. Each was invisible until the previous
one was cleared — a stack, not a list:

| # | defect | commit | how it was found |
|---|---|---|---|
| 1 | the guard matched **its own launcher**, so every wrapper invocation self-aborted | `4b28f750` | direct call with a non-matching cmdline |
| 2 | it sampled **dry ERA5 cells** (`offshore=0`) *and would have banked the empties*, stamping them DONE forever | `72ceb475` | the first spot of the first real run |
| 3 | the **resume marker had a ~4 h half-life** — `merge_frames_into_climatology` rebuilds each record and the known hazard had been fixed for `lat`/`lng` ALONE | `96285138` | a survey agent's mutation test, verified independently |
| 4 | **one TCP reset killed the 5-day run** — the checkpoint was the least robust call in the file | `56e66f71` | reading the crash tail after the process vanished |

⚠️ **STILL OPEN in this lane, deliberately not fixed here:** `--limit` is applied BEFORE the resume
filter (`era5_deepen_climatology.py:379-380` vs `:382-388`), so the nightly scheduled task
`RawSurf ERA5 Climatology Campaign --limit 150` means **"the first 150 spots by id"** forever. With
the marker now surviving it would silently stop at 150/1,773 instead of looping. One-line move, but
it changes scheduled-job behaviour and deserves a measured before/after.
⚠️ **A SECOND SCHEDULED ERA5 JOB EXISTS** (21:30 nightly, its own log at
`~/AppData/Local/raw-surf-era5-campaign.log`). **SERIALISE CDS** — it and the manual campaign will
starve each other.

★ **THE CLASS WORTH KEEPING FROM #4:** this script's entire design is *"BANK THE WORK AS IT IS
EARNED"* so a multi-day job survives interruption — **and the checkpoint itself was the one
unprotected call.** Over ~5 days of HTTPS a TCP reset is the most likely event, not an edge case.
**A failure path must be the most robust code in the file**, and it is the one path that never runs
unless you force it — my first version of the retry carried a non-ASCII glyph that raises
`UnicodeEncodeError` on cp1252 stdout, i.e. it would have killed the run on the FIRST retry. Caught
only by a control that forced the path.

---

## §2 THE MASTER AUDIT OVERTURNED THREE OF ITS OWN CONCLUSIONS

Full detail in `MASTER-AUDIT-1.0` §REVISION 1.1. Summary:

* ⛔ **§8 Priority 0 is VOID.** "Flag spots sharing an identical shore normal" — **permutation
  p = 1.000**. Identical normals occur exactly as often as chance. I promoted a vivid n=2 anecdote
  (Padang Padang / Bingin both 316.5°) to priority zero **without asking its base rate**.
* ⛔⛔ **The `swell_exposure` floor is too GENEROUS, not too harsh.** A real sea is a spectrum
  `cos^{2s}(φ/2)` (s≈70 swell); flux at Δθ=100° is **0.013** vs our flat **0.100**. The far-off-angle
  spots are **correctly** floored. **Do not soften it.**
* ⚠️ **§1a was half the answer.** The engine really does reach 97.3 `epic` — but
  `CAP_UNCONFIRMED = 69.9 < GOOD_T = 70.0`, so **even a raw 100.0 displays `fair_good` when
  unconfirmed**, and both confirmation supplies measure zero. **P(display ≥ good) = 0 EXACTLY —
  arithmetic, not a data shortfall.** Verified by execution at HEAD.

★★★ **THE META-LESSON, and it is the most transferable thing in this handoff:** the audit's own
fan-out produced **17 "criticals" of which 0 survived** adversarial verification, while an external
review scored **5/5**. Volume of findings is not quality of findings. **Severity is a hypothesis
until something tries to refute it.**

---

## §3 WHAT STANDS FROM THE AUDIT

* **§2a `coarse_fill`** — Gulf holes are filled from GFS and the provenance stamp is silently
  dropped (`NormalizedProduct` has no such field; the raise is swallowed). Its guard was green for
  11 days because it builds the product with `types.SimpleNamespace`, which accepts any attribute.
* **§2b the sim's circuit breaker** — one 8 s timeout sets a 60 s PROCESS-WIDE cooldown, every later
  spot returns "the app is not reachable", and `sim_compare` **binds that reason and discards it**.
  The breaker drops the TAIL of a nearest-first list, so at Jeffreys Bay it removes ranks 1 and 2 by
  quality. ⚠️ **Corrected by `77f66211`:** failures were cached **60× the breaker's TTL**, and the
  HEALTHY leg cleared it ⇒ **health went UP while the answer stayed MISSING**. "Don't cache failures"
  is the WRONG fix.
* **§5 the skill gap** — paired n=3,852: ours **0.304** vs Open-Meteo **0.199**, ~zero bias on both
  sides ⇒ **scatter, not an offset**. Largely a GFS gap: `EURO/copernicus` 0.159 vs `GFS/noaa` 0.443
  scored on the SAME sites. Verification still reports only bias+MAE — **no RMSE, scatter index or
  symmetric slope**, which are standard at operational wave centres.

---

## §4 NEXT — in the order the evidence now supports

1. **The cap, not the inputs.** `CAP_UNCONFIRMED = 69.9` sits 0.1 below the word it withholds and
   both confirmation supplies are zero. Until that is addressed the product **cannot** say "good"
   whatever the forecast does. ⚠️ And ledger #1's *"the gate self-resolves"* is REFUTED — withheld
   stays flat as scores lift (12 → 118 → 154); at k=1.5, **52% still withheld**. **Two sequential
   projects.**
2. **Metrics before constants.** Add RMSE / scatter index / symmetric slope and stratify the buoy set
   by depth and exposure. Every accuracy item stays unfalsifiable without it, and **the owner-anchor
   A/B is BLIND** (a 47% height cut moves all five anchors by 0.0).
3. **`--limit` after the resume filter** (one line) so the nightly ERA5 task advances.
4. **`coarse_fill` provenance** — declare it on the model AND past `response_model`, and rebuild the
   guard against the real pydantic type instead of `SimpleNamespace`.
5. ⛔ **Do NOT** soften the `swell_exposure` floor, build the identical-normal detector, or flip the
   default model. The first two are refuted; the third needs the metrics from (2).

---

## §5 PROCESS — what caught what, this session

| caught by | count |
|---|---|
| a CONTROL that forced a failure path | 3 (the retry's unicode bug, the marker fix, the census `--control`) |
| a REPLICATE at larger n or a second frame | 3 (antimeridian retraction, ICON/EURO 70-crossing, limiter histogram) |
| a MUTATION harness | 2 (the launcher guard — twice, including my own first fix) |
| adversarial VERIFICATION of a finding | 5 refuted + ~30 downgraded |
| reading the code again | **0** |

⭐ **Every correction came from forcing a path, repeating a measurement, or trying to refute a claim.
None came from re-reading code more carefully.** That is the single most reliable finding across the
whole session, and it is why the verify phase is worth its token cost.
