"""One-field proof (2026-10-19): the per-time-step field image must decode back to the stored product exactly.

Pins services/frame_image.py (encoding, orientation, missing cells) and scripts/publish_frame_images.py (which product
it picks, the self-parity gate, the cache policy of what it writes). Offline only: LocalCache + LocalSink, no network.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services.frame_image import SCALE_M, decode_heights, encode_png, encode_rgba, parity  # noqa: E402


def _product(cols=4, rows=3, valid="2026-10-19T12:00:00Z", missing=()):
    vectors = []
    for r in range(rows):          # stored rows count from the SOUTH
        for c in range(cols):
            ok = (r, c) not in missing
            vectors.append({"lat": -10 + 10 * r, "lng": 10 * c, "speed": round(0.3 + 1.234 * r + 0.1 * c, 3) if ok else 0.0,
                            "direction": (40 * r + 15 * c) % 360, "is_valid": ok})
    return {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid", "valid_time": valid,
            "run_time": "2026-10-19T06:00:00Z", "model_run_time": "2026-10-19T06:00:00Z", "value_unit": "m",
            "product_id": "p", "grid": {"bounds": {"south": -10, "north": 10, "west": 0, "east": 30},
                                        "cols": cols, "rows": rows, "vectors": vectors}}


def test_round_trip_is_exact_to_the_millimetre_through_real_png_bytes():
    product = _product()
    png, meta = encode_png(product)
    check = parity(product, *pub.decode_png(png))
    assert check == {"nodes": 12, "max_abs_err_m": check["max_abs_err_m"], "bad": 0}
    assert check["max_abs_err_m"] <= SCALE_M / 2
    assert (meta["width"], meta["height"], meta["row0"]) == (4, 3, "north")


def test_image_row_zero_is_the_north_edge():
    product = _product()
    rgba, w, _h = encode_rgba(product)
    northmost = product["grid"]["vectors"][2 * 4]          # stored row 2 = north, column 0
    code = (rgba[0] << 8) | rgba[1]                        # image pixel (0, 0)
    assert (code - 1) * SCALE_M == pytest.approx(northmost["speed"], abs=SCALE_M / 2)


def test_missing_cells_stay_missing_and_are_not_zero_height():
    product = _product(missing={(0, 1), (2, 3)})
    rows = decode_heights(*encode_rgba(product))
    assert rows[0][1] is None and rows[2][3] is None
    assert rows[0][0] is not None
    assert parity(product, *encode_rgba(product))["bad"] == 0


def test_parity_catches_a_single_corrupted_node():
    """Mutation control: without this, a parity check that always says 0 would pass every test above."""
    product = _product()
    rgba, w, h = encode_rgba(product)
    broken = bytearray(rgba)
    broken[5 * 4 + 1] ^= 0x10                               # low height byte of one pixel: 16 mm off
    assert parity(product, bytes(broken), w, h)["bad"] == 1


def test_shape_mismatch_refuses():
    product = _product()
    product["grid"]["vectors"].pop()
    with pytest.raises(ValueError):
        encode_rgba(product)


def test_picks_the_nearest_authoritative_target_product():
    now = datetime(2026, 10, 19, 13, 0, tzinfo=timezone.utc)
    base = {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
    products = [
        dict(base, filename="a", valid_time_start="2026-10-19T09:00:00Z"),
        dict(base, filename="b", valid_time_start="2026-10-19T12:00:00Z"),
        dict(base, filename="c", valid_time_start="2026-10-19T13:00:00Z", is_estimated=True),
        dict(base, filename="d", valid_time_start="2026-10-19T13:00:00Z", region_id="global_coarse"),
        dict(base, filename="e", valid_time_start="2026-10-19T13:00:00Z", model="EURO"),
        dict(base, filename="f", valid_time_start="2026-10-19T14:00:00Z"),
    ]
    assert pub.pick_entry(products, now)["filename"] == "b"   # 12Z and 14Z tie at 1 h; the earlier wins


def test_publish_writes_an_immutable_image_and_a_revalidating_index(tmp_path):
    store_dir, out_dir = tmp_path / "store", tmp_path / "out"
    store_dir.mkdir()
    product = _product()
    (store_dir / "p.json").write_text(json.dumps(product))
    (store_dir / "manifest.json").write_text(json.dumps({"products": [
        {"model": "GFS", "domain": "marine", "layer": "waves", "region_id": "global_mid",
         "filename": "p.json", "valid_time_start": product["valid_time"]}]}))
    # Since step 2b (2026-10-20) the proof reads the runner's own files (LocalCache) and never downloads a product.
    source, sink = pub.LocalCache(store_dir), pub.LocalSink(out_dir)
    record = pub.publish_png_proof(source, sink, now=datetime(2026, 10, 19, 12, tzinfo=timezone.utc))
    assert record["path"] == "gfs/waves/global_mid/20261019T060000Z/20261019T120000Z.png"
    assert record["parity"]["bad"] == 0 and record["bytes"] == (out_dir / record["path"]).stat().st_size
    assert sink.headers[record["path"]] == {"content-type": "image/png", "cache-control": pub.IMMUTABLE}
    assert sink.headers["manifest.json"]["cache-control"] == "no-cache"
    index = json.loads((out_dir / "manifest.json").read_text())
    assert index["frames"][0]["path"] == record["path"]
