# 2026-11-15 — opus: a cheaper rebuild for the Gulf-filled world frames

Session: the frame-carry side session, asked by the director (2026-11-15 10:47 EST): build the cheaper Gulf-filled rebuild (fill only
the masked nodes, reusing an already-built plain frame), because the pilots job is tight on time, now carrying six new raster sets.
Branch `opus/filled-masked-rebuild` from dev `3b5240622`.

## Why (measured, PR #914)

In five pilots runs after #832, the three EURO swell `global_mid_filled` sets carried NOTHING (111-118 frames rebuilt per set per run,
`unchanged` 0): the GFS donor changes every run, so the bytes really change. They now cost ~45-75 s a set, most of the six sets'
140-219 s per run. Carrying cannot help, so the rebuild itself has to get cheaper.

## The gate, pre-registered (written 15:48Z, before any code)

1. **Byte-identical output.** Every frame the new path writes has exactly the bytes today's full rebuild writes: the same `sha256`,
   and the same index entry (path, source, meta, coarse_fill). Checked across at least two runs' worth of donor changes: the
   same EURO products against two different GFS donor cycles, plus a third pairing in which the EURO run changes too. A frame
   the new path cannot prove identical falls back to the full rebuild, never to a different frame.
2. **Step time.** The filled sets' publish time is cut by at least 50%, measured on the same inputs, old path vs new path,
   same machine, same process.
3. **Kill switch.** An env switch restores today's full rebuild, wired into `forecast-ingest-pilots.yml` as `${{ vars.X || '1' }}`.

The parity gate stays on every frame written (no frame is published unchecked), and no served number moves.

Reviews: LongCat review of the diff; the advisor red-teams the PR. No merge from this session.
