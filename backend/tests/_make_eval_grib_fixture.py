"""Regenerates tests/fixtures/eval_harness/synthetic_3x4_three_packings.grib2 (needs eccodes; not a test).

Three GRIB2 messages of the SAME 3x4 regular lat/lon field (one bitmap-masked point), packed 5.0 (simple), 5.3
(complex + spatial differencing: what the GFS pgrb2 atmosphere file uses for the served wind) and 5.40 (JPEG 2000:
what GFS-Wave uses). Synthetic values only.

    python tests/_make_eval_grib_fixture.py tests/fixtures/eval_harness/synthetic_3x4_three_packings.grib2
"""
import sys

import numpy as np


def main(out: str) -> None:
    import eccodes as ec
    vals = np.array([[1.25, 1.5, 1.75, 2.0], [0.5, 9999.0, 1.0, 1.125], [3.0, 2.5, 2.25, 0.75]])  # north -> south
    msgs = []
    for pk in ("grid_simple", "grid_complex_spatial_differencing", "grid_jpeg"):
        h = ec.codes_grib_new_from_samples("GRIB2")
        for k, v in (("Ni", 4), ("Nj", 3), ("latitudeOfFirstGridPointInDegrees", 34.0),
                     ("longitudeOfFirstGridPointInDegrees", 240.0), ("latitudeOfLastGridPointInDegrees", 33.5),
                     ("longitudeOfLastGridPointInDegrees", 240.75), ("iDirectionIncrementInDegrees", 0.25),
                     ("jDirectionIncrementInDegrees", 0.25), ("jScansPositively", 0)):
            ec.codes_set(h, k, v)
        for k, v in (("discipline", 10), ("parameterCategory", 0), ("parameterNumber", 3), ("bitsPerValue", 16)):
            ec.codes_set(h, k, v)
        ec.codes_set(h, "missingValue", 9999.0)
        ec.codes_set(h, "bitmapPresent", 1)
        ec.codes_set(h, "packingType", pk)
        ec.codes_set_values(h, vals.ravel())
        msgs.append(ec.codes_get_message(h))
        ec.codes_release(h)
    with open(out, "wb") as f:
        f.write(b"".join(msgs))


if __name__ == "__main__":
    main(sys.argv[1])
