"""point_product_id.py — the allow-list for `/point?grid_product_id=` (audit SRV-1, 2026-11-10).

The hint used to flow unchecked into `store.cache_dir / id` and `storage.from_(WEATHER_BUCKET).download(id)`, so
`../avatars/x.json` reached ANOTHER bucket with the service-role key and tried to write outside the cache dir.

Now the hint must be (1) a bare filename: letters, digits, `_ . -`, ends in `.json`, no `/`, `\\`, `..`, no drive or
absolute path; and (2) a product this box knows: listed in the current manifest or in the dynamic-viewport index.
Anything else is a 400. (1) has no kill switch (it is the security fix). Kill for (2) only: POINT_PRODUCT_ID_MEMBERSHIP=0.
"""
import asyncio
import os
import re
from typing import Optional

from fastapi import HTTPException

_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}\.json")

_names_cache = (None, frozenset())      # (manifest object, its filenames): the manifest object only changes when it reloads


def is_bare_product_filename(value) -> bool:
    return isinstance(value, str) and _SAFE_ID.fullmatch(value) is not None and ".." not in value


def _manifest_names(store) -> frozenset:
    global _names_cache
    manifest = store.get_manifest()
    cached_manifest, names = _names_cache
    if cached_manifest is not manifest:
        names = frozenset(p.filename for p in manifest.products if p.filename)
        _names_cache = (manifest, names)
    return names


def _dynamic_has(dynamic_index, product_id: str) -> bool:
    return any(item.get("product_id") == product_id for item in dynamic_index._load_index())


def _known(store, dynamic_index, product_id: str) -> bool:
    return product_id in _manifest_names(store) or _dynamic_has(dynamic_index, product_id)


async def require_known_point_product(store, dynamic_index, grid_product_id: Optional[str]) -> None:
    """Raise 400 unless `grid_product_id` is None or an allowed, known product name."""
    if grid_product_id is None:
        return
    if not is_bare_product_filename(grid_product_id):
        raise HTTPException(status_code=400, detail="grid_product_id must be a bare product filename")
    if os.environ.get("POINT_PRODUCT_ID_MEMBERSHIP", "1") == "0":
        return
    if not await asyncio.to_thread(_known, store, dynamic_index, grid_product_id):
        raise HTTPException(status_code=400, detail="grid_product_id is not a current product")
