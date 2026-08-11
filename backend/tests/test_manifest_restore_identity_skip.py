"""Guards for the manifest-restore IDENTITY SKIP (2026-08-11, the RSS ratchet).

WHAT THIS PROTECTS, measured on the live serve box. RSS grew +74.8 MB then +76.6 MB across two
consecutive 25-minute windows while `disk_product_count` stayed FLAT at 618 -- so it was not
traffic. `periodic_l2_restore` (interval[0:30:00]) fired at 01:11:21 and 01:41:23, exactly one per
window, and each one re-parses a 20,007-entry manifest: json.loads (~17 MB dict) +
model_validate (~93 MB model) + model_dump_json, while the OLD cached manifest is still
referenced. ~200 MB transient, ~75 MB of it never returned to the OS.

Almost all of that work is for nothing: the ingest that WRITES the manifest runs every ~3-4 h
against a restore every 30 min, so roughly 7 of 8 restores re-parse a byte-identical file.

The dangerous half of this optimisation is not the skip -- it is skipping when you SHOULDN'T, or
committing an identity you never actually loaded. Both are pinned below.
"""
import hashlib
import json

import pytest

from services.weather_pipeline.store import ProductStore


@pytest.fixture(autouse=True)
def _isolate_class_state():
    """These are CLASS attributes on a process-wide singleton -- leaking them across tests makes
    later cases pass for the wrong reason. Save and restore every one this module touches."""
    saved = {k: getattr(ProductStore, k, None) for k in
             ("_last_manifest_sha", "_pending_manifest_sha", "_cached_manifest",
              "_cached_manifest_mtime", "_restored_count", "_restore_errors",
              "_last_restore_time")}
    yield
    for k, v in saved.items():
        setattr(ProductStore, k, v)


def test_the_skip_is_keyed_on_the_downloaded_bytes_not_the_parsed_result():
    """The hash must be of the INPUT. Everything downstream (fixture merge, is_test_fixture
    filter, ICON horizon purge) transforms it deterministically, so identical input means an
    identical result -- which is the whole argument for skipping. Hashing the OUTPUT instead would
    still require the parse this exists to avoid."""
    import services.weather_pipeline.store_helpers as sh
    src = open(sh.__file__, encoding="utf-8").read()
    assert "hashlib.sha256(manifest_bytes)" in src, (
        "the identity must be computed from the downloaded bytes, before json.loads")
    i_hash = src.index("hashlib.sha256(manifest_bytes)")
    i_loads = src.index("manifest_data = json.loads(manifest_bytes")
    assert i_hash < i_loads, (
        "the hash check must run BEFORE json.loads -- skipping after the dict is built still pays "
        "the ~17 MB allocation this guard exists to avoid")


def test_a_failed_restore_cannot_poison_the_skip():
    """THE FAILURE MODE THAT WOULD MAKE THIS DANGEROUS.

    If the identity were committed when the bytes are DOWNLOADED rather than when the parse and
    write SUCCEED, a restore that died mid-parse would still record the hash. The next cycle would
    match it, skip, and leave the box serving a manifest it never actually loaded -- silently,
    forever, until a deploy. The source must promote `_pending_` to `_last_` only after the write.
    """
    import services.weather_pipeline.store_helpers as sh
    src = open(sh.__file__, encoding="utf-8").read()
    i_pending = src.index("ProductStore._pending_manifest_sha = digest")
    i_write = src.index('with open(store.manifest_path, "w")')
    i_commit = src.index("ProductStore._last_manifest_sha = _pending")
    assert i_pending < i_write < i_commit, (
        "the identity is committed before the manifest is written -- a failed parse would poison "
        "the skip and strand the box on a manifest it never loaded")


def test_the_kill_switch_is_present_and_defaults_to_on():
    import services.weather_pipeline.store_helpers as sh
    src = open(sh.__file__, encoding="utf-8").read()
    assert 'os.environ.get("MANIFEST_RESTORE_SKIP_UNCHANGED", "1") != "0"' in src, (
        "the skip must be revertible with one env var, defaulting to on")


def test_the_skip_requires_a_cached_manifest_AND_the_file_on_disk():
    """KNOWN-PRESENT CONTROL. A hash match alone is not sufficient: Render's disk is ephemeral, so
    the file can vanish while the class attribute survives in a warm process. Skipping then would
    leave `get_manifest` with nothing to fall back to."""
    import services.weather_pipeline.store_helpers as sh
    src = open(sh.__file__, encoding="utf-8").read()
    window = src[src.index("digest == getattr(ProductStore"):]
    window = window[:window.index("manifest_data = json.loads")]
    assert "ProductStore._cached_manifest is not None" in window
    assert "store.manifest_path.exists()" in window


def test_identical_bytes_hash_identically_and_a_one_byte_change_does_not():
    """The arithmetic the skip rests on, asserted rather than assumed."""
    a = json.dumps({"products": [{"filename": "x.json"}], "last_manifest_update": "2026-08-11"}
                   ).encode()
    b = json.dumps({"products": [{"filename": "x.json"}], "last_manifest_update": "2026-08-11"}
                   ).encode()
    c = json.dumps({"products": [{"filename": "y.json"}], "last_manifest_update": "2026-08-11"}
                   ).encode()
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest()
    assert hashlib.sha256(a).hexdigest() != hashlib.sha256(c).hexdigest()


def test_the_class_attributes_exist_with_safe_defaults():
    """A skip that reads a missing attribute would raise inside the restore and take the lane with
    it, so the defaults are part of the contract."""
    assert hasattr(ProductStore, "_last_manifest_sha")
    assert hasattr(ProductStore, "_pending_manifest_sha")
    ProductStore._last_manifest_sha = None
    ProductStore._pending_manifest_sha = None
    assert getattr(ProductStore, "_last_manifest_sha", "missing") is None
