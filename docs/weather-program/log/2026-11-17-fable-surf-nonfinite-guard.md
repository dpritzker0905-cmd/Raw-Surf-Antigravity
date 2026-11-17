# 2026-11-17 Fable: a non-finite height or period gives no surf estimate (robustness fix)

Session: Fable repair lead (`e372475c`). Branch `fable/surf-nonfinite-guard`. Asked for by the director
(2026-11-17 10:46 EST), on a finding by LongCat that the research lead verified.

## 2026-11-17 16:05Z What was found, what I reproduced, and the fix

**Reproduced on `dev` before any change** (`surf_transform.estimate_surf`, shelf 20 m by 10 km, with and without
geometry):

| input | before | after |
|---|---|---|
| period +inf | raises `ZeroDivisionError` (Komar: L0 = inf, then 0.0 ** -0.2), bulk AND partitioned | no estimate |
| height +inf | **a finite height, the depth cap (2.3 m with a 3 m break depth), regime `breaking`** | no estimate |
| height +inf, open ocean | `inf` passed through as `open_ocean` | no estimate |
| height -inf | `(0.0, calm)` | no estimate |
| period -inf | no estimate (it failed the `<= 0` test) | no estimate |
| NaN in either | no estimate (already guarded) | no estimate |

- The brief named the crash. The second row is the worse one and was not in the brief: an infinite height did not
  crash, it came back as a plausible number that nothing downstream could tell from a real one.
- "No estimate" is `(None, 'unknown')`, the path NaN already took.

**The fix, two lines of logic.**
- `estimate_surf`: the NaN test becomes `math.isfinite` on both inputs, placed where it was, before every other
  branch.
- `komar_breaker_height`: the same test in its own "non-physical inputs" guard, because it raised on an infinite
  period and returned NaN on an infinite height when called directly.

**What this changes that a user could see.** Nothing for any finite input: the guard is the first test and finite
values pass it unchanged. For a non-finite input the chain used to crash, or to serve the cap; it now serves no
estimate. No flag: there is no sea state for which the old behaviour is right. No SCOREBOARD row: no number for a
real sea state moves. If a reviewer reads the second row as a served change that needs one, I will add it.

**Why now.** Ensemble members carry fill values. Once they feed the chain, an infinity is an expected input.

**Tests.** `backend/tests/test_surf_nonfinite_inputs.py`, 42 cases (guards lane must read the figure the floor
script prints for this branch). Run against the unfixed code first: 19 fail. They cover ten non-finite pairs through
the bulk call with and without geometry, the open-ocean and unknown-depth branches, the Komar step, a partition with
an infinite period, the point composition at the pipeline sweep coordinate, large but finite inputs (still a finite
estimate), and the edges that already had an answer (zero and negative heights and periods, None).

**Checked beside it.** The 51 existing test files that touch the chain's entry points: 794 pass. One other test,
`test_weather_sim_mcp.py::test_database_update_propagation`, fails on my machine with "no such table:
condition_reports"; it fails identically on `dev`'s unmodified file, so it is a local database fixture and not this
change. Not fixed here.

**Not done.** I did not look for where a non-finite value could enter the chain upstream (the fetchers, the
normalizer, the consensus). This guard is the last line, not the first.

## 2026-11-17 16:29Z Second item in the same PR: the frame decoder refuses a bad buffer, and caps what a gzip may expand to

Asked for by the director (2026-11-17 11:13 EST), on findings by LongCat that the helper verified. File:
`backend/services/frame_binary.py`. Each fault reproduced on `dev` before any change, on a real encoded frame (the
codec test's golden product: 252 bytes, four fields, header 168 bytes).

| buffer | before | after |
|---|---|---|
| `header_bytes` set to 72 or to 8 (inside the header) | **decodes WITHOUT error**: the planes are read out of the header and come back as numbers | ValueError: header_bytes disagrees with the descriptor table |
| 10 bytes; the fixed header only | `struct.error` | ValueError: truncated, with the byte counts |
| a field 0 bytes wide | `IndexError` (`decode_frame`); a numpy reshape error (`decode_plane`) | ValueError: bad descriptor |
| a field 3 bytes wide; an unknown layout | a truncation message about the wrong thing, or decoded | ValueError: bad descriptor |
| a gzip of 200 MB of zeros (204 kB of input) | 200 MB allocated, then "bad magic" | ValueError before the cap is passed |

- **The first row is the worst and is the one the brief put first.** A wrong header length did not fail. It produced
  a frame of wrong values.
- **`decode_plane`, the vectorised twin, had every one of these faults** and was not in the brief. It is fixed with
  the same code.

**The fix.**
- `checked_header(data)`: one function both decoders call. It checks the buffer holds the fixed header, that
  `header_bytes` equals 72 plus 24 per descriptor, that the buffer holds the whole descriptor table, and that each
  field is 1, 2 or 4 bytes wide with layout 0 or 1. Every fault is a ValueError that says what is wrong.
- `gunzip_capped(data)`: decompression through `zlib.decompressobj` with a maximum output, so the cap is applied
  WHILE decompressing and at most the cap plus one byte is ever held. A corrupt or truncated gzip is a ValueError.
- `MAX_FRAME_BYTES` is 64 MB. The largest frame written today is the 0.25-degree world lattice with five fields,
  about 8.3 MB raw; a test pins that the cap is at least four times that.
- `read_header` refuses a buffer shorter than the fixed header.

**What this changes that a user could see.** Nothing for a good frame: the 247 existing tests across the 14 files
that touch the codec pass unchanged, a good frame decodes to the same values plain and gzipped, and the byte layout
is untouched (encode side not edited). The decoder is used by the publisher's parity gate and by offline scripts.

**Tests.** `backend/tests/test_frame_binary_validation.py`, 48 cases (estate lane), for BOTH decoders: eighteen
seeded bad buffers each with the message it must give; every truncation length from 0 to 251 bytes; a seeded fuzz of
600 header byte-flips that may only ever raise ValueError; a real gzip bomb just past the cap; the cap's edge. By
hand, switching off each of the six checks in turn fails between 2 and 14 tests.

**Not done, and worth knowing.**
- Trailing bytes after the last plane are still accepted. Rejecting them is a tightening nobody asked for and I did
  not check every producer; say if it is wanted.
- A flipped byte in a field's scale, offset or missing code still decodes: those are values, not structure. The
  browser decoder (`staticFrameCodec.js`) is a separate implementation and was not touched or checked.
- The publisher's parity gate compares a decoded frame with its source, so a silently mis-decoded frame would most
  likely have been refused there. That is a reason the first row had not bitten, not a reason to leave it.

## 2026-11-17 16:45Z After the advisor's read of the first item: one sentence owed, one behaviour pinned, and two faults found and NOT fixed here

The advisor passed the non-finite guard at `449e811cf` (PASS, no open condition) and asked for two small things.

**The sentence it asked for.** For a non-finite height the value this chain returns changes from the depth cap to no
estimate. Whether any such value ever reached a user is not known. The guard is the last line of defence; it is not
evidence that nothing upstream produces these.

**Pinned: what the partitioned path does with one bad train.** It drops that train and keeps the others, wherever
the bad one sits in the list; with nothing usable it returns no estimate so the caller falls back to the total
field. That was already the behaviour for the HEIGHT. Tested for six kinds of bad train in three positions.

**A third fault found while pinning it, and fixed, because it is the same fault.** A dropped train's period still set
the period used for the depth cap: the cap takes the longest period in the list, including trains that contributed
nothing. With an infinite-period train the cap rose to its ceiling (2.345 to 2.430 m in the test case, a 3 m break
depth); a NaN period made the maximum depend on the order of the list. Now a non-finite period is not counted.
Finite periods are read exactly as before.

**Found, and NOT fixed here: the same cap fault with FINITE inputs.** A train with a height of zero and a period of
25 s is dropped from the sum and still raises the cap by the same amount (2.345 to 2.430 m). That is an ordinary
input, not a fill value. Fixing it means taking the cap's period from the trains that were actually used, which
changes served heights wherever the cap binds and an unused train has the longest period. That is a served change:
it needs a flag, a kill switch and a SCOREBOARD row under D-065, and a measurement of how often it happens. It is
relevant in production: the bulk partition lane is off by default, but the ECMWF period-band lane feeds this
function when bands are present. Reported to the director and the advisor; not touched.

**Found, and NOT fixed here: large FINITE fill values** (the advisor's point, reproduced). GRIB and netCDF fills are
numbers, not infinities, and they pass `isfinite`:

| input | returned today |
|---|---|
| height 9.97e36, 1e20 or 9999 m | the depth cap, regime `breaking` |
| height 35 m | the depth cap |
| period 9999 s or 9.97e36 s | a finite `shoaling` height |

A plausibility bound at the same place would close it, but it changes the result for finite inputs, so it is its
own change with its own line in the record, after checking what the normalizer already masks so the bound is set
once and in the right layer. Not done.

## 2026-11-17 17:07Z Two things from the advisor on the frame decoder: a rebuild at merge that I had not said, and a loosening closed

The advisor passed the PR at `f77aa0703` (PASS WITH LIMITS, no open condition) and raised two points.

**PLAN AT MERGE: every content-keyed frame set rebuilds once.** I wrote above that this change alters nothing a user
could see. That is true of the frames, and it left out an operational consequence. `frame_binary.py` is one of the
files in `frame_set_content.CODE_FILES`, whose hash is the code fingerprint in every frame set content key. Editing
the file changes the fingerprint, so on the first pilots run after this merges NO frame set is carried over and every
one is rebuilt, once. The rebuilt frames have the same bytes (the encode side is untouched), but the run does the
full work. So: do not merge this just before a pilots run that is tight on time, and expect one long run.
- I did not measure how long a full rebuild takes.
- The alternative, moving the decoder checks to a file outside `CODE_FILES`, would avoid the rebuild but would put
  half of one decoder in another module; I did not do it.

**A loosening I introduced, now closed.** `gzip.decompress` refused trailing garbage after the gzip stream and joined
a second gzip member. My capped version read the first member and ignored whatever followed, silently. It now raises
a ValueError that names the number of bytes after the stream. One frame is one gzip member (`gzip_frame` writes
one). The advisor ran both cases against the earlier commit; a test now covers trailing bytes and a second member,
for both decoders, and fails with the check switched off.

Codec tests: 50 in the new file (estate lane must read 3870); the 297 across every file that touches the codec pass.
