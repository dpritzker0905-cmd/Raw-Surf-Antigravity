# LV-10 — WS-CAN-0061 is refuted as written, and replaced by a larger, reproducible defect

**Objective:** WS-OBJ-101 · **Task:** WS-CAN-0061 (**re-scoped**) · **Date:** 2026-08-13
**Surface:** `dev--rawsurf.netlify.app/map`, `9febd970` = HEAD · owner-driven console + visual
**Production files modified: NONE.**

---

## 1. The task as written is refuted

WS-CAN-0061 read: *"Every `om://` raster layer renders blank at the map zoom floor (z2–z3)."*
Its packet's Step 0 was to read `blockedDetail` and fix whichever side of the `model_lock`
comparison was wrong.

| Claim in the task | Measurement | Verdict |
|---|---|---|
| the block is `model_lock` | `blockedDetail` **null** at z2 **and** z3, across **48 traced URLs**; the only block recorded is `transparent_sentinel` | **REFUTED** |
| the defect is at the zoom floor | water temp decodes **nothing at z3 either** (`decodedDelta 0` at both zooms) | **REFUTED** |
| `isModelMatch` is at fault | `__OM_ACTIVE_MODELS__ = ["ncep_gfs025"]` hits the allowlist early-return, and `ncep_gfs*` hits the `f.includes('gfs')` early-return. `isModelMatch('ecmwf_ifs025','EURO')` → `getParentModel` → `EURO === euro` → **true** | **INNOCENT** |

## 2. The actual defect

**Water temperature renders nothing under EURO, at every zoom. It paints correctly under GFS.**

Owner-confirmed visually, both directions, same session, same view:

```
model = EURO   z3 decodedDelta 0    z2 decodedDelta 0    screen: blank
model = GFS                                              screen: "water temp paints fine"
```

This is **model-conditional, not zoom-conditional** — a bigger and more coherent bug than the one
the task described, and it explains "blank at both zooms" exactly.

## 3. Four hypotheses died, each to a measurement

| # | Hypothesis | Killed by |
|---|---|---|
| 1 | the `model_lock` branch blocks at the floor | `blockedDetail` null on 48 URLs at both zooms |
| 2 | `useOpenMeteoTileUrls` pins the slots to the sentinel at the floor | identical sentinel state at z3 and z2 — **not zoom-dependent, so not the floor bug**. (Also: reading `slot-0` alone is invalid — `:633` parks the two *inactive* slots on the sentinel by design) |
| 3 | `__OM_ACTIVE_MODELS__ = []` is the cause | the owner's session reads `["ncep_gfs025"]`. The empty array was **an artifact of activating the layer with a programmatic `.click()`** and is not user-reachable |
| 4 | ECMWF lacks `surface_temperature`, so the metadata gate at `:562` serves transparent tiles | **primary source refutes it** — see §4 |

⭐ Hypothesis 4 was the best-argued of the four: `resolveModel` (`:508-528`) has an **explicit,
unconditional cross-fall to `ncep_gfs013` for ICON + `surface_temperature`** (`:518-520`) and **no
equivalent for EURO** — EURO only crosses over past the atmospheric cutover *hour* (`:524`). That
asymmetry is real and visible in the code. It is simply not the cause here.

## 4. Primary-source check — the CDN's own metadata

`GET https://map-tiles.open-meteo.com/data_spatial/<model>/latest.json`

| model | n_vars | `surface_temperature` | `temperature_2m` | `visibility` |
|---|---|---|---|---|
| `ecmwf_ifs025` | 119 | **PRESENT** | PRESENT | ABSENT |
| `ncep_gfs013` | 29 | **PRESENT** | PRESENT | ABSENT |
| `dwd_icon` | 123 | **ABSENT** | PRESENT | ABSENT |
| `ncep_gfs025` | 316 | ABSENT | — | **PRESENT** |

Three things this settles:

1. **`ecmwf_ifs025` serves `surface_temperature`.** The metadata gate cannot be firing for water temp
   under EURO. Hypothesis 4 is dead.
2. **The in-code claim at `:509-510` — *"probed 07-11: t2m on all three routes; surface_temperature
   on gfs013+ifs025 only — dwd_icon lacks it"* — is STILL ACCURATE** 33 days later, including the
   ICON absence that justifies the cross-fall at `:518`. A rare case of a dated probe comment
   surviving re-verification; worth recording, because this program's default assumption is that
   such comments go stale.
3. **`ncep_gfs025` serves `visibility`**, so fog's data source is valid and fog's blankness is *not*
   a missing-variable problem either.

⚠️ **Fog is an uninterpretable test layer and should not be used again.** `visibility < 1 km` is
genuinely rare; a blank fog layer on a clear day is *correct output*. Two probes in this session
were spent on it before that was recognised. **Water temp is the correct probe layer** — it has a
value at every ocean pixel, so blank is unambiguous, and it is the layer the original
z2.99/z2.00 measurement used.

## 5. ANSWERED — one defect, and the zoom framing is retired

**On GFS at z2, water temp still paints** (owner-confirmed visually, 2026-08-13).

The full 2×2, same layer, same session, same view:

| | z3 | z2 |
|---|---|---|
| **GFS** | paints | **paints** |
| **EURO** | blank | blank |

⇒ **There is exactly ONE defect: `om://` raster layers render nothing under EURO, at every zoom.**
⇒ **Zoom is not a factor.** WS-CAN-0061's "zoom floor" premise is retired in full. No successor task
should carry it.

⚠️ **Still unexplained, and deliberately not assumed away:** the original session recorded
`z2.99 → 45 entered / 20 decoded` and `z2.00 → 24 entered / 0 decoded` on this same layer. With zoom
now excluded as a variable, the most likely reading is that **the model changed between those two
readings** — which would make that measurement a mis-attributed instance of *this* defect rather than
evidence of a second one. That is a hypothesis, not a finding; it needs the model recorded alongside
any future zoom comparison. **Record the active model with every om:// measurement from now on** —
its absence is what let a model-conditional bug be reported as a zoom-conditional one.

## 6. Required changes to the register

- **WS-CAN-0061** — retitle from *"every `om://` raster layer renders blank at the zoom floor"* to
  **"water temp (and possibly every `om://` raster) renders nothing under EURO at every zoom"**.
  Severity **HIGH, user-visible**. The `model_lock` / `isModelMatch` lead is **closed as refuted**;
  do not reopen it without new evidence naming a `blockedDetail` value.
- **The next mission packet must not reuse the old Step 0.** It is answered.
- Probe-layer rule for any successor: **use water temp, never fog.**
