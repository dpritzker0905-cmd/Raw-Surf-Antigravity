"""
Manifest CDN cache policy (2026-07-06, the stale-manifest root).

manifest.json mutates every few minutes but was uploaded with CDN max-age 3600 — Supabase edges
served the serve box's periodic L2 restore copies up to an HOUR stale and INCONSISTENTLY (live:
restore counts oscillated 6218→6210→6338→6211; the rebuilt EURO estimated tail appeared at the
05:37Z pull and VANISHED at 06:07Z, so far-hour requests 404'd against a healthy L2). Products
are immutable-per-filename, so caching them hard stays correct; the manifest must always
revalidate — and downloads must cache-bust to defeat edges still holding old-policy copies.
"""
import inspect
import re

from services.weather_pipeline.store import manifest_cache_control, manifest_download_url


def test_manifest_uploads_with_no_cdn_cache():
    assert manifest_cache_control("manifest.json") == "0"


def test_immutable_products_keep_the_hour_cache():
    assert manifest_cache_control("gfs_marine_waves_global_coarse_20260706T000000Z.json") == "3600"
    assert manifest_cache_control("euro_marine_waves_global_coarse_20260719T000000Z_estimated.json") == "3600"


def test_run_keyed_manifests_are_immutable_and_keep_the_hour_cache():
    # S2 run-keyed copies never mutate — hard edge caching is the whole point of the pointer lane.
    assert manifest_cache_control("manifests/manifest-g000000000042.json") == "3600"


def test_mutating_namespaced_state_blobs_get_the_short_cache():
    # 2026-07-14: spot_ratings/latest.json carried the product default 3600 — the serve box could
    # read an HOUR-stale ratings object off a CDN edge, silently undoing checkpoint merge-uploads.
    assert manifest_cache_control("spot_ratings/latest.json") == "60"
    assert manifest_cache_control("spot_ratings/size_climatology.json") == "60"
    assert manifest_cache_control("calibration/buoy_latest.json") == "60"


def test_manifest_download_url_is_cache_busted_and_unique():
    a = manifest_download_url("https://x.supabase.co", "weather-products")
    assert a.startswith("https://x.supabase.co/storage/v1/object/weather-products/manifest.json?cb=")
    assert re.search(r"\?cb=\d+$", a)


def test_upload_path_uses_the_policy_helper():
    """The upload header must come from manifest_cache_control — a literal '3600' regression
    would silently re-poison the CDN for the manifest."""
    from services.weather_pipeline.store import ProductStore
    src = inspect.getsource(ProductStore._upload_to_supabase)
    assert "manifest_cache_control(filename)" in src
    assert '"cache-control": "3600"' not in src


def test_restore_download_is_cache_busted():
    """The restore helper must fetch the manifest via the cache-busted URL (client .download()
    hits the CDN edge un-busted)."""
    from services.weather_pipeline import store_helpers
    src = inspect.getsource(store_helpers._restore_from_supabase_inner)
    assert "manifest_download_url" in src
