# RV-09 — Per-band EURO query: the answer, and why it does NOT decide the flip

| Field | Value |
|---|---|
| Evidence ID | RV-09 |
| Date | 2026-08-12, `valid_time 21:00:00Z` |
| Branch / commit | `dev` @ `3bc776d9` |
| Instrument | **`backend/scripts/model_skill_census.py`** — already existed (2026-08-03), purpose-built for this question. Not written for this audit. |
| Method | 60 NDBC buoys, `latest_obs` truth, `/api/weather/point` at each buoy's own coordinates for GFS/ICON/EURO |
| Pairing | **60 of 60, rate 1.0** — every buoy resolved all three models |
| Production code modified | **NONE** — read-only, 180 point requests at 6 concurrent |

---

## 1. The headline, and the control that dismantles it

| Model | n | MAE (m) | bias (m) | closest at |
|---|---|---|---|---|
| **EURO** | 60 | **0.1496** | +0.069 | **37 buoys** |
| GFS *(served)* | 60 | 0.2362 | −0.114 | 18 buoys |
| ICON | 60 | 0.3217 | +0.100 | 5 buoys |

EURO looks **36.7% better**. Then the script's own provider control — built precisely so *"EURO is
better"* cannot silently mean *"EURO fell back to something else"* — decomposes it:

| model / provider actually served | n | MAE | bias | GFS at the **same sites** | EURO better by |
|---|---|---|---|---|---|
| `EURO/ecmwf` | **34** | 0.1721 | +0.092 | 0.1772 | **2.9%** |
| `EURO/copernicus` | 15 | 0.1413 | +0.036 | **0.3212** | 56% |
| `EURO/gfs_estimated_fallback` | 11 | 0.0909 | +0.044 | **0.3026** | 70% |
| `GFS/noaa` | 57 | 0.2328 | −0.136 | — | — |
| `GFS/open-meteo` | 3 | 0.3000 | +0.300 | — | — |

⛔ **On the 34 sites where EURO actually served ECMWF, EURO beats GFS by 2.9%** — not 36.7%.

The headline is carried by **26 sites the EURO lane routes away from ECMWF**, and at those sites the
GFS lane scores **0.30–0.32** against its own 0.177 elsewhere. The effect is not obviously *"EURO is
a better model."* It looks like ***"the GFS lane is bad at a specific subset of sites, and the EURO
lane's routing avoids them."***

⚠️ The strangest row deserves naming: `EURO/gfs_estimated_fallback` — a **GFS-derived estimate** —
scores **0.091** where the GFS lane itself scores **0.303** at the same coordinates. A fallback
beating its own source by 70% is not a model-quality result. It is a signal about the serving path,
and it is the single most interesting thing this census produced.

## 2. Per observed-height band (the query as asked)

| band | n | GFS mae / bias | ICON mae / bias | EURO mae / bias | winner |
|---|---|---|---|---|---|
| flat <0.5 m | 25 | 0.201 / −0.148 | 0.186 / −0.101 | **0.074 / +0.013** | EURO by 63% |
| small 0.5–1.5 m | 29 | 0.243 / −0.118 | 0.425 / +0.225 | **0.193 / +0.100** | EURO |
| rideable 1.5–3 m | 6 | 0.346 / +0.048 | 0.385 / +0.335 | **0.254 / +0.159** | EURO |
| **big >3 m** | **0** | — | — | — | **STILL NOT SAMPLED** |

**EURO wins every band that has data**, and on flat seas it is both the most accurate *and* the
least biased (+0.013 vs GFS −0.148).

### My hypothesis was not confirmed — it was not testable

RV-08 proposed that EURO's warm bias might be *an asset in the tail and a liability on flat days*.
This run:

- **Refutes the flat-day half at this hour** — EURO is nearly unbiased on flat (+0.013), while GFS
  *under*-reads flat by −0.148.
- **Cannot test the tail half at all.** `big >3m` has **n = 0**. There is no big surf anywhere in
  the 60-buoy panel right now.

**The number I set out to get does not exist yet, because the weather has not produced it.**

## 3. A contradiction I will not paper over

RV-08 read the archive's `stratified_height_bias` (n=770, 27 buoys, two weeks) as showing the served
lane **over**-predicting flat surf by **+0.239 m**. This hour's census shows it **under**-predicting
flat surf by **−0.148 m**.

I checked for the obvious explanation and it is not there: **both use the same convention**,
`model − observed` (`buoy_calibration.py:228,235`; `model_skill_census.py:179`). Positive means
over-prediction in both. The sources genuinely disagree.

Two candidate explanations, neither yet tested:

1. **One hour vs two weeks.** The census's own docstring is explicit: *"One run is ONE HOUR… closer
   to n=1 than to n=buoys… This repo has already generalised twice from a single sample and been
   wrong both times."* The archive is the stronger evidence on its own terms.
2. **Different coordinates.** The census samples at **buoy** coordinates; the calibration lane
   resolves at **spot** coordinates. Different coordinates select different products, so these may
   not be measuring the same lane at all.

Explanation (2) would also dissolve the §1 finding — so **the "GFS is bad at a subset of sites"
reading must be held as a lead, not a result.**

Corroboration attempted and *not* found: the archive's own per-spot snapshot (417 rows) is tight —
median error −0.025 m, and only **3 of 417 rows (0.7%)** exceed 0.5 m, all three the same buoy
(46267) under three spot names. That does **not** show the widespread site-specific failure the
buoy-coordinate census implies. **The two views disagree, and the disagreement is now the finding.**

---

## 4. Verdict

**The per-band EURO query did not decide the flip, and I am not going to present it as if it did.**

| Question | Status |
|---|---|
| Is EURO more accurate overall? | **Yes** — robustly. 28 of 30 paired ledger cells (RV-08) plus every sampled band here |
| Is that because EURO is a better *model*? | **Unclear — and now doubted.** Like-for-like on ECMWF-served sites it is +2.9%, n=34, one hour |
| Does EURO's bias help in the tail? | **Untestable today.** `big >3m` n=0 |
| Should the default flip? | **No — not on this evidence** |

### What actually decides it now, in order

| # | Step | Why it is first |
|---|---|---|
| **1** | **Pool 5–10 census runs across different hours** (`--json` already appends; the file exists) | The script's own stated requirement. One hour is n≈1, and both §1 and §3 hinge on it |
| **2** | **Resolve the buoy-vs-spot coordinate question** — score the census at spot coordinates, or the calibration lane at buoy coordinates | It either explains the §3 contradiction away or promotes §1 to a real defect |
| **3** | **Explain `EURO/gfs_estimated_fallback` beating `GFS/noaa` by 70% at the same coordinates** | A fallback outperforming its source is a serving-path signal, and would be worth more than the flip |
| 4 | Wait for `big >3m` observations, or widen to a stormier window | The tail question, still open |
| 5 | Owner decision on the bias trade | Only meaningful after 1–4 |

⭐ **Note what changed about the shape of this work.** Before WS-CAN-0026 shipped there was no
instrument whose output prompted this question at all. Two hours later the question has a
purpose-built script, a decomposition that overturned its own headline, and a ranked list of what
would settle it. **That is the gate paying for itself** — not by paging, but by making a question
askable.

## 5. Instrument note

`backend/scripts/model_skill_census.py` **already existed** and I nearly rebuilt its analysis by
hand. It was found only because `forecast_skill.OBS_BANDS` carries a comment naming its importer.
This is the repo's own standing rule — *before building a feature, grep for one* — and the comment
that saved the work is the reason it worked.
