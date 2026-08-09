"""One manifest, one index — the (model, domain, layer) bucket view of manifest.products.

WHY (MASTER-AUDIT-11.0 serving-perf §3.4-adjacent, 2026-08-09): three serving-path call sites
filtered `manifest.products` with a full linear scan — `point_resolution.resolve_point`,
`point_resolution.find_cached_grid_product`, and `grid_resolver_surf._build_wind_sampler`'s wind
candidates. At the live 16,132-product manifest that is ~5 ms per scan on the bench box, the scan
runs 22x per spot-hub request, and all of it sits on the event loop. Bench: 111.7 ms -> sub-ms per
hub request for the filter step.

WHY THE KEY IS THE PRODUCTS LIST'S IDENTITY PLUS ITS LENGTH — and NOT the manifest object's:
`ProductStore.get_manifest()` caches the manifest object by file mtime (store.py:456-468), but the
WRITER paths mutate that same object in memory before saving: eleven sites REASSIGN
`manifest.products` to a fresh list (store.py:208,213,520; store_helpers.py:199,310,456,476;
copernicus_validator.py:263,295,364,463) and one APPENDS in place (store_helpers.py:447). An index
keyed on the manifest object would survive all of those and serve stale buckets forever — the
linear scan it replaced saw every one instantly. Keying on the LIST object catches every
reassignment (new list, new identity); the length term catches the in-place append. In-place
ELEMENT replacement (`products[i] = x`) has no instance in the tree (grepped 2026-08-09) and is
declared OUT OF CONTRACT here: if one is ever added, it must reassign the list instead.
(Identity is safe because the tuple below holds a strong reference — the id cannot be recycled
while the entry lives. A reader racing a writer sees either the old list with the old index or
the new list with a rebuild, never a mix: reassignment is an atomic reference swap.)

SELECTION IS BIT-IDENTICAL BY CONSTRUCTION: buckets preserve manifest order (setdefault+append in
iteration order), so every downstream `min()` tie-break sees the same candidates in the same order
the linear scan produced — pinned by tests/test_point_manifest_view.py against a verbatim copy of
the old filter.

Thread note: a rebuild race builds the index twice and the last writer wins; both are correct and
the read is a single tuple load. Lives in its own module because both natural hosts sit at the LOC
ceiling (point_resolution 784/800, store 796/800) and squeezing a ratchet to avoid a file is how
rationale gets deleted.
"""
from typing import Dict, List, Tuple

_cached = None   # (products_list_object, length, {(MODEL, domain, layer): [ManifestProduct, ...]})


def products_for(manifest, model: str, domain: str, layer: str) -> List:
    """All manifest products for one (model, domain, layer) lane, in manifest order."""
    global _cached
    products = manifest.products
    cached = _cached
    if cached is None or cached[0] is not products or cached[1] != len(products):
        idx: Dict[Tuple[str, str, str], List] = {}
        for p in products:
            idx.setdefault((p.model.upper(), p.domain.lower(), p.layer.lower()), []).append(p)
        cached = (products, len(products), idx)
        _cached = cached
    return cached[2].get(
        ((model or "").upper(), (domain or "").lower(), (layer or "").lower()), [])
