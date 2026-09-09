# Coastal delivered-grid replay

This diagnostic runs four disposable pages in the actual app: default, blend,
blend repeat, default repeat. It captures public GFS wave grids once, crops the
old regional resident from the incoming grid without changing cell values,
and records those exact inputs and hashes for replay.

The real map moves from zoom 8 to 6.862 over Florida. Normal renderer guards
must hide the small resident and show its coarse bridge. Replacement then
uses the larger, same-time grid. The opt-in handoff must start exactly once
in each blend leg and never in either default leg. Frames, coastal mask
samples, identities, real clock intervals, errors and blocked publications
are recorded. Frame hashes identify captured evidence; fresh app sessions
are not claimed to be pixel-identical or perfectly controlled for basemap
loading and real-time animation.

Use the `coastal_replay` input in Marine Nightly, or against its existing dev
server boot: `node scripts/marine-coastal-replay/run.cjs OUTPUT_DIRECTORY`.
Set `COASTAL_REPLAY_INPUT` to a previously saved `coastal-input.json` to reuse
delivery exactly. `ZL_BASE` defaults to `http://localhost:3009`.
The CI job's existing basemap/test-auth setup is required; no new credentials
or production writes are used. Unit/refusal controls run with
`node --test scripts/marine-coastal-replay/verify.test.cjs`.

External `setWaveData` calls are blocked while measuring, except calls inside
the renderer itself. This deliberately isolates the delivered-grid boundary.
It does **not** verify network selection, served-time propagation in the React
hook, revision-driven mask patching, or the full publication lifecycle.
The fixed random seed does not freeze the real clock. The capture observer
adds work; its time and render intervals are retained.

A successful job means a complete diagnostic was collected. It grants no
visual or scientific release approval. The existing nightly visual budgets,
production resolution and 600 ms fade are unchanged. The handoff remains
off by default. Inspect the measured steps and cadence before deciding on a
repair; never infer treatment effectiveness from an untriggered candidate.
