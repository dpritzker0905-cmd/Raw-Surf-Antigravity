# RV-11 — The EURO advantage is a COVERAGE effect, not a model effect

| Field | Value |
|---|---|
| Evidence ID | RV-11 |
| Date | 2026-08-12, `valid_time 21:00:00Z` |
| Branch / commit | `dev` @ `3bc776d9` |
| Panel | **the census's own 60-buoy panel, imported not reimplemented** (`parse_latest_obs_waves` + freshness gate + geographic spread + identical stride) |
| Production code modified | **NONE** — read-only, 120 point requests |

---

## ⛔ Retraction first: my first run of this probe was invalid

Version 1 hand-rolled a `latest_obs` parser and took the **first 60 rows**. `model_skill_census`
does neither — it parses with a documented column map, gates on observation age, and then **sorts
to spread the sample geographically**, for a reason stated in its own source:

> *"the file's own order is regional, and a regional sample would score one basin's weather rather
> than the models"*

So my 60 buoys were a **regional** sample and the census's were **global**. The "disagreement" I
first saw (51 ECMWF sites vs the census's 34) was **my selection, not a finding**. Output retracted;
the panel is now imported.

⭐ The census's own `OBS_BANDS` comment states the rule I broke — *imported, not redefined* — and I
broke it on the very next constant along.

**Corrected panel reproduces the census exactly: 34 ECMWF-served, 26 routed away.**

---

## The discriminator

RV-09 left two readings open for why the GFS lane scores 0.30–0.32 at the 26 sites the EURO lane
routes away from ECMWF, against its own 0.177 at the other 34:

- **(a)** the GFS lane is serving something degraded there → a real defect
- **(b)** an artifact of buoy-vs-spot coordinates → the finding dissolves

**Both are wrong. The answer is a third thing, and it is visible in `coverage_status`:**

| | sites | GFS `is_estimated` | GFS coverage |
|---|---|---|---|
| **EURO routed AWAY from ecmwf** | **26** | **0** | `inside_global_coarse` 22, `coarse_gap_direct_point` 4 → **26 of 26 COARSE** |
| **EURO served by ecmwf** | **34** | **0** | `inside_global_coarse` 15, **`inside_regional_tile` 19** → **56% on a regional tile** |

**The GFS lane is not estimating and not stale anywhere — it is on the COARSE GLOBAL GRID at every
one of the 26 sites where it scores badly.**

Joining that against RV-09's per-provider MAE (both partitions are keyed on the same split):

> **GFS MAE is 0.30–0.32 where it runs on coarse global coverage, and 0.177 where a regional tile
> is available at 56% of sites. Same model, same hour, same resolver — different input resolution.**

And the EURO lane routes to copernicus / a GFS-derived fallback at exactly those coordinates, for
the same underlying reason: **no regional tile exists there.**

---

## What this means for the default-model question

**The flip is the wrong lever.** Restricted to sites with comparable coverage, EURO beats GFS by
**2.9%** (n=34). The 36.7% headline is **tile coverage wearing a model's clothes.**

Switching the default to EURO would **paper over a coverage gap at 26 of 60 buoys** — buying a
one-off accuracy gain while leaving the actual cause in place, and making it harder to see.

⭐ This lands exactly on the audit lineage's standing conclusion, now for the **third audit
running**, but measured on the *accuracy* axis for the first time rather than asserted:

> **the binding constraint is input coverage — 0.25° tiles, break depth, shore normals — not
> physics, and not model choice.**

The existing tile-coverage work (0.25° regional expansion, `+4 regions / 241 spots`, `per_cycle`
2→3) is therefore not a background chore. **It is the accuracy roadmap**, and this is the first
measurement that prices it: closing coverage at the coarse sites is worth roughly **0.30 → 0.18 m
MAE**, about a 40% error reduction at the affected coordinates — far more than the 2.9% a model
flip buys.

---

## Corroborated at scale, and it is not new

**`resolution` is `null` at 60 of 60 sites, on both models.** WS-CAN-0014 was recorded from a single
Pipeline sample; it is now confirmed universal across a global 60-buoy panel.

⚠️ That matters more than it looks here: **`coverage_status` is the field that just answered this
question, and `resolution` — the field that would have answered it numerically — is empty
everywhere.** The diagnostic worked despite the gap, not because of it.

---

## Status of the original question

| Question | Answer |
|---|---|
| Does EURO's bias help in the tail? | **Still unknown.** `big >3m` unsampled; the pool is running |
| Is EURO a better model? | **Barely — 2.9%, n=34, one hour.** Not a basis for a flip |
| Why did EURO look 36.7% better? | **Coverage.** 26 of 60 sites have no regional tile |
| Should the default flip? | **No. Fix coverage instead** |
| Is the GFS lane defective at those sites? | **No** — not estimating, not stale, correct behaviour on a coarse grid |

## Still open, unchanged by this probe

1. The **RV-08 vs RV-09 flat-band bias contradiction** (+0.239 archive vs −0.148 census). The
   buoy-vs-spot coordinate hypothesis is **not** resolved by this probe — it tested a different
   question. Still open.
2. The **tail**. Needs big surf to exist.
3. `EURO/gfs_estimated_fallback` outscoring `GFS/noaa` by 70% at the same coordinates — now *partly*
   explained (those are coarse-coverage sites where GFS is weak), but a GFS-derived estimate beating
   the GFS lane still deserves its own look.
