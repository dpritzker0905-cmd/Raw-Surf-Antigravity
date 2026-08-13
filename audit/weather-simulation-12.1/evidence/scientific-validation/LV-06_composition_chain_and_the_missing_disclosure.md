# LV-06 — The composition chain holds end to end; the geometry disclosure does not

**Objectives:** WS-OBJ-201 (one composition), WS-OBJ-207 (geometry disclosure)
**Tasks:** WS-CAN-0023 (verify), **WS-CAN-0062 (new)**
**Method:** one read-only GET, `/api/weather/spot-ratings?bbox=-81.0,28.0,-80.3,28.7&valid_time=
2026-08-13T15:00:00Z&model=GFS`, production backend, 2026-08-13T15:48Z. n = 24 spots.
Raw payload: `SV-01_spot_ratings_cocoa.json`.

## 1. ONE FORECAST COMPOSITION — verified current at HEAD

```
model=GFS  valid=2026-08-13T15:00:00Z  served=2026-08-13T14:00:00Z  frame_offset_hours=-1.0
source=precomputed  count=24

Jetty Park            h=0.463  score=19.9  level=poor       conf=medium  geom=full      ref=0.799  limiter=size_gate
Lori Wilson Park      h=0.448  score=18.2  level=poor       conf=high    geom=full      ref=0.832  limiter=size_gate
Cape Canaveral        h=0.466  score=19.4  level=poor       conf=medium  geom=full      ref=0.840  limiter=size_gate
Spessard Holland      h=0.378  score=11.5  level=very_poor  conf=high    geom=full      ref=0.867  limiter=size_gate
Pineda Causeway       h=0.418  score=15.3  level=poor       conf=high    geom=full      ref=0.866  limiter=size_gate
Kennedy Space Center  h=0.485  score=17.8  level=poor       conf=medium  geom=degraded  ref=0.850  limiter=size_gate
why: "~1.5 ft surf, 7s period, 5kt offshore wind"
```

Every row carries **breaking height *and* a 0–100 quality *and* a label**, together, from one
response. `CLAUDE.md`'s ★ requirement — *"a size without a quality is also incomplete"* — is met on
the live serving path. Heights are 0.38–0.49 m against `point.speed` values of ~0.27 m at the same
coordinate (LV-05), i.e. the nearshore breaking transform is being applied, not the offshore
significant height.

**Three further contracts verified in the same payload:**

- **WS-CAN-0023 — `reference_size_m` present on every row** (0.799–0.867). Verified Current at HEAD,
  one day after 12.0 verified it. The glyph discloses the reference the sim parity monitor grades on.
- **`limiter: size_gate`** on all 24 — the score discloses *why* it is what it is.
- **The ask-echo contract is honest.** Asked `15:00Z`, served `14:00Z`, and said so
  (`frame_offset_hours: -1.0`). A silent substitution here would be undetectable; it is disclosed.

## 2. The defect: `confidence` does not move with `geometry_readiness`

```
geometry_readiness: {full: 20, degraded: 4}
confidence:         {medium: 12, high: 11, low: 1}
```

| spot | geometry | confidence |
|---|---|---|
| Jetty Park | **full** | medium |
| Cape Canaveral | **full** | medium |
| **Kennedy Space Center** | **degraded** | **medium** |

**A degraded-geometry spot and a full-geometry spot are indistinguishable by the field the user
actually sees.** `geometry_readiness` is on the wire and correct; `confidence` — the field the UI
surfaces — does not read it. A user cannot tell that Kennedy Space Center's height rests on a
degraded shore solution while Cape Canaveral's does not.

This confirms and generalises the post-12.0 finding at `563f0f73` (*"blind geometry is invisible to
the user — the disclosure is a MISSING WORD"*), which measured **15 of 17 blind spots reporting
`confidence: medium`, identical to full-geometry spots**. It is now reproduced at the
**degraded** tier as well, on a live serving bbox, which is a much larger population: the
post-12.0 census measured **44.0% of 1,052 sampled spots on degraded geometry** (`0a13d56e`).

⚠️ **Scope discipline on that number**: quote it as *"of 1,052 sampled spots"*, never *"of the
estate"* — 4 of 6 regions hit the endpoint's `limit=200` cap (`f39e9cf5` retracted an earlier 47%
figure for exactly this reason). In *this* 24-spot bbox the degraded share is 16.7%.

**This is a disclosure objective, not an accuracy objective.** No number here is wrong. What is
missing is the sentence that says how well it is known — and the platform's own governing principle
is refusal-over-fabrication.

## 3. `run_time` corroboration

`run_time: 2026-08-13T12:57:54.313295Z` — **byte-identical to all four point responses in LV-05**,
from a different endpoint. `wind_run_time: 2026-08-13T13:28:50.732718Z` is a *second, different*
wall clock. Two ingest timestamps, neither a model cycle. WS-CAN-0005 spans both endpoints.
