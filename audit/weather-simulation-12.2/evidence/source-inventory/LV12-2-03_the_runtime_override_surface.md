# LV12.2-03 — 261 runtime override globals; the program governs 3

**Captured** 2026-08-13, HEAD `791fdf78`. Read-only greps over `frontend/src`. Every count below is
reproducible from the command shown; nothing is estimated.

---

## The census

```bash
# distinct globals referenced in NON-TEST frontend production code
grep -rhoE "window\.__(RAW|OM)_[A-Z0-9_]+__" frontend/src --include=*.js --exclude=*.test.js \
  | sort -u | wc -l
#   → 261

# distinct globals referenced in test files
grep -rhoE "window\.__(RAW|OM)_[A-Z0-9_]+__" frontend/src --include=*.test.js | sort -u | wc -l
#   → 74

# production globals with NO reference in any test file  (comm -23)
#   → 197

# production globals documented anywhere in docs/ or CLAUDE.md
#   → 223   (so 38 are undocumented)

# production globals appearing ANYWHERE in the entire Audit 12.1 output directory
grep -rhoFf <(sed 's/window\.//' prod_globals.txt) audit/weather-simulation-12.1/ | sort -u | wc -l
#   → 5
# POSITIVE CONTROL: __RAW_MARINE_ARBITER__ is one 12.1 does name → found. The search works.
```

| quantity | count | share |
|---|---|---|
| runtime override globals in production frontend code | **261** | — |
| …documented in `docs/` or `CLAUDE.md` | 223 | 85.4% |
| …referenced by at least one test | 64 | 24.5% |
| …**with no test reference at all** | **197** | **75.5%** |
| …**visible anywhere in the Audit 12.1 program** | **5** | **1.9%** |

They span 143 files. Exactly one `NODE_ENV` guard exists across
`frontend/src/components/map/*.js`, and it gates an error-boundary detail panel
(`MapErrorBoundary.js:37`) — **not** any of these globals.

---

## What they actually do

They are not all boolean kill switches. The population mixes kill switches, numeric tuning levers
and legacy-path selectors, read with a typed default:

```js
// frontend/src/components/map/marineEngineDecisions.js:113
const hi = (typeof w.__RAW_RATING_SPAN_FADE_HI__ === 'number') ? w.__RAW_RATING_SPAN_FADE_HI__ : 9.5;

// frontend/src/components/map/WebGLMarineEngine.js:1656
const _haHi = (typeof window !== 'undefined' && typeof window.__RAW_BLEND_HEIGHT_HI__ === 'number')
  ? window.__RAW_BLEND_HEIGHT_HI__ : 1.4;
```

Both of those change what the user sees as a **forecast quantity** — the rating band's fade span and
the height blend ceiling. Neither is behind a build flag, an auth check, or an environment gate.
Anything with access to the page — the browser console, a bookmarklet, an extension, a compromised
third-party script — can set them before or during boot and change the numbers the map displays,
with no record that it happened.

---

## Why this is a coverage gap and not a duplicate

I checked every plausible covering row before writing this:

| Existing row | Scope | Why it does not cover the class |
|---|---|---|
| **WS-OBJ-402** *Exit every dual-path migration* | **exactly 3** named paths: the commit arbiter (`__RAW_MARINE_ARBITER__`), the settle debounce, the ICON >168 h blend | Governs three migrations. Says nothing about the other 258 switches, most of which are not migrations at all. Its acceptance criterion ("a dated arm-or-delete decision per path") is not even meaningful for a numeric tuning lever. |
| **WS-CAN-0043** arm the marine arbiter | one flag | one flag |
| **WS-CAN-0032** settle-debounce promotion | one flag | one flag |
| **WS-CAN-0052 / 0053** `SURF_PARTITIONS` / `SURF_TIDE_DEPTH` | **backend** env flags | different mechanism, different process, owner-gated |
| **SOTA B2** *every migration has an exit condition* | same 3 paths | same |
| **SOTA B12** *kill switch and control arm* | scored ✅ **MET** — "the program's strongest habit" | This is the sharp irony: the habit that earned a MET is *the thing that produced 261 ungoverned globals.* B12 grades that a kill switch **exists**; nothing grades that it is ever **removed, inventoried, tested or reported**. |
| **WS-CAN-0020** telemetry uplink | client→server transport | The uplink's payload is fixed-cardinality and does **not** include which overrides are set — so even once built, a support incident still cannot reconstruct the client's actual configuration. |

**The gap is a class, not an instance:** there is no objective that owns the *runtime override surface
as a whole* — no inventory, no default-value assertion, no expiry, no telemetry of which are set, and
no test for three quarters of them.

## Severity, honestly stated

This is **not** an immediate security blocker. Setting these requires page access, and an attacker
with page access has better options. The real costs are:

1. **Irreproducibility.** A user-reported wrong number cannot be reproduced without knowing 261 bits
   of hidden state, and the program has no way to read them back. This is the same failure mode that
   burned 32.6 rating points in a local measurement once already (an untracked overlay).
2. **Silent drift.** 197 have no test, so a default can be changed — or a lever can stop being read —
   without anything reddening.
3. **A measurement lane hazard.** A flag wrong in the *measuring* lane is worse than in the measured
   one, and `zoomlab.js` takes `ZL_FLAGS` to set exactly these globals pre-boot. An A/B run that
   forgets to clear them grades the wrong build.

## Acceptance criterion that would close it

A generated inventory (name → file:line → default → owner → expiry) that CI regenerates and diffs, so
adding a global without an entry fails; a single accessor so every read is instrumentable; and the
set of non-default overrides included in the truth/telemetry payload. Closing does **not** require
deleting any flag.
