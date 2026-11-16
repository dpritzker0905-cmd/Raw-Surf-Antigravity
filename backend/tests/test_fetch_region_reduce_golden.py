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


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_the_moved_reductions_give_the_payload_bytes_the_inline_loop_gave(monkeypatch, name):
    vec, part_conf, res, bbox, native, digest = GOLDEN[name]
    monkeypatch.setenv("REGRID_NATIVE_CELL", native)
    payload = _run(monkeypatch, vec, part_conf=part_conf, resolution=res, bbox=bbox)
    assert payload, "the stubbed run produced nothing: the digest would compare emptiness"
    got = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    assert got == digest, f"{name}: the GFS-Wave payload changed ({got})"
