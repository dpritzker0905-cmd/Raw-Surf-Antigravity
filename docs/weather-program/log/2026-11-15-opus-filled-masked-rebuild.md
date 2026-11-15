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

## 17:33Z: what was built, the gate result, and the owner's decision

**Built** (`services/frame_set_fill_patch.py`, ON; kill switch `FRAME_FILLED_PATCH=0`):
- **The patch path.** When the plain set's frame for the same hour is PROVABLY the encode of the same product, the filled frame is
  that frame with only the nodes the fill changed rewritten (`frame_binary.patch_nodes`), and the parity gate checks exactly
  those nodes. The proof:
  1. the plain frame's `content` record (#832) equals this product's content key, code fingerprint included;
  2. the downloaded bytes' sha256 equals the index's;
  3. shape, times and field mask are equal, every changed node keeps its exact lat/lng, and the one value-dependent header byte
     (the uv convention) is recomputed and compared;
  4. the changed nodes are every node whose vector the fill changed.

  Any failure falls back to the full rebuild. `FRAME_FILLED_PATCH_VERIFY=1` also builds the full frame and publishes it on any
  difference (`patch_mismatch`).
- **The donor cache.** `frame_set_fill._donor`: an EURO and an ICON filled set of the same layer share each GFS donor, keyed on
  filename + sha256(bytes) + resolution.
- **The scan memo.** `frame_set_content.masked` is memoised on the bytes object.

**Gate:**
- **1. Byte-identical: MET.** 96 of 96 frames and their index entries are identical to the full rebuild, across two GFS donor
  cycles plus a new EURO run, on single sets and on EURO+ICON pairs. 9 tests; 8 of 8 mutants red.
- **2. >= 50% time cut: NOT MET.** CPU seconds, minimum of 5 interleaved repeats, both switches off vs on: single set
  20.53 -> 10.16 s (51%; wall 49%); EURO+ICON pair 38.89 -> 20.98 s (46%).
- **3. Kill switch: MET.**

**Why it stops there:** the remaining cost is stdlib JSON parsing of the product and donor plus per-node dict work in the fill. A
numpy donor build was bit-identical but not faster (loop 54 ms vs 60 ms; `log/2026-11-15-opus-fast-compact-donor.md`).

**Owner's decision** (David, 12:30 EST in this session, after the recommendation to ship at ~46-51% with byte identity, skip orjson
and stop optimising publish time): "go ahead, open the filled-rebuild PR". The bar this PR ships on is therefore **>= 45% with byte
identity**, NOT the pre-registered 50%. The 50% line is recorded here as missed.

**Context for the cut:** in the 5 pilots runs after #832 no frame set was skipped for budget, and the frames step took 18 of the job's
130 minutes. The ~130-200 s this returns per run goes to the frames step's own budget (the regional bundles), not to the raster
steps.

## 18:01Z: the advisor's red-team (PASS WITH LIMITS), conditions done

Verdict at 8ed5b1c96: header, thread pool and memory sound (shared notes, redteam-922-filled-frame-patch-2026-11-15.md).

Conditions, all done:
1. **The one silent route to a wrong frame** was a future fill writing into the same dicts: no node "changed", so the patched frame
   would be the unfilled one. `try_patch` now checks the changed nodes against the fill's own count (`n_filled`) and
   `coarse_fill.filled_idx`, and falls back (`fill_disagrees`) on any disagreement.
2. A missing or unreadable plain index is counted (`patch_fallback_no_index`), not silent.
3. Also asked for: VERIFY mode compares `encode_header(filled)` with the patched header too; `frame_set_fill_patch.py` joins the
   content-key code fingerprint. This PR edits five fingerprint files, so every content-carried set (#832) rebuilds once after merge.

3 tests added (12 in total); mutants for each new guard red (11 of 11 in total).

Rollout condition, the director's call: run the first live pilots run with repo variable `FRAME_FILLED_PATCH_VERIFY=1`, read
`patched > 0` and `patch_mismatch == 0` in the frames report, then clear it. The advisor also noted that the live saving will be below
46-51%: the ~118 plain-frame GETs per filled set are not in the offline benchmark (local sink).
