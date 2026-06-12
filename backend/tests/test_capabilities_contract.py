import pytest
from fastapi.testclient import TestClient
from server import app

from services.weather_pipeline.capabilities import validate_capabilities_contract

client = TestClient(app)

def test_capabilities_contract():
    """Verify conformed capabilities endpoint schema, fallback sources, and properties."""
    response = client.get("/api/weather/capabilities")
    assert response.status_code == 200
    capabilities = response.json()
    assert isinstance(capabilities, list)
    assert len(capabilities) > 0
    
    # Run the canonical contract validator on the JSON response
    validate_capabilities_contract(capabilities)

    required_keys = {
        "model", "domain", "layer", "provider", "upstream_provider", "upstream_model",
        "source_dataset", "native_horizon_hours", "estimated_horizon_hours", "max_forecast_hours",
        "cadence_hours", "update_frequency", "supports_grid", "supports_point",
        "supports_viewport_dynamic", "supports_global", "backend_owned",
        "frontend_visual_tile_only", "unsupported_reason", "source_docs_note", "fallback_sources"
    }

    for idx, row in enumerate(capabilities):
        # 1. required fields exist on every row
        for key in required_keys:
            assert key in row, f"Missing required key '{key}' in row index {idx}: {row}"

        # 2. fallback_sources is always an array/list
        fallback = row.get("fallback_sources")
        assert isinstance(fallback, list), f"fallback_sources in row {idx} is not a list: {fallback}"

        # 3. every fallback source has correct structure
        for fidx, f_source in enumerate(fallback):
            assert isinstance(f_source, dict), f"Row {idx} fallback source {fidx} is not a dict"
            for key in ["provider", "upstream_provider", "upstream_model", "api", "usage"]:
                assert f_source.get(key), f"Row {idx} fallback source {fidx} missing required key '{key}'"

        # 4. visual-only rows have backend_owned=false and supports_grid/point=false, unless hybrid point_only rows
        if row.get("frontend_visual_tile_only") is True:
            if row.get("supports_grid") == "point_only":
                assert row.get("backend_owned") is True, f"Row {idx} hybrid point-only row has backend_owned=False"
                assert row.get("supports_point") is True, f"Row {idx} hybrid point-only row has supports_point=False"
            else:
                assert row.get("backend_owned") is False, f"Row {idx} visual-only row has backend_owned=True"
                assert row.get("supports_grid") is False, f"Row {idx} visual-only row has supports_grid=True"
                assert row.get("supports_point") is False, f"Row {idx} visual-only row has supports_point=True"

        # 5. backend-owned rows have provider, upstream_provider, upstream_model, source_dataset
        if row.get("backend_owned") is True:
            assert row.get("provider"), f"backend_owned row index {idx} missing provider"
            assert row.get("upstream_provider"), f"backend_owned row index {idx} missing upstream_provider"
            assert row.get("upstream_model"), f"backend_owned row index {idx} missing upstream_model"
            assert row.get("source_dataset"), f"backend_owned row index {idx} missing source_dataset"

        # 6. max_forecast_hours, native_horizon_hours, estimated_horizon_hours are numeric and non-negative
        for key in ["max_forecast_hours", "native_horizon_hours", "estimated_horizon_hours"]:
            val = row.get(key)
            assert isinstance(val, (int, float)), f"Key '{key}' in row {idx} is not numeric"
            assert val >= 0, f"Key '{key}' in row {idx} is negative: {val}"

        # 7. ICON swell_2 check: supports_grid=false, supports_point=false, unsupported_reason present
        if row.get("model") == "ICON" and row.get("domain") == "marine" and row.get("layer") == "swell_2":
            assert row.get("supports_grid") is False, "ICON swell_2 supports_grid must be False"
            assert row.get("supports_point") is False, "ICON swell_2 supports_point must be False"
            assert row.get("unsupported_reason"), "ICON swell_2 must have unsupported_reason present"

        # 8. EURO marine provider/upstream_provider check
        if row.get("model") == "EURO" and row.get("domain") == "marine":
            assert row.get("provider") == "copernicus", "EURO marine provider must be copernicus"
            assert row.get("upstream_provider") == "copernicus", "EURO marine upstream_provider must be copernicus"
            assert row.get("upstream_model") != "ecmwf_wam025", "EURO marine upstream_model must not be ecmwf_wam025 (Open-Meteo fallback model key)"
            
            # fallback_sources includes open-meteo/ecmwf_wam025
            has_om_fallback = False
            for f_source in fallback:
                if f_source.get("provider") == "open-meteo" and f_source.get("upstream_model") == "ecmwf_wam025":
                    has_om_fallback = True
            assert has_om_fallback, "EURO marine fallback_sources must include Open-Meteo ecmwf_wam025"

def test_product_manifest_alignment_audit():
    """Audit test comparing capabilities against products currently in manifest registry."""
    # 1. Fetch capabilities
    cap_resp = client.get("/api/weather/capabilities")
    assert cap_resp.status_code == 200
    capabilities = cap_resp.json()

    # 2. Fetch manifest products
    prod_resp = client.get("/api/weather/products")
    assert prod_resp.status_code == 200
    products_manifest = prod_resp.json()
    products_list = products_manifest.get("products", [])

    # 3. Define target rows to audit
    key_rows = [
        {"model": "GFS", "domain": "marine", "layer": "waves"},
        {"model": "ICON", "domain": "marine", "layer": "waves"},
        {"model": "ICON", "domain": "marine", "layer": "swell_2"},
        {"model": "EURO", "domain": "marine", "layer": "waves"},
        {"model": "GFS", "domain": "wind", "layer": "wind"},
        {"model": "EURO", "domain": "wind", "layer": "wind"},
        {"model": "GFS", "domain": "weather", "layer": "pressure"},
        {"model": "GFS", "domain": "weather", "layer": "precipitation"},
        {"model": "ICON", "domain": "weather", "layer": "pressure"},
        {"model": "ICON", "domain": "weather", "layer": "precipitation"},
        {"model": "EURO", "domain": "weather", "layer": "pressure"},
        {"model": "EURO", "domain": "weather", "layer": "precipitation"},
    ]

    report = []
    mismatch_detected = False

    for target in key_rows:
        model, domain, layer = target["model"], target["domain"], target["layer"]
        
        # Find capability
        cap = next((c for c in capabilities if c["model"].upper() == model.upper() and c["domain"].lower() == domain.lower() and c["layer"].lower() == layer.lower()), None)
        assert cap, f"Missing capability row for key target {model}/{domain}/{layer}"

        # Find matching product in manifest
        prod = next((p for p in products_list if p["model"].upper() == model.upper() and p["domain"].lower() == domain.lower() and p["layer"].lower() == layer.lower()), None)

        if not prod:
            # Report as missing_product_in_manifest
            report.append({
                "target": f"{model}/{domain}/{layer}",
                "capability": f"{cap['provider']}/{cap['upstream_model']}/{cap['source_dataset']}",
                "product": "missing_product_in_manifest",
                "mismatch": "missing"
            })
            continue

        # Compare primary metadata keys
        cap_provider = cap.get("provider")
        prod_provider = prod.get("provider")
        cap_upstream_provider = cap.get("upstream_provider")
        prod_upstream_provider = prod.get("upstream_provider")
        cap_upstream_model = cap.get("upstream_model")
        prod_upstream_model = prod.get("upstream_model")
        cap_source_dataset = cap.get("source_dataset")
        prod_source_dataset = prod.get("source_dataset")

        # Hard fail on specific schema contradictions
        # 1. EURO marine says copernicus but matching product says open-meteo without fallback labeling
        if model.upper() == "EURO" and domain.lower() == "marine":
            if cap_provider == "copernicus" and prod_provider == "open-meteo":
                # If product is open-meteo, verify it is explicitly estimated (is_estimated=True)
                is_est = prod.get("is_estimated") or getattr(prod, "is_estimated", False)
                assert is_est, "EURO marine capability says copernicus but matching product says open-meteo and is NOT estimated/fallback"

        # 2. ICON swell_2 appears as supported
        if model.upper() == "ICON" and domain.lower() == "marine" and layer.lower() == "swell_2":
            assert cap.get("supports_grid") is False, "ICON swell_2 must not be supported"

        # 3. backend_owned row has empty provider/upstream/source_dataset
        if cap.get("backend_owned") is True:
            assert cap_provider and cap_upstream_provider and cap_upstream_model and cap_source_dataset, "Backend-owned capability row contains empty provider/upstream/source_dataset fields"
            if prod_provider != "test-fixture":
                assert prod_provider and prod_upstream_provider and prod_upstream_model and prod_source_dataset, "Backend-owned product in manifest contains empty provider/upstream/source_dataset fields"

        # Check for mismatch
        has_mismatch = (
            cap_provider != prod_provider or
            cap_upstream_provider != prod_upstream_provider or
            cap_upstream_model != prod_upstream_model or
            cap_source_dataset != prod_source_dataset
        )

        if has_mismatch:
            mismatch_detected = True

        report.append({
            "target": f"{model}/{domain}/{layer}",
            "capability": f"{cap_provider}/{cap_upstream_model}/{cap_source_dataset}",
            "product": f"{prod_provider}/{prod_upstream_model}/{prod_source_dataset}",
            "mismatch": "yes" if has_mismatch else "no"
        })

    # Print markdown table report to stdout
    print("\n\n=== PRODUCT-MANIFEST ALIGNMENT AUDIT REPORT ===")
    print("| Target Row | Capability (Provider/Model/Dataset) | Actual Product (Provider/Model/Dataset) | Mismatch? |")
    print("|---|---|---|---|")
    for r in report:
        print(f"| {r['target']} | {r['capability']} | {r['product']} | {r['mismatch']} |")
    print("================================================\n")

    # The alignment test should report mismatches but not hard-fail on optional missing manifest files
    # Unless a contradiction check failed above, we pass the test.
