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


# Changed-input lifecycle controls. All storage and HTTP operations are replaced locally.
@pytest.fixture
def restore_case(tmp_path, monkeypatch):
    from services.weather_pipeline import store as sm, store_helpers as sh, manifest_pointer as mp
    import requests
    from types import SimpleNamespace

    for key, value in {"_cached_manifest": None, "_cached_manifest_mtime": 0,
                       "_last_manifest_sha": None, "_pending_manifest_sha": None,
                       "_restored_count": 0, "_restore_errors": [],
                       "_restore_in_progress": False}.items():
        monkeypatch.setattr(ProductStore, key, value, raising=False)
    for name in ("NODE_ENV", "ENV", "IS_PROD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MANIFEST_RESTORE_SKIP_UNCHANGED", "1")
    monkeypatch.setenv("PRODUCT_RUN_KEYED_NAMES", "0")
    monkeypatch.setattr(sh, "is_test_environment", lambda: True)
    state = SimpleNamespace(store=ProductStore(tmp_path), wire=b"", downloads=0, sm=sm, sh=sh, mp=mp)

    def download():
        state.downloads += 1
        return state.wire

    def no_network(*args, **kwargs):
        raise AssertionError("restore regression test attempted network")

    monkeypatch.setattr(sm, "_get_supabase_storage", lambda: object())
    monkeypatch.setattr(mp, "fetch_pointed_manifest", download)
    monkeypatch.setattr(requests.sessions.Session, "request", no_network)
    return state


def _restore_entry(name, **changes):
    row = dict(model="GFS", provider="NOAA", domain="marine", layer="waves",
               run_time="2026-11-07T00:00:00Z", valid_time_start="2026-11-07T06:00:00Z",
               valid_time_end="2026-11-07T06:00:00Z", resolution=0.25, freshness_sec=0,
               is_forecast_authoritative=True, coverage=dict(west=-85, south=24, east=-79, north=31),
               filename=name, product_id=name)
    row.update(changes)
    return row


def _restore_wire(*products, stamp="2026-11-07T01:00:00Z"):
    return json.dumps(dict(last_manifest_update=stamp, products=products,
                           written_by="designated:offline-test")).encode()


def _restore_names(case):
    return [p.filename for p in ProductStore._cached_manifest.products]


def test_changed_restore_drops_remote_raw_before_validating_local_copy(restore_case, monkeypatch):
    import weakref
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("remote.json"))
    case.store.manifest_path.write_bytes(_restore_wire(_restore_entry("local.json")))
    original_loads = json.loads
    original_validate = PipelineManifest.model_validate
    refs = []
    released = []

    class Raw(dict):
        pass

    def loads(*args, **kwargs):
        value = Raw(original_loads(*args, **kwargs))
        refs.append(weakref.ref(value))
        return value

    def validate(cls, value, *args, **kwargs):
        if len(refs) == 2:
            released.append(refs[0]() is None)
        return original_validate(value, *args, **kwargs)

    monkeypatch.setattr(json, "loads", loads)
    monkeypatch.setattr(PipelineManifest, "model_validate", classmethod(validate))
    assert case.store.restore_from_supabase() == (1, [])
    assert len(refs) == 2
    assert released == [True], "remote raw tree still overlaps local validation"


def test_changed_restore_drops_unused_local_models_before_serializing(restore_case, monkeypatch):
    import weakref
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("remote.json"))
    case.store.manifest_path.write_bytes(_restore_wire(_restore_entry("unused-local.json")))
    original_validate = PipelineManifest.model_validate
    original_dump = PipelineManifest.model_dump_json
    refs = []

    def validate(cls, value, *args, **kwargs):
        model = original_validate(value, *args, **kwargs)
        if model.products[0].filename == "unused-local.json":
            refs.extend([weakref.ref(model), weakref.ref(model.products[0])])
        return model

    def dump(model, *args, **kwargs):
        assert refs and all(ref() is None for ref in refs), "unused local models overlap serialization"
        return original_dump(model, *args, **kwargs)

    monkeypatch.setattr(PipelineManifest, "model_validate", classmethod(validate))
    monkeypatch.setattr(PipelineManifest, "model_dump_json", dump)
    assert case.store.restore_from_supabase() == (1, [])


def test_invalid_local_manifest_drops_raw_tree_before_serializing(restore_case, monkeypatch):
    import weakref
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("remote.json"))
    case.store.manifest_path.write_bytes(_restore_wire({"filename": "invalid.json"}))
    original_loads = json.loads
    original_dump = PipelineManifest.model_dump_json
    refs = []

    class Raw(dict):
        pass

    def loads(*args, **kwargs):
        value = Raw(original_loads(*args, **kwargs))
        refs.append(weakref.ref(value))
        return value

    def dump(model, *args, **kwargs):
        assert len(refs) == 2 and all(ref() is None for ref in refs)
        return original_dump(model, *args, **kwargs)

    monkeypatch.setattr(json, "loads", loads)
    monkeypatch.setattr(PipelineManifest, "model_dump_json", dump)
    assert case.store.restore_from_supabase() == (1, [])
    assert _restore_names(case) == ["remote.json"]


@pytest.mark.parametrize("environment, expected", [
    ({}, ["remote.json", "fixture.json", "estimate.json"]),
    ({"ENV": "production"}, ["remote.json"]),
    ({"NODE_ENV": "production"}, ["remote.json"]),
    ({"IS_PROD": "true"}, ["remote.json"]),
])
def test_changed_restore_preserves_local_merge_policy(restore_case, monkeypatch, environment, expected):
    case = restore_case
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    case.wire = _restore_wire(_restore_entry("remote.json"))
    case.store.manifest_path.write_bytes(_restore_wire(
        _restore_entry("native.json"), _restore_entry("fixture.json", is_test_fixture=True),
        _restore_entry("estimate.json", is_estimated=True),
        _restore_entry("remote.json", is_estimated=True)))
    assert case.store.restore_from_supabase() == (len(expected), [])
    assert _restore_names(case) == expected
    assert json.loads(case.store.manifest_path.read_bytes())["written_by"] == "designated:offline-test"


def test_changed_restore_preserves_fixture_and_icon_horizon_filters(restore_case, monkeypatch):
    case = restore_case
    monkeypatch.setattr(case.sh, "is_test_environment", lambda: False)
    case.wire = _restore_wire(_restore_entry("native.json"),
        _restore_entry("fixture.json", is_test_fixture=True),
        _restore_entry("overclaim.json", model="ICON", domain="wind", layer="wind",
                       valid_time_start="2026-11-16T00:00:00Z"),
        _restore_entry("estimated.json", model="ICON", domain="wind", layer="wind", is_estimated=True,
                       valid_time_start="2026-11-16T00:00:00Z"))
    assert case.store.restore_from_supabase() == (2, [])
    assert _restore_names(case) == ["native.json", "estimated.json"]


def test_unchanged_restore_skips_parse_but_changed_bytes_rebuild(restore_case, monkeypatch):
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("first.json"))
    assert case.store.restore_from_supabase() == (1, [])
    cached = ProductStore._cached_manifest
    with monkeypatch.context() as scope:
        def no_parse(*args, **kwargs):
            raise AssertionError("unchanged manifest was parsed")
        scope.setattr(PipelineManifest, "model_validate", no_parse)
        assert case.store.restore_from_supabase() == (1, [])
        assert ProductStore._cached_manifest is cached
    case.wire = _restore_wire(_restore_entry("second.json"))
    assert case.store.restore_from_supabase() == (1, [])
    assert _restore_names(case) == ["second.json"]
    assert ProductStore._cached_manifest is not cached
    assert ProductStore._last_manifest_sha == hashlib.sha256(case.wire).hexdigest()


def test_failed_write_keeps_cached_object_and_retry_does_not_skip(restore_case, monkeypatch):
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("first.json"))
    assert case.store.restore_from_supabase() == (1, [])
    cached = ProductStore._cached_manifest
    digest = ProductStore._last_manifest_sha
    case.wire = _restore_wire(_restore_entry("second.json"))
    with monkeypatch.context() as scope:
        def failed_dump(*args, **kwargs):
            raise OSError("injected serialization failure")
        scope.setattr(PipelineManifest, "model_dump_json", failed_dump)
        count, errors = case.store.restore_from_supabase()
    assert count == 0 and errors
    assert ProductStore._cached_manifest is cached
    assert ProductStore._last_manifest_sha == digest
    assert not ProductStore._restore_in_progress
    assert case.store.restore_from_supabase() == (1, [])
    assert _restore_names(case) == ["second.json"]


def test_cache_busted_response_is_released_before_local_validation(restore_case, monkeypatch):
    import weakref
    import requests
    from services.weather_pipeline.schemas import PipelineManifest
    case = restore_case
    case.wire = _restore_wire(_restore_entry("remote.json"))
    case.store.manifest_path.write_bytes(_restore_wire(_restore_entry("local.json")))
    monkeypatch.setenv("SUPABASE_URL", "https://offline.invalid")
    monkeypatch.setenv("SUPABASE_KEY", "synthetic-test-value")
    monkeypatch.setattr(case.mp, "fetch_pointed_manifest", lambda: None)
    refs = []
    original_validate = PipelineManifest.model_validate
    calls = []
    released = []

    class Response:
        status_code = 200
        content = case.wire

    def get(*args, **kwargs):
        response = Response()
        refs.append(weakref.ref(response))
        return response

    def validate(cls, value, *args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            released.append(refs[0]() is None)
        return original_validate(value, *args, **kwargs)

    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(PipelineManifest, "model_validate", classmethod(validate))
    assert case.store.restore_from_supabase() == (1, [])
    assert len(calls) == 2
    assert released == [True], "response still owns the remote bytes during local validation"
