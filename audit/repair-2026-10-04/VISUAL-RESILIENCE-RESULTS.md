# Visual resilience repair results


## 2026-10-06 02:47Z: visual resilience repairs and owner idle-map update

The owner reports no further map interaction since the Gulf screenshot. New supplied
console capture:12warnings each1FPS, one12-window guardrail trip and marine fallback
override, recovery2/2; no captured hard shader/render error. This confirms the trigger,
not that native GL was actively drawing or physically slow. Original Gulf cause open.

New source: fallback suppresses native resolution metadata; native recovery resumes
current-grid reading, all layouts share LegendTicks. Storage getter/getItem failures
cannot break legacy guard/arbiter/legend decisions or the engine diagnostic read;
initial client read stamps its false fallback consistently. Guardrail now requires a
new non-skipped marine call and initialized resident, excludes loading/debounce, and
a completed retry relinquishes ownership before any later foreign fallback. Real slow
native animation still trips. Kill:__RAW_DISABLE_GUARDRAIL_RENDER_EVIDENCE__=true.
Marine/wind compile/link/allocation failures release their initialization batch before
buffer allocations; public init reports failure to existing layer fallback handlers.

Before twice:34controls32fail2pass;12guardrail10fail2pass; later caller3fail24pass
before fix. **62new regressions**, final**135expanded twice**, full**365suites/3808tests**.
Production compilation succeeds with inherited warnings. Full lint ratchet86errors/
917warnings succeeds; scoped19inherited errors1inherited warning remains, not clean lint.
LOC0new/regressed. Initial sandbox Jest cache failure collected0; later harness syntax/
browser process-env errors and wrong-cwd lint scope were rejected, not accepted evidence.

Two isolated actual Chrome WebGL2 runs report AMD Radeon890M/D3D11: all3marine/5wind
programs link and dispose; a deliberately invalid actual shader frees6/6marine and
10/10wind handles, failure reported, initializedfalse; GLerrors0. Scoped initialization
acceptance only; no full-map pixels, physical forecast, live FPS/heap or other devices.
Application-context external requests0; isolated localhost, no live map/forecast load.

Fresh Dev readonly preflight fails OAuth refresh before SQL; no cloud canary, SQL/
Storage writes or credential access. Publication/PG/card/science gates stay open.
Prior543954fd publication readback resolves700, ledger701. Owner evidence702, repairs703,
own exact hosted commitment704 pending, source publication705 awaits final readback.
Projection5764backend/3808frontend is not an actual new hosted result. Source changes
frontend only; all new science/serving flags0/unset, Netlifyfreeze, no merge/deploy.
