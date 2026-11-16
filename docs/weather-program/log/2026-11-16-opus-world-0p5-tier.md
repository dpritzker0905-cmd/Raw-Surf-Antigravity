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
