# Ingestion progress and model-cycle health repairs

Local source qualification, 2026-10-05. Hosted successor and deployment are pending.
These address WI-02/WI-03 in the separate83-ID deep audit; they do not automatically close
the original50-row register or any publication/science/performance finding.

## WI-02: actual current-invocation product acknowledgments

The actual CLI/store/HTTP boundary reproduced five failure assertions twice before source
changes, with five positive controls passing each time. A metadata HTTP acknowledgment,
manifest-only upload, failed product plus successful metadata, or prior invocation timestamp
could make an empty invocation return0. The initial run attempted a fixture-invalid pointer
lookup; the second run also isolated read_pointer. No live cloud write or credential was used.

The CLI now collects only uploads submitted by save_product/save_products_batch during its
production ingestion call. A strict actual Storage200/201 acknowledgment is required. Product
Futures remain owned by that collector, even if they complete after a timeout; old acknowledgments
cannot satisfy a new invocation. Pending references are removed on completion. A300s bounded
drain uses a condition variable and does not shut down shared executors. Outside collection,
regular save paths keep their existing asynchronous call/argument behavior.

An empty/no-op/test-fixture/restore-only run, unavailable storage, blocked writer, all failed
uploads or unresolved product uploads returns1. At least one acknowledged product with a
drained queue returns0, preserving the existing partial-success contract while logging failures.
This does not prove every expected lane, manifest publication, two-writer CAS or consumer readback.
Health/calibration/manifest uploads never count as product progress.

The18 controls use actual normalized native/estimated products, atomic saves and the real uploader
with only HTTP/producer/storage-service boundaries isolated. They include asynchronous drain,
timeout/late prior acknowledgment, submission failure and repeated invocation controls.

## WI-03: verified cycle freshness independently of ingest liveness

Seven failure assertions reproduced twice before repair, with17 passing controls. With ingest
age1h fixed, model-cycle age7h/19h/55h all reportedok. Missing/estimated provenance and a stale
swell component hidden by a fresh total-wave product were also incorrectly healthy.

The read-only health report now grades the latest receipt cohort separately for each global
component/tier/tile and native-versus-estimated class. It never infers cycle identity from
run_time or valid_time. Retained older cohorts cannot poison a refreshed component; new unknown
receipts cannot borrow older verified provenance; estimated products cannot hide stale native
cycles. Per-lane cycle fields report the oldest known current-cohort age, known/mixed/unverified
status, explicit unknown reasons and effective thresholds. Missing/estimated/invalid/naive/future
provenance warns; a stale known cohort remainscritical even when other provenance is unknown.
Slow regional pilots are outside the always-on global check, as before. Model/product selection,
geometry, forecast values and the14-day contract do not change.

Cadence defaults:6h GFS and atmospheric ICON/IFS;12h ICON/GWAM and EURO/Copernicus marine.
Warnings allow two cadences plus6h publication/ingest slack; critical allows three plus6h:
18/24h for6h sources,30/42h for12h sources. These are operational policy choices informed by
provider schedules, not provider freshness guarantees or measured forecast skill. Comparisons
use unrounded age. Finite positive ordered per-model/domain overrides use
HEALTH_MODEL_CYCLE_WARN_HOURS_<MODEL>_<DOMAIN> and
HEALTH_MODEL_CYCLE_CRITICAL_HOURS_<MODEL>_<DOMAIN>; invalid overrides fall back safely.
No provider override was set. Unknown legacy provenance can now produce a truthfulwarn; this
monitoring behavior is unconditional in the candidate, while forecast/science flags stay off.

Primary schedule sources checked2026-10-05:

- [NOAA GFS-Wave](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/wavemodels.php)
- [DWD GWAM](https://www.dwd.de/DE/leistungen/opendata/help/modelle/legend_ICON_wave_EN_pdf.pdf?__blob=publicationFile&v=3)
- [Copernicus current product/PUM](https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-027.pdf)
- [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data)

## Qualification and remaining acceptance

Actual local67 health/product controls pass:49health (16prior+33new),18product progress.
Expanded216 controls pass twice, including immutable/legacy manifest publication, pointer,
concurrent merge, retention, provenance, writer gates, batch isolation and flag parity.
Fatal Python lint and backend LOC pass; all648files remain<=800. The36 floor controls pass.
Local Python lacks two declared packages; hosted Linux is the full-suite authority.

Selectors checked from backend cwd, new file staged before selection:18new chain cases and
33new guards cases. Projected5577backend=2393guards+2071chain+1113estate; frontend unchanged3700.
Floors increase from2354/2047 to2387/2065, with matching2393/2071references. Estate unchanged.
Collection caught a one-case guards projection error before publication; corrected to33, not34.
No skip, discovery, exemption or baseline change; no existing floor lowered.

Jacobian lens: metadata success→failure no longer changes empty-cycle exit (both1); verified
cycle age7h→55h now changes healthok→critical while ingest age1h remains fixed. No physical
forecast-skill gain claimed. Hosted exact-source CI remains a commitment, not projected success.
Real publication/readback canary, upstream-job internals, every-lane completion and rollout of
new health warnings remain separate acceptance. No merge/deployment/provider write/activation.
