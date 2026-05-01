"""Smoke test v2: Hit endpoints from all 9 decomposed packages with correct paths."""
import urllib.request
import json

BASE = "https://raw-surf-antigravity.onrender.com/api"

tests = [
    # (name, method, path, expected_statuses)
    ("Root health", "GET", "/", [200]),
    # condition_reports package
    ("CR: regions", "GET", "/condition-reports/regions", [200]),
    ("CR: feed", "GET", "/condition-reports/feed", [200]),
    # surf_spots package
    ("Spots: list", "GET", "/surf-spots", [200]),
    # posts package  
    ("Posts: feed", "GET", "/posts?limit=1", [200]),
    # photographer package
    ("Photographer: live", "GET", "/photographers/live", [200]),
    ("Photographer: featured", "GET", "/photographers/featured", [200]),
    # messages package
    ("Messages: check thread", "GET", "/messages/check-thread/test1/test2", [200, 404]),
    # grom_hq package
    ("Grom: linked groms", "GET", "/grom-hq/linked-groms/test", [200, 404]),
    # sessions package
    ("Sessions: pricing", "POST", "/sessions/pricing", [422]),
    # uploads package
    ("Uploads: story upload", "POST", "/uploads/story", [422]),
    # surfer_gallery package
    ("Gallery: scan locker", "GET", "/surfer-gallery/scan-locker?user_id=test", [200, 404, 422]),
]

passed = 0
failed = 0
errors = []

for name, method, path, expected in tests:
    url = BASE + path
    try:
        req = urllib.request.Request(url, method=method)
        req.add_header("Content-Type", "application/json")
        if method == "POST":
            req.data = b"{}"
        
        try:
            response = urllib.request.urlopen(req, timeout=30)
            status = response.status
        except urllib.error.HTTPError as e:
            status = e.code
        
        ok = status in expected
        
        if ok:
            passed += 1
            print(f"  PASS: {name} -> {status}")
        else:
            failed += 1
            errors.append(f"{name}: expected {expected}, got {status}")
            print(f"  FAIL: {name} -> {status} (expected {expected})")
            
    except Exception as e:
        failed += 1
        errors.append(f"{name}: {type(e).__name__}: {str(e)[:80]}")
        print(f"  ERROR: {name} -> {type(e).__name__}: {str(e)[:80]}")

print(f"\nResults: {passed}/{passed+failed} passed")
if errors:
    print("Failures:")
    for e in errors:
        print(f"  - {e}")
else:
    print("ALL SMOKE TESTS PASSED")
