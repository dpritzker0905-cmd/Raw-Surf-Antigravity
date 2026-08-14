# Not produced

Worker runtime state was established by source reading and by the E2E lane, not by capture. Two web
workers exist: `frontend/src/engine/workers/forecast-decode-worker.js` and
`frontend/src/components/map/GridParserWorker.js`.

Boundary contracts B-08 and B-09 in `../../BOUNDARY_CONTRACT_MATRIX.csv` classify both as
**Explicit and Tested** (WS-CAN-0008 covers crash handling and reply ordering).

Full inventory: `../source-inventory/workers-sw.md`.
