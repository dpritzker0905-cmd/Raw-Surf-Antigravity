# FINDING 2026-08-03 — the industry level ladder is a FREQUENCY scale, and we ship 7 of its 10 rungs

**Prompted by** the owner naming eight levels — *"very poor, poor, poor-fair, fair, fair-good, good,
**very good**, epic"* — where the codebase has seven. Researched rather than assumed.

---

## §1 THE INDUSTRY LADDER (Surfline's published 1–10 scale, corroborated across two sources)

| # | level | published definition |
|---|---|---|
| 1 | **FLAT** | unsurfable / flat |
| 2 | **VERY POOR** | lack of surf, very poor wave shape, or bad from wind / tide / storm |
| 3 | **POOR** | some (**30%**) FAIR waves to ride |
| 4 | **POOR–FAIR** | many (**50%**) FAIR waves to ride |
| 5 | **FAIR** | very average surf, most (**70%**) waves **rideable** |
| 6 | **FAIR–GOOD** | fair surf with some (**30%**) GOOD waves |
| 7 | **GOOD** | generally fair surf with many (**50%**) GOOD waves |
| 8 | **VERY GOOD** | generally good surf with most (**70%**) GOOD waves |
| 9 | **GOOD–EPIC** | very good surf with many (**50%**) EPIC waves |
| 10 | **EPIC** | most (**70%**) waves EPIC — *"generally some of the best surf all year"* |

★★★ **THE LADDER IS RECURSIVE AND IT MEASURES CONSISTENCY, NOT INTENSITY.** Each rung is defined by
**what fraction of the waves in the session reach the rung below it**: 30% → 50% → 70% of *fair*,
then 30% → 50% → 70% of *good*, then 50% → 70% of *epic*. The question the scale answers is
**"how many of the waves are good?"** — not "how good is the best wave".

★★ **AND `EPIC` IS A RARITY STATEMENT**: *"some of the best surf all year"* is explicitly a
**percentile of that spot's own annual distribution**, not an absolute condition.

## §2 WE SHIP 7 OF THE 10 RUNGS — and the three missing ones are all at the top

```python
LEVELS = ["very_poor", "poor", "poor_fair", "fair", "fair_good", "good", "epic"]
_BUCKETS = [(14,"very_poor"), (28,"poor"), (42,"poor_fair"), (56,"fair"), (70,"fair_good"), (84,"good")]
```

`very_good` appears **nowhere in the backend or the frontend** (grep, 2026-08-03).

| industry | ours |
|---|---|
| 1 FLAT | *(absent — folds into `very_poor`)* |
| 2 VERY POOR | `very_poor` |
| 3 POOR | `poor` |
| 4 POOR–FAIR | `poor_fair` |
| 5 FAIR | `fair` |
| 6 FAIR–GOOD | `fair_good` |
| 7 GOOD | `good` |
| **8 VERY GOOD** | **— absent —** |
| **9 GOOD–EPIC** | **— absent —** |
| 10 EPIC | `epic` |

⇒ **OUR TOP BUCKET IS ASKED TO CARRY THREE INDUSTRY TIERS.** `epic` (≥84, open-ended) spans VERY
GOOD, GOOD–EPIC *and* EPIC. There is **no way for the product to say "very good"** — the vocabulary
jumps straight from *good* to *the best surf all year*.

★★★ **THIS IS THE MECHANICAL ROOT OF THE OWNER'S ORIGINAL COMPLAINT.** 2026-07-29: *"I wouldn't say
4 ft @ 9 sec is epic."* With no VERY GOOD rung, **anything better than `good` must be called
`epic`** — the model had nowhere else to put it. The 2026-07-29 work fixed that by moving the
*threshold*; the ladder itself was never the suspect.

## §3 THE DEEPER MISMATCH — absolute score bands cannot express a frequency semantic

Our buckets are fixed score bands (14/28/42/56/70/84 on a 0–100 composite). The industry rungs are
**proportions of waves in a session**, and the top rung is **a percentile of the spot's own year**.

Those are different kinds of quantity:

- A frequency ladder is naturally **per-spot and per-distribution** — `_REF_SAT_MULT = 2.5 ×
  typical` is an *approximation* of it on the size axis only, while the bucket boundaries stay
  absolute.
- It also implies **consistency belongs in the score.** Nothing in our nine factors measures how
  *uniform* the waves are — period spread, sea state, set frequency. A 70%-good session and a
  10%-good session with the same peak can score identically here.

⚠️ **NOT a claim that our numbers are wrong** — only that the SCALE our labels come from means
something our composite does not currently compute. That gap has to be named before the labels can
be trusted to mean what a surfer reads into them.

## §4 THE BENCHMARK, STATED PLAINLY

Surfline's ratings are produced by **machine learning trained on 35 years and hundreds of thousands
of observations**, hourly, per spot. That is the state of the art we are measuring against.

⇒ It reinforces **SOTA ledger #6**: we have **no skill score against instruments and no observational
training set**. Our composite is a hand-built physical model with owner anchors; theirs is fitted to
observed outcomes. **Until we score against observations, "state of the art" stays uncheckable** —
and a frequency-semantic ladder is exactly the kind of thing you can only calibrate against
observed sessions, not derive from first principles.

## §5 WHAT FOLLOWS — ordered, none of it shipped

1. **Add `very_good` between `good` and `epic`** (and consider `good_epic`). This is a **bucket and
   label** change, not a physics change — the lowest-risk item on the whole rating queue, and it
   gives the model somewhere to put an 8/10 day so `epic` can go back to meaning *best of the year*.
   ⚠️ Touches every rating surface: the 7-colour map colormap, the legend, the infobox, the sim,
   `score_to_level`, and every test asserting a level string. **Count the surfaces first.**
2. **Re-derive the bucket boundaries from the frequency definitions** rather than even spacing.
   Today's are 14/28/42/56/70/84 — uniform 14-point steps, which encodes no semantic at all.
3. **Consider a consistency term.** The ladder's whole axis is "what fraction of waves are good", and
   the composite has no factor for it.
4. Only then revisit the conjunction (§7/§8) — **the level ladder is upstream of the calibration**,
   and tuning a score against buckets that mean the wrong thing is fitting to the wrong target.
