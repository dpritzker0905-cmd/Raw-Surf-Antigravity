# Public forecast point coordinate repair

## 2026-10-06 03:45Z: WS-08 public point validation, locally accepted

The real `/api/weather/point` router accepted impossible finite coordinates and
reached resolution for nonfinite ones. Two offline runs of88cases produced64failed
guard assertions and24valid passes. The two-coordinate Query repair enforces finite
latitude[-90,90] and longitude[-180,180] before entering the resolver, matching the
existing `/point-rating` geographic bounds. After repair,142expanded controls pass
twice, including all88new cases, adjacent diagnostics and CI floor/discovery guards.
Poles, both dateline endpoints and the owner's Gulf coordinate are accepted; model,
domain, layer, requested time, product and bbox identities are forwarded unchanged.

The recording resolver replaces provider work; this is real HTTP validation, not
an actual upstream/physical forecast or whole-map acceptance. Wrapped map-world
longitudes require a canonical longitude at the client boundary; broader click/world
copy handling is not newly certified here. Direct internal resolver calls are not
covered by FastAPI Query validation. Valid served scientific numbers do not change.
No frontend runtime change or flag activation; no live-map/API load or cloud write.
Local Python differs from declared production packages; hosted qualification714 is
required. LOCratchet passes, no new/regressed file, and selector partition is
186guards/156chain/297estate (new module staged before discovery).

CI estate floor1111=>1199 and paired reference1113=>1201 preserve margin2 using
previous actual1113 +88new controls, a **projection pending hosted CI**, not an
observed total. Overall backend projection5852. Frontend floor365/3808=>367/3872
comes from actual own qualified48c04424 CI37407541898 job112088337571.

The single Dev connector read-only probe failed OAuth token refresh before SQL;
the prepared actual Storage publisher canary remains unexecuted. No login loop.
Original Gulf/clock/native/raster/play/scrub/theme/mobile/FPS/heap, server deadlines,
financial PG/card and held-out science acceptance remain open. Production freeze
and all scientific/serving flags stay as previously recorded. Publication711 is
verified by712; source evidence713, own hosted promise714, publication715 pending.

Implementation follows [FastAPI numeric Query validation](https://fastapi.tiangolo.com/tutorial/path-params-numeric-validations/)
and [Pydantic finite-float constraints](https://docs.pydantic.dev/2.11/api/pydantic/types/),
checked against real router behavior. No dependency upgrades.
