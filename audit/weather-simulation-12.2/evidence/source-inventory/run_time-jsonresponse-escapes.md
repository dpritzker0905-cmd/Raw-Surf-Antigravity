# route_helpers.py run_time / freshness_sec escapes — verification at HEAD 791fdf78

## Reproduction (commands run)
- `grep -n "datetime.now" backend/services/weather_pipeline/route_helpers.py`
  -> 4 hits: 432, 476, 551 are `"run_time": datetime.now(timezone.utc).isoformat()`;
     673 is `created_at` in an unrelated helper (NOT part of the claim).
- `grep -n "freshness_sec" backend/services/weather_pipeline/route_helpers.py` -> 459, 501, 582 (literal 1800).

## The three builders and their runtime reachability
| Builder | def line | run_time | freshness_sec | Reached from | Class |
|---|---|---|---|---|---|
| make_unsupported_icon_swell2_grid_response | 426 | 432 | 459 | grid_resolver.py:148 | Active-reachable |
| make_unsupported_icon_swell2_point_response | 470 | 476 | 501 | point_resolution.py:234 | Active-reachable |
| make_grid_miss_point_response | 542 | 551 | 582 | point_resolution.py:262, :281 | Active-reachable |

No flag gate: grid_resolver.py:148 fires immediately after the disconnect check for any
ICON + swell_2 request; both layer and model are accepted by the route regex in routes/weather.py.

## Error in the submitted proof
The claim cites "routes/weather.py:167 (make_no_coverage_grid_response)" as a reach for a run_time site.
make_no_coverage_grid_response (route_helpers.py:505) emits a 4-key 404 body with NO run_time and NO
freshness_sec. The actual third reach is grid_resolver.py:148. Count of 3 builders is unaffected.

## response_model bypass — VERIFIED REAL
routes/weather.py get_point does `elif isinstance(response, JSONResponse): return response`, which in
FastAPI skips response_model=NormalizedPointResponse validation. Mechanism confirmed.
BUT: these payloads carry no grid, so there is no `resolution` to stamp. Omission is measure-or-refuse
COMPLIANT (WS-CAN-0014's own rule: a value you cannot measure reaches the wire as None). Not a defect.

## Schema coupling (why this is not separable from WS-CAN-0005)
`run_time: datetime` is NON-Optional at schemas.py:67, :168, :297 — exactly the "non-Optional on THREE
schemas" constraint WS-CAN-0005 already records as its reason for needing a staged plan.

## Absence claim + positive control
`grep -c route_helpers` across the 4 register files -> 0,0,0,0.
Positive control `grep -c point_resolution` -> 2,1,0,2. Technique works for 3 of 4 files;
FINISH_LINE_GAP_MATRIX.csv cites neither file paths nor field names, so it is not a coverage source here.

## History
`git log -S 'datetime.now(timezone.utc).isoformat()' -- route_helpers.py` -> 7b5726ff, ec00ae33 only.
Nothing in the last 12 commits touches these lines.
