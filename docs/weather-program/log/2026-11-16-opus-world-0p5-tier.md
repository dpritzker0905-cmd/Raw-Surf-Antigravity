# 2026-11-16 — opus: a 0.5-degree world wave tier (option B), gates first

Session: the frame-carry side session. Move 3 measured that inside a pilot box first-visit frames are exact in 0-17 ms (the
regional bundle), and the coarse-then-fine gap is OUTSIDE the boxes. The director asked for real sizing of two options (A: 3-4x
more 0.25-degree pilot boxes; B: a 0.5-degree world ocean tier). The sizing was sent 2026-11-16 ~06:40Z from pilots 43775249410
and the live CDN. The director, 01:46 EST: "approved to BUILD option B dark ... TILED at 30x30, fused into the GFS Marine pass,
with a vectorized encoder, keeping the 0.25 pilots. Do NOT do A. Commit gates (1)-(4) exactly as written, before any code."
Publishing (its variable) and the client flip go to the owner with the measured numbers. Nothing turns on before then.
Branch `opus/world-0p5-tier` from dev. Written 07:12Z, before any code.

## The sizing it rests on (sent to the director; "scaled" = from a measured figure, not built)

- The source is already fetched: GFS Marine Pilot makes ONE pass over `gfswave global.0p25` (12 messages an hour by byte range,
  about 7 MB an hour) for all 129 hours and all 20 regions together, in 19.0 min (00:48-01:07Z, 47,455 points). The full 0.25 field
  is decoded every hour, so 0.5 is a stride-2 sample of the same pass.
- Today's 2-degree world frame (181 x 83 = 15,023 nodes) is 55 KB median on the CDN (3.7 B a node). Scaled to 0.5 degree (721 x 331
  = 238,651 nodes): about 0.88 MB a frame, about 113 MB a run a layer (129 frames), about 450 MB a run for GFS's 4 marine layers,
  and about 0.9 GB with 2-run retention.
- It cannot go through stored products (16 x today's 2.3 MB world product JSON, about 19 GB a run). Frames must be encoded from the
  decoded hour inside the GFS pass.
- Today's world encoder took 31 s for 129 frames of GFS swell_1 (0.24 s a frame at 15 k nodes); scaled, about 3.8 s a frame and
  about 33 min a run for 4 layers. So it needs a numpy-vectorized encoder (the raster build_frame does 4.1 M nodes in 1.3 s).
- The frames step already skipped 92 regional sets for its 960 s budget in that run, so B runs outside the frames step.
- Whole-globe frames would cost about 113 MB a full single-layer scrub. Hence 30 x 30 degree tiles (72), so a view fetches only the
  tiles it shows: about 1.6 MB a tile a scrub, about 3-6 MB a typical view.
- A (19 boxes to 60-75): about +40 min to GFS Marine Pilot alone (about 48 s a region for 4 layers, measured), plus ICON/EURO
  pilots and the frames step. It does not fit, and gaps remain between boxes.

## The gates, pre-registered (exactly as sent to the director)

(1) **Parity:** every 0.5-degree node equals the 0.25-degree GFS-Wave value at that point after quantisation (fb.parity bad = 0),
    and equals today's 2-degree world frame and the 0.25-degree pilot frames at shared nodes within quantisation.
(2) **Coverage:** all 129 hours per layer; no-data nodes exactly GFS-Wave's own land/ice mask, nothing more; every tile present
    for every hour.
(3) **Budget, measured:** at most 5 min added wall time per run to the pilots job, 0 extra sets skipped in the frames step, at most
    6 MB egress per single-layer full scrub at a typical z4 view (tiled), and at most 1 GB storage with 2-run retention for GFS's 4
    layers.
(4) **Client (Move 3's metric):** a first visit outside a box shows the 0.5-degree frame, never the 2-degree one, at p95 under
    100 ms after the index is loaded.

Order: after G3, G2 and G1(a) (all built as dark PRs: #955, #956, #957, #958).

## 07:23Z: CORRECTION before any code: gate (1) as written cannot hold, by construction

Reading the GFS-Wave pass (`noaa_gfs_wave_fetcher.fetch_global_coarse`) before building: a region's node is NOT a point sample of
the 0.25-degree grid. Each node is the pass's own REDUCTION over a block of native cells whose half-width depends on the region's
resolution (`half = max(1, round(res / 0.25 / 2))`: 2 degrees gives a 9 x 9 block; 0.5 degree a 2 x 2). The reductions are block-mean
heights and periods (NOAA_COARSE_SCALAR_BLOCKMEAN), energy-weighted partition directions, the coherence-gated total-sea
direction blend, and a direction confidence. At 0.25 degree with REGRID_NATIVE_CELL a node reads its exact cell.
So gate (1)'s "equals the 0.25-degree GFS-Wave value at that point" and "equals today's 2-degree world frame ... at shared nodes
within quantisation" cannot both hold for ANY 0.5-degree reduction. They contradict the pipeline's own semantics: a 2-degree block
mean and a 0.5-degree block mean differ by construction. That was my error in writing the gate; it is caught here, before any code.

**Proposed corrected gate (1), for the director's approval BEFORE any build:**
- (1a) **Parity with the pipeline's own reduction:** every 0.5-degree node equals what the existing multi-region path produces
  for a 0.5-degree region on the same decoded hour (the same functions, half = 1), after quantisation (fb.parity bad = 0). The
  reference is the existing path run on a few sample bboxes (it cannot run world-wide through JSON: about 19 GB). It proves the
  vectorized world encoder changes nothing but the packaging.
- (1b) **Agreement with the other tiers, REPORTED, not gated:** at shared nodes against the 2-degree world frame and inside the
  pilot boxes against the 0.25-degree frames: bias and RMS per field (height, period, direction as a circular difference). They
  differ by construction (block width), so a number is reported, not a pass line.
Gates (2)-(4) stand as written.

## 07:43Z: registration addendum (the advisor; still before any code; the corrected (1) was approved by the director, 2026-11-16 02:29 EST)

- **What (1a) can and cannot decide.** (1a) is a PLUMBING IDENTITY. It fails on a wrong publish, a wrong reduction, a wrong tile cut
  or a bad quantisation. It CANNOT fail on "0.5 degree is too coarse to show"; that question lives only in (1b) and in the
  owner's decision.
  **Seeded negatives, added to (1a):**
  - one node altered by one quantum must fail the parity check;
  - a tile whose nodes are shifted one node must fail;
  - a tile labelled with the wrong hour must fail.
- **The tier's role, written down before any result.** The 0.5-degree tier FILLS THE GAP outside the pilot boxes until a finer
  frame arrives (today the 2-degree world frame is all a first visit outside a box sees). It never replaces a 0.25-degree pilot
  frame: inside a box the client keeps the pilot frame. If it were ever proposed as a replacement for a finer grid, that is a new
  decision for the owner, on (1b).
- **How (1b) will be shown (fixed now, before any number exists):** for each of the 4 layers, at a few hours (f000, f048, f120),
  against the 2-degree world frame at shared nodes and against the 0.25-degree pilot frames inside the boxes:
  - bias and RMS for height (m), period (s) and direction (circular, deg);
  - by latitude band (0-30, 30-60, 60-80 degrees);
  - split near the coast (within 1 degree of land in GFS-Wave's own mask) and open ocean;
  - plus the 20 worst nodes per layer with their positions.
  This is the table the owner decides on when the tier is published.
