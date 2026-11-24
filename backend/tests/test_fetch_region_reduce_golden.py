"""The GFS-Wave pass's reductions moved into services/_fetch_region_reduce.py (2026-11-16, option B step 1) BYTE-IDENTICALLY.

Before / after equality, as the director asked: the real `fetch_global_coarse` on the loop-shadow suite's stubbed GRIB (structured
fields, a land band, a zero-energy cell), in four configurations, must produce the SAME payload bytes as the code before the move.
The digests below were computed from dev fdd992449 (the inline loop, before the move) and reproduced by the moved code
(2026-11-16); a hosted CI run of THIS FILE ALONE on a branch cut from dev (no fetcher change) is cited in #962.
A CHANGE DETECTOR, NOT A CORRECTNESS CHECK: the digest says the payload bytes did not move, not that they are right (the parity
suites say that). A deliberate change of numbers re-derives them: run this file's configurations on the NEW code, paste the new
sha256 values here, and say in the PR which change moved them and why. Mutants (2026-11-16): a 0.01 % height change breaks the
three block configurations; a 0.01 % native-branch change breaks vec_native_0p25.
"""
import hashlib
import json

import pytest

from tests.test_vector_blockmean_loop_shadow import _INTERIOR_BBOX, _run

GOLDEN = {   # (vector flag, partition confidence, resolution, bbox, REGRID_NATIVE_CELL) -> sha256 of the sorted-key JSON payload
    "vec_partconf_1deg": ("1", "1", 1.0, _INTERIOR_BBOX, "0",
                          "4c34e90f19d83416f4edf6ace2e47ce51d5183100fcc2919963598d8c90ba785"),
    "vec_plaindir_1deg": ("1", "0", 1.0, _INTERIOR_BBOX, "0",
                          "d770908b6119d98176a66d252a5bd077c1db1c0955e834deb9db8c7f5e954dc7"),
    # open water (the stub's land band covers rows 4-9, so the first box at -10..10 was almost all None and its digest could not
    # see a native-branch value change: the advisor's mutant survived there, 2026-11-16)
    "vec_native_0p25": ("1", "1", 0.25, {"west": -10.0, "south": 30.0, "east": 10.0, "north": 50.0}, "1",
                        "9b494f54282c62f826536acd020505d037d082e3926a36a287f9023eec04f299"),
    "vec_partconf_30deg": ("1", "1", 30.0, None, "0",
                           "4d45982a3bc3ddab52df01c8d6806b399f39ff1d1c2203138d80e015290c2625"),
}


# FLAG-ON GOLDENS (2026-11-24, #1267, D-090): GFS_PARTITION_MASKED_AS_ZERO (code default ON) DELIBERATELY moves the partition
# heights and the partition direction confidences: a masked partition subcell counts as zero energy where the total is valid
# (services/_fetch_partition_mask.py; Plan 4 and its pre-registered acceptance in
# docs/weather-program/research/P0-PHYSICS-FIX-PLANS-2026-11-23.md; SCOREBOARD row 2026-11-24 06:00Z). The REFACTOR parity above
# is kept exactly: it runs with the flag OFF, which reproduces the 2026-11-16 digests byte for byte. These pin the flag-ON
# bytes, computed on #1267's code (3afb7e2d9 + this change) from the same configurations; nothing else differs between the two.
GOLDEN_FLAG_ON = {
    "vec_native_0p25": "06882047b1959af41fbb5677a717e03472ba6f9231ffcc28d6423fc2b726378b",
    "vec_partconf_1deg": "bf3435b3670c84cdc10286fa3df539e307f40a573ccbe6b3893886a53917e7d5",
    "vec_partconf_30deg": "9bd222aaf8fa2c6e67f1e91262ae1a0152d0e3850cc03a209246061263992dd4",
    "vec_plaindir_1deg": "8b859dbb33e0651f957593dacdffa04f3061429618c28e68a8638111e89f6e10",
}


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_the_moved_reductions_give_the_payload_bytes_the_inline_loop_gave(monkeypatch, name):
    """The refactor's byte parity, with GFS_PARTITION_MASKED_AS_ZERO OFF: the inline loop never had the fill."""
    vec, part_conf, res, bbox, native, digest = GOLDEN[name]
    monkeypatch.setenv("REGRID_NATIVE_CELL", native)
    payload = _run(monkeypatch, vec, part_conf=part_conf, resolution=res, bbox=bbox, masked_zero="0")
    assert payload, "the stubbed run produced nothing: the digest would compare emptiness"
    got = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    assert got == digest, f"{name}: the GFS-Wave payload changed ({got})"


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_the_flag_on_payload_bytes_are_pinned(monkeypatch, name):
    """GFS_PARTITION_MASKED_AS_ZERO ON (its code default): the same configurations, the deliberately moved bytes."""
    vec, part_conf, res, bbox, native, off_digest = GOLDEN[name]
    monkeypatch.setenv("REGRID_NATIVE_CELL", native)
    payload = _run(monkeypatch, vec, part_conf=part_conf, resolution=res, bbox=bbox, masked_zero="1")
    assert payload, "the stubbed run produced nothing: the digest would compare emptiness"
    got = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    assert got != off_digest, f"{name}: the flag changed nothing here, so this pin could not see it"
    assert got == GOLDEN_FLAG_ON[name], f"{name}: the flag-ON GFS-Wave payload changed ({got})"
