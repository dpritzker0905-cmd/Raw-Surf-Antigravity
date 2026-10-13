"""The cached-product guard (2026-10-02): a product the ProductStore L1 cache holds must never change after a serve
path receives it. History, controls and the four bugs it generalizes: tests/test_l1_cached_product_guard.py.

HOW. `install(monkeypatch)` wraps `store_helpers.load_product_helper`, the one function that puts products into
`ProductStore._product_cache` and hands out one-level copies of them. After every call it looks up the entry under
that call's cache key in whatever dict `ProductStore._product_cache` is at that moment (some tests swap it), and the
first time it meets a product object it keeps the object and its JSON. `changes()` re-serializes every kept product
and names the first paths that differ. It is keyed to the invariant, not to an attribute name, so it also covers
fields nobody has broken yet.

LIMITS, stated so nobody trusts it further: it sees only products that pass through `load_product` (the store has no
other hand-out path today; `services/memory_trace.py` only counts entries); a change made before the first load in a
test is taken as that product's starting state; private attributes and anything outside the pydantic dump are
invisible; a test that imports `load_product_helper` by name bypasses the wrapper.
"""
import json
from typing import Any, Dict, List, Tuple

_MAX_PATHS = 3


class L1ProductGuard:
    def __init__(self) -> None:
        self._seen: Dict[int, Tuple[str, Any, str]] = {}  # id(product) -> (cache key, product, JSON at first sight)

    def install(self, monkeypatch) -> None:
        from services.weather_pipeline import store_helpers
        from services.weather_pipeline.store import ProductStore, _effective_load_stride

        original = store_helpers.load_product_helper

        def guarded(store, filename, stride=None):
            result = original(store, filename, stride)
            effective = _effective_load_stride(stride)
            key = filename if effective <= 1 else f"{filename}#s{effective}"   # load_product_helper's own key
            entry = ProductStore._product_cache.get(key)
            if entry is not None:
                self.observe(key, entry[0] if isinstance(entry, tuple) else entry)
            return result

        guarded.__l1_guard__ = True
        monkeypatch.setattr(store_helpers, "load_product_helper", guarded)

    def observe(self, key: str, product: Any) -> None:
        if id(product) not in self._seen and hasattr(product, "model_dump_json"):
            self._seen[id(product)] = (key, product, product.model_dump_json())

    def changes(self) -> List[str]:
        out = []
        for key, product, before in self._seen.values():
            after = product.model_dump_json()
            if after == before:
                continue
            paths: List[str] = []
            _diff(json.loads(before), json.loads(after), "", paths)
            more = f" (+{len(paths) - _MAX_PATHS} more)" if len(paths) > _MAX_PATHS else ""
            out.append(f"{key}: " + "; ".join(paths[:_MAX_PATHS]) + more)
        return out

    def assert_unchanged(self) -> None:
        changed = self.changes()
        if changed:
            raise AssertionError(
                "a product the ProductStore L1 cache holds changed after a serve path received it. Every reader of "
                "that entry now sees it: copy what you write (rebind the list or dict, model_copy the vectors) "
                "instead of writing into the one-level copy load_product returns. Changed: " + " | ".join(changed))


def _diff(before: Any, after: Any, path: str, out: List[str]) -> None:
    if len(out) > _MAX_PATHS:
        return
    if isinstance(before, dict) and isinstance(after, dict):
        for k in list(before) + [k for k in after if k not in before]:
            sub = f"{path}.{k}" if path else str(k)
            if k not in after:
                out.append(f"{sub} removed")
            elif k not in before:
                out.append(f"{sub} added")
            else:
                _diff(before[k], after[k], sub, out)
    elif isinstance(before, list) and isinstance(after, list):
        if len(before) != len(after):
            out.append(f"{path} length {len(before)} -> {len(after)}")
            return
        for i, (b, a) in enumerate(zip(before, after)):
            _diff(b, a, f"{path}[{i}]", out)
    elif before != after:
        out.append(f"{path} {_short(before)} -> {_short(after)}")


def _short(value: Any) -> str:
    text = json.dumps(value)
    return text if len(text) <= 40 else text[:37] + "..."
