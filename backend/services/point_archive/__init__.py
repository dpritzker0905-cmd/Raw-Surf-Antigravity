"""The program's ONE point archive (gate served-wave-verify-v1 section 0, director 2026-11-22).

Every point-forecast record in the weather program goes here, tagged with a `purpose` (`served`: the served-frame
verification archive; `nearshore_eval`: the MOP-lite lane, #1156, which aligns to this package in its own PR). One buoy
list, one QC module, one truth-snapshot store, one writer, one time convention:

  core.py     schema `point-archive/1`, paths, time / lead rules, statuses, canonical JSON
  qc.py       NDBC parse + QC (the text sentinel MM is global; numeric fills are rejected by PER-FIELD ranges, L-S30)
  writer.py   immutable gz JSONL per (purpose, model, run) + SHA256SUMS + verify_archive; truth snapshots
  storage.py  the stores the writer runs on: a local folder (tests, offline) and a Supabase bucket (CI only)
  buoys.py    the frozen buoy list: load, validate, hash, regional box assignment
  cells.py    the deterministic buoy -> cell rule and the grid hash

Nothing in this package runs on the Render box, and nothing here is imported by the serving path.
"""
