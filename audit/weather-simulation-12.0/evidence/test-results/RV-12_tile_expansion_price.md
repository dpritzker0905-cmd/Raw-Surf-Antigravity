# RV-12 — PRICING THE 0.25° TILE-COVERAGE EXPANSION

| Field | Value |
|---|---|
| Evidence ID | RV-12 |
| Date | 2026-08-12 |
| Branch / commit | `dev` @ `3bc776d9` |
| Proposed task | **WS-CAN-0058** |
| Method | production spot catalogue (1,773 spots) intersected offline with both tile sets; GitHub Actions run history for cost; RV-09/RV-11 for benefit |
| Production code modified | **NONE** — one catalogue GET, everything else offline |

---

## Verdict

**Expansion is justified but it is no longer cheap, and the case is weaker than RV-11 implied.**
The concentrated wins were already taken. What remains is a long tail at roughly the estate's
*average* cost per spot, and **the binding constraint is not download — it is cadence, and cadence
runs into a 200-minute timeout that has already caused an outage once.**

**Recommend: +3 to +5 regions, not +15.** Expected coverage 58.7% → 62.6–65.0%.

---

## ⛔ Correction: my first pass was wrong, and wrong in the direction that flatters the proposal

I initially computed coverage against `WORLDWIDE_COASTAL_REGIONS` alone and reported **52.7%
uncovered**, ranking **Florida (124 spots)** and **California (78)** as the top two gaps.

There are **two** tile sets. `REGIONAL_CONFIGS` — `florida_east_coast` and `us_west_coast_socal` —
is the **core** lane, running every fire rather than rotating. **Both of my "top gaps" were already
covered.** The first row of my own price table was proposing regions that exist.

Corrected: **1,041 of 1,773 covered (58.7%), 732 uncovered (41.3%).**

⭐ Third time in this session that *grep for an existing one before proposing a new one* would have
caught an error — the census script, the `OBS_BANDS` import, and now this. The rule keeps paying.

---

## Benefit — measured, from two independent instruments

| Instrument | Measurement |
|---|---|
| RV-09 / RV-11 (this audit) | served lane **MAE 0.30–0.32 on coarse coverage vs 0.177 where a regional tile exists**, same model, same hour, same resolver |
| `scripts/tier_resolution_delta.py` (pre-existing, 8 regions holding both tiers) | coarse tier costs **21.0% median / 41.7% max** on **breaking** height, signed both ways — a *systematic geometry* error that **does not shrink with lead** the way forecast error grows |

Those agree in direction and rough magnitude from completely different angles. **The benefit side
is the solid part of this analysis.**

## Cost — and the structure changed in 2026-07-31

Multi-bbox removed the `× REGIONS` term from download: one pass per **horizon group** now covers
every region, and the marine download fell **276 → 138 steps**. So *"add a region"* is nearly free
on the wire. Three things still cost:

**1. Cadence — the binding constraint.** 12 worldwide regions ÷ 3 per fire × 8 h = **32 h** per
region, and `test_worldwide_count_and_per_cycle_keep_the_32h_cadence` fails at commit time if a
region is added without raising the divisor. Raising `WORLDWIDE_REGIONS_PER_CYCLE` raises **per-fire**
work.

**2. Runtime, against a hard 200-minute ceiling.** Measured over the last 10 pilot runs:

```
median 80.4 min   max 102.2 min   range 62.6 – 102.2   timeout-minutes: 200
```

⚠️ **This ceiling has already bitten.** The workflow header records it: *"the shared serial group's
worst case (pilots ≤200 min + core ≤165 min = 365 min) exceeded the 240-min core period, so under
GH cron drift the runs stacked and PENDING core runs were repeatedly EVICTED (three cancelled)."*
Cadence was cut 6×/day → 3×/day to fix it. **Pushing per-fire work back up walks toward that
failure mode.**

**3. Products per fire** → manifest growth. The 3d→5d horizon change moved regional marine products
**1,704 → 2,216 per fire**; the production manifest is now **21,678 products**. Per-fire products
scale with regions-per-fire.

## The price table

| new regions | spots closed | coverage | cells added | total regions | `per_cycle` needed | cadence |
|---|---|---|---|---|---|---|
| **+3** | 69 | **62.6%** | 1,200 | 15 | 4 | 32 h ✅ |
| **+5** | 111 | **65.0%** | 2,000 | 17 | 5 | 32 h ✅ |
| +8 | 167 | 68.1% | 3,200 | 20 | 5 | 32 h ✅ |
| +10 | 193 | 69.6% | 4,000 | 22 | 6 | 32 h ✅ |
| +15 | 254 | 73.0% | 6,000 | 27 | 7 | 32 h ⚠️ |

**Runtime estimate at each step is the missing number.** `per_cycle` 3→7 is 2.33× the regions per
fire. Runtime is *not* proportional — download is shared — but per-region processing and upload are
not. A crude split (fixed ≈ 32 min, variable ≈ 48 min) puts +15 at **~180 min max against a 200-min
ceiling**. Too close to the failure mode above.

⚠️ **That split is an estimate, not a measurement, and I am flagging it as the weakest number in
this document.** Supporting evidence that the fixed component is large: observed runtime varies only
**1.63×** (62.6–102.2 min) while the regions that fire vary in cell count by up to **15×** (380 to
5,760). That implies a big shared component — but it does not isolate it.

## Diminishing returns — the reason not to go big

The uncovered demand is **flat**. The largest remaining cluster is **24 spots** (Puerto Rico), and
the top 15 bins together hold only **254 of 732** uncovered spots (34.7%). Compare the covered side:
`iberia_west` alone serves **204 spots from 640 cells**.

| | cells per spot closed |
|---|---|
| `ww:iberia_west` (best existing) | **3.1** |
| estate average | 23.6 |
| **marginal expansion (top 15 bins)** | **23.6** |
| `ww:brazil_east` (worst existing) | 240 |

**The marginal region costs about the estate average — neither a bargain nor a waste.** The
cheap, concentrated wins (Iberia 204, Florida 130, UK 107, SoCal 72) are already taken.

### A re-cut would not free much — hypothesis tested and mostly refuted

I expected the fat regions (`brazil_east` 5,760 cells for 24 spots, `indonesia` 4,576 for 68) to be
sloppily drawn, and re-cutting to fund expansion for free. Tightening every region to the bounding
box of the spots it actually serves, +1° margin:

```
TOTAL 24,619 cells -> 21,116  =  3,503 freed (14%)   ~9 new 5-degree regions' worth
brazil_east 19% freed | indonesia 4% | mexico 4% | south_africa 57% | east_australia 45%
```

**Only 14%.** Those regions are large because their spots genuinely span long coastlines and
archipelagos, not because the boxes are sloppy. The low spots-per-cell is coastline geometry, not
waste. *(Worth doing for `south_africa` and `east_australia` — 57% and 45% — but it is a tidy-up,
not a funding source.)*

---

## Recommendation

**Do +3 to +5 regions, in one change, with `WORLDWIDE_REGIONS_PER_CYCLE` raised in both workflows.**

| Priority | 5° bin | spots | Region |
|---|---|---|---|
| 1 | `+15,−70` | 24 | Puerto Rico / Virgin Islands *(with `+15,−65`, 13 more)* |
| 2 | `+30,−20` | 23 | Madeira / Portugal offshore |
| 3 | `+30,−10` | 22 | Morocco (Agadir / Taghazout) |
| 4 | `+5,−85` | 22 | Panama / Costa Rica Caribbean |
| 5 | `+5,+80` | 20 | Sri Lanka / Maldives *(with `+0,+70`, 17 more)* |

**Measure before going further.** The single number that would firm this up is the **fixed-vs-variable
runtime split** of the pilot lane — one instrumented run at `per_cycle` 4 versus 3 gives it directly,
and it decides whether +8 or +15 is safe. Do not raise `per_cycle` past 5 without it.

## Why this still beats the model flip

| Lever | Measured gain | Cost | Verdict |
|---|---|---|---|
| Default GFS → EURO | **2.9%** MAE like-for-like (n=34, one hour) | flag flip, plus 3-upstream ambiguity | **No** — masks the real cause |
| **+3–5 tile regions** | **~40% MAE** at the affected coordinates; **21% median** breaking-height geometry error removed | +1,200–2,000 cells, `per_cycle` 4–5, runtime headroom to watch | **Yes** |

**The coverage lever is roughly an order of magnitude larger than the model lever, and it addresses
the cause rather than routing around it.** That is the third consecutive audit to land on input
coverage as the binding constraint — but the first to price it.

## Caveats

1. **Coverage is computed from bbox containment, not from what the resolver actually returns.**
   RV-11 showed `coverage_status` agrees on the 60-buoy panel, but I have not validated the
   1,773-spot mapping against served payloads.
2. **The runtime scaling model is an estimate** (see above) — the weakest number here.
3. **Spot count is not demand.** 1,773 catalogue spots are not weighted by usage. A region serving
   20 heavily-used spots may beat one serving 24 dormant ones, and nothing here knows which.
4. **The benefit figure comes from one hour** (RV-09/RV-11) plus one prior study
   (`tier_resolution_delta.py`). They agree, which is reassuring, but neither spans seasons.
