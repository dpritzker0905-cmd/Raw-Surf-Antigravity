"""`resolve_grid` must never write its per-request stamps into a cached product's diagnostics dict.

Step 4 of `grid_resolver.resolve_grid` ("Set diagnostics renderable property explicitly") stamps
`renderable`, `partial_coverage`, `valid_time`, `served_valid_time` and `frame_offset_hours` on the
served grid, and the EURO -> GFS upstream fallback stamps `provider`, `stale` and `renderable`.
Until 2026-10-01 both wrote into the dict they were handed, and that dict is not the request's own:

* `ProductStore.load_product` returns a SHALLOW copy of the L1 entry (`store_helpers.
  load_product_helper` copies the product and grid containers; `grid.diagnostics` is shared).
* `route_helpers.filter_grid_to_bbox` copies the same two containers one level, so a clip's grid
  still holds the L1 entry's dict.
* Stored grids carry a non-None dict (the normalizer writes ~8-13 keys), so the
  `if diagnostics is None` guard never rebound a fresh one: the writes landed in L1.

A scratch probe on 2026-10-01 (this file's fixture, `MARINE_MID_RES_TIER=0`) showed an unclipped
EURO `global_coarse` serve and a regional-tile clip each add all five keys to the L1 entry, the
response's dict being the cached object itself. `valid_time` is the REQUESTED hour, so a later
request for another hour served from the same stored frame rewrote an earlier response. The
fallback's `provider: gfs_estimated_fallback` reached the GFS viewport product's L1 entry the same
way, on the viewport service's in-flight WAITER path (`load_product` + clip, no rebind).

Same class as the coarse fill's vector writes (#211) and the mid tier's stamp (branch
`claude/mid-tier-no-shared-diagnostics`). Sections 1-3 drive the REAL `ProductStore` L1 cache
through the REAL `/grid` route. Section 4 is the mechanized guard: every `X.grid.diagnostics[...]`
write in `services/` and `routes/` must follow a COPY of that dict in the same function.
"""
import ast
import asyncio
import copy
import pathlib
import types
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)
from services.weather_pipeline.store import ProductStore

_VT = "2026-10-01T00:00:00Z"
_VT_DT = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
_VT_LATER = "2026-10-01T01:00:00Z"   # inside the resolver's +-3 h window: the same stored 00Z frame

_WORLD = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
_TILE = CoverageBounds(west=-80.0, south=30.0, east=-70.0, north=40.0)

EURO_COARSE = "euro_marine_waves_global_coarse_diag.json"
EURO_TILE = "euro_marine_waves_carolinas_test_diag.json"
GFS_DYN = "gfs_marine_waves_dyn_viewport_diag.json"

# The keys `normalizer` writes on every stored grid (a non-None dict is the production condition).
_STORED_DIAGNOSTICS = {
    "cols": 11, "rows": 11, "vectorCount": 121, "vectors_length": 121,
    "expectedCellCount": 121, "missingCellCount": 0, "nonzeroCount": 121,
    "gridMode": "rectangular",
}

_WORLD_BBOX = "-180,-80,180,85"    # > 15 degrees: the global manifest product, served unclipped
_TILE_BBOX = "-77,33,-73,37"       # inside the tile: Step 3 clips it (EURO snaps to 2 degrees)


def _vectors(lats, lngs):
    # Every cell valid and non-zero, so the coarse fill finds nothing to fill: the only writes left
    # on the path are the diagnostics ones this file is about.
    return [GridVector(lat=float(la), lng=float(lo), speed=2.0, u=2.0, v=0.0, direction=90.0,
                       period=10.0) for la in lats for lo in lngs]


def _product(model, filename, bounds, vectors, resolution, region_id, cols, rows):
    grid = NormalizedGrid(bounds=bounds, cols=cols, rows=rows, vectors=vectors,
                          diagnostics=dict(_STORED_DIAGNOSTICS))
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT, is_forecast_authoritative=True, is_estimated=False,
        coverage=bounds, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        resolution=resolution, region_id=region_id, product_id=filename,
    )


def _euro_coarse():
    # The lattice spans >= 350 degrees, as the real 10-degree tier does.
    return _product("EURO", EURO_COARSE, _WORLD, _vectors(range(-70, 81, 10), range(-180, 171, 10)),
                    10.0, "global_coarse", 36, 16)


def _euro_tile():
    return _product("EURO", EURO_TILE, _TILE, _vectors(range(30, 41), range(-80, -69)),
                    1.0, "carolinas_test", 11, 11)


def _gfs_dyn():
    return _product("GFS", GFS_DYN, _TILE, _vectors(range(30, 41), range(-80, -69)),
                    1.0, None, 11, 11)


def _item(filename, region_id, coverage, coverage_mode, resolution):
    return types.SimpleNamespace(
        model="EURO", domain="marine", layer="waves", valid_time_start=_VT_DT, is_estimated=False,
        coverage=coverage, filename=filename, region_id=region_id, coverage_mode=coverage_mode,
        resolution=resolution,
    )


class _Viewport:
    """No dynamic lane: the durable products are the only source, so the path is deterministic."""
    ACTIVE_REVALIDATIONS = set()

    def is_viewport_enabled(self, *a, **k):
        return False

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, *a, **k):
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        return None


class _WaiterViewport(_Viewport):
    """EURO's upstream fails; GFS answers the way `viewport_service.fetch_viewport_grid_upstream`
    answers an in-flight WAITER (viewport_service.py, `if not is_fetcher:`): the fetcher's product
    read back with `store.load_product`, then `filter_grid_to_bbox` to the snapped viewport. Both
    are the real functions over the real L1, so the dict this returns is the cached one."""

    def __init__(self, store):
        self.store = store

    def is_viewport_enabled(self, *a, **k):
        return True

    async def fetch_viewport_grid_upstream(self, *, model, bbox_str, **k):
        from services.weather_pipeline.route_helpers import filter_grid_to_bbox, get_snapped_bbox
        if model.upper() == "EURO":
            raise RuntimeError("Copernicus upstream unavailable (test)")
        loaded = await asyncio.to_thread(self.store.load_product, GFS_DYN)
        return filter_grid_to_bbox(loaded, get_snapped_bbox(bbox_str, model))


# name -> (published files, manifest items, bbox, the L1 file whose dict the serve must not touch,
#          whether the GFS-fallback viewport is wired)
_SCENARIOS = {
    "coarse_world": (
        {EURO_COARSE: _euro_coarse},
        [_item(EURO_COARSE, "global_coarse", _WORLD, "global_tile", 10.0)],
        _WORLD_BBOX, EURO_COARSE, False),
    "regional_clip": (
        {EURO_TILE: _euro_tile},
        [_item(EURO_TILE, "carolinas_test", _TILE, "regional_tile", 1.0)],
        _TILE_BBOX, EURO_TILE, False),
    "gfs_fallback": (
        {GFS_DYN: _gfs_dyn},
        [],
        _TILE_BBOX, GFS_DYN, True),
}


@pytest.fixture(params=sorted(_SCENARIOS))
def served(request, tmp_path, monkeypatch):
    """A REAL ProductStore over tmp files, wired into the REAL `/grid`. Yields (bbox, L1 filename)."""
    import routes.weather as weather_route
    import services.weather_pipeline.store as store_mod

    files, items, bbox, l1_name, fallback = _SCENARIOS[request.param]
    saved = dict(ProductStore._product_cache), dict(ProductStore._product_cache_vectors)
    ProductStore._product_cache.clear()
    ProductStore._product_cache_vectors.clear()

    store = ProductStore(cache_dir=tmp_path)
    for name, build in files.items():
        (tmp_path / name).write_text(build().model_dump_json())
    monkeypatch.setattr(store, "get_manifest", lambda: types.SimpleNamespace(products=list(items)))
    # The production condition: Steps 3.5-3.7 run (the probe that found this patched the same).
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    monkeypatch.setattr(weather_route, "store", store)
    monkeypatch.setattr(weather_route, "viewport_service",
                        _WaiterViewport(store) if fallback else _Viewport())
    # No global_mid exists here, and the tier is off as it was in the probe: it has its own fix and
    # test (tests/test_mid_tier_shared_diagnostics.py on its branch).
    monkeypatch.setenv("MARINE_MID_RES_TIER", "0")
    yield bbox, l1_name
    ProductStore._product_cache.clear()
    ProductStore._product_cache.update(saved[0])
    ProductStore._product_cache_vectors.clear()
    ProductStore._product_cache_vectors.update(saved[1])


def _grid(bbox, valid_time=_VT):
    from routes.weather import get_grid
    return asyncio.run(get_grid(model="EURO", domain="marine", layer="waves", valid_time=valid_time,
                                bbox=bbox, surf=False, series_stride=None,
                                background_tasks=None, request=None))


def _l1_diagnostics(filename):
    entry = ProductStore._product_cache.get(filename)
    assert entry is not None, f"{filename} is not resident in L1; the test exercised nothing"
    return entry[0].grid.diagnostics


# -- 1. THE REGRESSION: a serve leaves the cached dict exactly as stored ----------------------

def test_a_serve_leaves_the_cached_diagnostics_unchanged(served):
    bbox, l1_name = served
    out = _grid(bbox)

    assert out.grid.diagnostics.get("valid_time") == _VT, "the resolver did not stamp; proves nothing"
    cached = _l1_diagnostics(l1_name)
    assert out.grid.diagnostics is not cached, "the response and the L1 entry share one dict"
    assert cached == _STORED_DIAGNOSTICS, (
        f"a serve-time stamp landed in the cached product: added "
        f"{sorted(set(cached) - set(_STORED_DIAGNOSTICS))}")


# -- 2. THE HAZARD: one request's stamps rewriting another's response -------------------------

def test_a_later_request_does_not_change_an_earlier_response(served):
    """Two responses built from one L1 entry held one dict, so the later request's `valid_time`
    (the REQUESTED hour) rewrote the earlier response before it was serialized. An hour later,
    from the same stored 00Z frame."""
    bbox, _ = served
    first = _grid(bbox)
    before = copy.deepcopy(first.grid.diagnostics)
    later = _grid(bbox, valid_time=_VT_LATER)

    assert later.grid.diagnostics.get("valid_time") == _VT_LATER, (
        "the later request did not stamp a different hour; this test would prove nothing")
    assert later.grid.diagnostics.get("served_valid_time") == _VT, "not served from the same frame"
    assert first.grid.diagnostics == before, (
        f"the later request rewrote the earlier response: valid_time "
        f"{before.get('valid_time')} -> {first.grid.diagnostics.get('valid_time')}")


# -- 3. THE FIX CHANGES NO SERVED VALUE --------------------------------------------------------

def _expected(valid_time, offset_h, fallback):
    expected = dict(_STORED_DIAGNOSTICS)
    if fallback:
        expected.update(provider="gfs_estimated_fallback", stale=False)
    expected.update(renderable=True, partial_coverage=False, valid_time=valid_time,
                    served_valid_time=_VT, frame_offset_hours=offset_h)
    return expected


def test_the_served_diagnostics_are_unchanged_by_the_fix(served):
    """What the client receives, key for key: the stored keys plus the resolver's stamps, on a cold
    load, an L1 hit, and an L1 hit for another hour. The pre-fix code served these same dicts on a
    cold load (the stamps were written, only into the wrong object), so this pins the fix as a
    pure change of WHERE the stamps are written."""
    bbox, l1_name = served
    fallback = l1_name == GFS_DYN
    cold = _grid(bbox)
    assert cold.grid.diagnostics == _expected(_VT, 0.0, fallback)
    hit = _grid(bbox)
    assert hit.grid.diagnostics == _expected(_VT, 0.0, fallback)
    other_hour = _grid(bbox, valid_time=_VT_LATER)
    assert other_hour.grid.diagnostics == _expected(_VT_LATER, -1.0, fallback)
    if fallback:
        assert cold.provider == "gfs_estimated_fallback" and cold.model == "EURO"


# -- 4. THE GUARD: every in-place write to `X.grid.diagnostics` is dominated by a copy of it ---
#
# The three fixes of 2026-10-01 (#211's vectors, the mid tier's stamp, this file's stamps) were one
# defect found three times by reading. This makes the diagnostics half of it a check. It is
# syntactic and local: a write `X.grid.diagnostics[k] = v` (or `+=`, `del`, or a call to
# `.update/.setdefault/.pop/.popitem/.clear` on it) must be DOMINATED, in the same function, by
#   (a) `X.grid.diagnostics = dict(...)` / `copy.copy(...)` / `copy.deepcopy(...)` / `{**...}`, or
#   (b) `X = helper(...)` where `helper` is a function in the same module that does (a) to one of
#       its own parameters (`grid_resolver_surf._shallow_with_own_diagnostics` is that shape).
# DOMINATED means structurally: the copy is an earlier statement of the write's own block or of a
# block enclosing it. A copy inside one `if` branch does not cover a write after that `if`.
# ★ That rule is not pedantry. The first version of this guard used line order, and the mutation
# check on this fix showed what that misses: with step 4's copy removed, the EURO -> GFS fallback's
# copy (line ~517, inside its own branch) "covered" step 4's writes (~700) and the guard stayed
# green while four of the behavioural tests above went red.
# ⚠️ `if X.grid.diagnostics is None: X.grid.diagnostics = {}` is NOT a copy and does not count: it
# is the very pattern that let every write here land in L1, because stored dicts are never None.
# ⚠️ What it cannot see: an alias (`d = X.grid.diagnostics; d[k] = v`), a write to a nested dict
# (`X.grid.diagnostics[k][j] = v`), and an early `return`/`raise` that makes a non-dominating copy
# sufficient (those take an exemption with the argument written down, below).

_SCAN_ROOTS = ("services", "routes")
_COPY_FUNCS = {"dict", "copy", "copy.copy", "copy.deepcopy", "deepcopy"}
_MUTATING_METHODS = {"update", "setdefault", "pop", "popitem", "clear"}
_BACKEND = pathlib.Path(__file__).resolve().parents[1]
_FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)
_BLOCK_FIELDS = ("body", "orelse", "finalbody")

# Writes the structural rule cannot prove safe but that ARE safe, keyed (file, function, the
# write's target), each with its argument. An entry that stops violating must leave (ratchet).
_EXEMPT = {
    ("services/weather_pipeline/grid_resolver_surf.py", "apply_surf_overlay",
     "product.grid.diagnostics['surf_skip_reason']"):
        "the except handler copies under `if not _copied:`, and `_copied` is set by every copy in "
        "the try body, so the dict is the request's own on both paths",
}
# Known in-place writes on `dev`, each with the change that removes it. An entry that no longer
# violates FAILS the ratchet below: delete it in the commit (or merge) that fixes it.
_KNOWN_UNFIXED = {
    ("services/weather_pipeline/mid_res_tier.py", "try_serve_mid_res_tier",
     "product.grid.diagnostics['mid_res_tier']"):
        "the mid tier's stamp; fixed on branch claude/mid-tier-no-shared-diagnostics",
}


def _diag_owner(node):
    """The source of `X` when `node` is `X.grid.diagnostics`, else None."""
    if (isinstance(node, ast.Attribute) and node.attr == "diagnostics"
            and isinstance(node.value, ast.Attribute) and node.value.attr == "grid"):
        return ast.unparse(node.value.value)
    return None


def _is_copy(value):
    if isinstance(value, ast.Call):
        return ast.unparse(value.func) in _COPY_FUNCS
    if isinstance(value, ast.Dict):
        return any(k is None for k in value.keys)   # {**d, ...}
    return False


def _statements(scope):
    """(stmt, path) for every statement of `scope`, not entering nested functions or classes.
    `path` is the chain of (block, index) from the scope's body down to the statement."""
    out = []

    def visit(block, path):
        for i, stmt in enumerate(block):
            here = path + ((id(block), i),)
            out.append((stmt, here))
            if isinstance(stmt, _FUNCS + (ast.ClassDef,)):
                continue
            for field in _BLOCK_FIELDS:
                sub = getattr(stmt, field, None)
                if sub:
                    visit(sub, here)
            for k, handler in enumerate(getattr(stmt, "handlers", None) or []):
                visit(handler.body, here + ((id(stmt.handlers), k),))
            for k, case in enumerate(getattr(stmt, "cases", None) or []):
                visit(case.body, here + ((id(stmt.cases), k),))

    visit(scope.body, ())
    return out


def _header_nodes(stmt):
    """The nodes of `stmt` itself: its expressions, not the statements of its blocks."""
    for field, value in ast.iter_fields(stmt):
        if field in _BLOCK_FIELDS + ("handlers", "cases"):
            continue
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, ast.AST):
                yield from ast.walk(item)


def _dominates(copy_path, write_path):
    """True when the statement at `copy_path` runs before, and on every path to, `write_path`."""
    *prefix, (block, index) = copy_path
    n = len(prefix)
    return (len(write_path) > n and list(write_path[:n]) == prefix
            and write_path[n][0] == block and write_path[n][1] > index)


def _copier_names(tree):
    """Functions in the module that copy-rebind `P.grid.diagnostics` for one of their parameters."""
    names = set()
    for fn in ast.walk(tree):
        if isinstance(fn, _FUNCS):
            params = {a.arg for a in fn.args.posonlyargs + fn.args.args + fn.args.kwonlyargs}
            for stmt, _ in _statements(fn):
                if isinstance(stmt, ast.Assign) and _is_copy(stmt.value) and any(
                        _diag_owner(t) in params for t in stmt.targets):
                    names.add(fn.name)
    return names


def _copies(stmt, copiers):
    """The `X` whose diagnostics dict `stmt` makes its own, if any."""
    if not isinstance(stmt, ast.Assign):
        return []
    if _is_copy(stmt.value):
        return [o for o in (_diag_owner(t) for t in stmt.targets) if o is not None]
    if isinstance(stmt.value, ast.Call) and ast.unparse(stmt.value.func) in copiers:
        return [ast.unparse(t) for t in stmt.targets]
    return []


def _writes(stmt):
    """(X, target source) for each in-place write into `X.grid.diagnostics` by `stmt` itself."""
    targets = []
    if isinstance(stmt, (ast.Assign, ast.Delete)):
        targets = stmt.targets
    elif isinstance(stmt, (ast.AugAssign, ast.AnnAssign)):
        targets = [stmt.target]
    for target in targets:
        if isinstance(target, ast.Subscript) and _diag_owner(target.value) is not None:
            yield _diag_owner(target.value), ast.unparse(target)
    for node in _header_nodes(stmt):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in _MUTATING_METHODS and _diag_owner(node.func.value) is not None):
            yield _diag_owner(node.func.value), ast.unparse(node.func)


def _violations(source, path="<snippet>"):
    """[(path, function, target, line)] for each write no copy of that dict dominates."""
    tree = ast.parse(source)
    copiers = _copier_names(tree)
    found = []
    for scope in [tree] + [n for n in ast.walk(tree) if isinstance(n, _FUNCS)]:
        stmts = _statements(scope)
        copies = [(owner, p) for stmt, p in stmts for owner in _copies(stmt, copiers)]
        for stmt, p in stmts:
            for owner, target in _writes(stmt):
                if not any(o == owner and _dominates(cp, p) for o, cp in copies):
                    found.append((path, getattr(scope, "name", "<module>"), target, stmt.lineno))
    return found


def _scan():
    writes, violations = 0, []
    for root in _SCAN_ROOTS:
        for path in sorted((_BACKEND / root).rglob("*.py")):
            rel = path.relative_to(_BACKEND).as_posix()
            source = path.read_text(encoding="utf-8-sig")   # some modules carry a BOM
            tree = ast.parse(source)
            writes += sum(1 for scope in [tree] + [n for n in ast.walk(tree) if isinstance(n, _FUNCS)]
                          for stmt, _ in _statements(scope) for _w in _writes(stmt))
            violations += _violations(source, rel)
    return writes, violations


def test_every_grid_diagnostics_write_is_dominated_by_a_copy_of_that_dict():
    writes, violations = _scan()
    assert writes >= 10, f"the scan found only {writes} writes; it is not reading the tree"
    new = [v for v in violations if v[:3] not in _EXEMPT and v[:3] not in _KNOWN_UNFIXED]
    assert not new, (
        "in-place writes into a grid's diagnostics dict that no copy of that dict dominates. The "
        "dict is usually the ProductStore L1 entry's (load_product and filter_grid_to_bbox copy one "
        "level), so the write lands in the cache and in every other response built from it. Copy "
        "first, in the same block: `X.grid.diagnostics = dict(X.grid.diagnostics or {})`.\n"
        + "\n".join(f"  {p}:{line} in {fn}(): {target}" for p, fn, target, line in new))


def test_the_exempt_and_known_lists_name_only_live_entries():
    """The ratchet: an entry that no longer violates must leave its list."""
    _, violations = _scan()
    live = {v[:3] for v in violations}
    stale = sorted(set(_EXEMPT) - live) + sorted(set(_KNOWN_UNFIXED) - live)
    assert not stale, f"no longer violating, so delete from _EXEMPT / _KNOWN_UNFIXED: {stale}"


_PRE_FIX = """
def resolve(product):
    if product and product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["renderable"] = True
"""
_FIXED = """
def resolve(product):
    if product and product.grid:
        product.grid.diagnostics = dict(product.grid.diagnostics or {})
        product.grid.diagnostics["renderable"] = True
"""
_COPY_AFTER_WRITE = """
def resolve(product):
    product.grid.diagnostics["renderable"] = True
    product.grid.diagnostics = dict(product.grid.diagnostics or {})
"""
_OTHER_OBJECT_COPIED = """
def resolve(product, other):
    other.grid.diagnostics = dict(other.grid.diagnostics or {})
    product.grid.diagnostics.update(renderable=True)
"""
_COPY_ON_ANOTHER_BRANCH = """
def resolve(product, fallback):
    if fallback:
        product.grid.diagnostics = dict(product.grid.diagnostics or {})
        product.grid.diagnostics["provider"] = "gfs_estimated_fallback"
    product.grid.diagnostics["renderable"] = True
"""
_COPY_IN_ENCLOSING_BLOCK = """
def resolve(product, fallback):
    product.grid.diagnostics = {**(product.grid.diagnostics or {})}
    try:
        if fallback:
            product.grid.diagnostics.setdefault("provider", "gfs")
    except ValueError:
        del product.grid.diagnostics["provider"]
"""
_HELPER_COPY = """
def serve(product):
    def _own(p):
        p = p.model_copy()
        p.grid = p.grid.model_copy()
        p.grid.diagnostics = dict(p.grid.diagnostics or {})
        return p
    product = _own(product)
    product.grid.diagnostics["surf_transform"] = {}
"""


@pytest.mark.parametrize("source, flagged", [
    (_PRE_FIX, True),                   # the shape that shipped: the None-guard is not a copy
    (_FIXED, False),
    (_COPY_AFTER_WRITE, True),          # a copy after the write protects nothing
    (_OTHER_OBJECT_COPIED, True),       # a copy of a different object's dict does not count
    (_COPY_ON_ANOTHER_BRANCH, True),    # the step-4 mutation's shape: line order would pass it
    (_COPY_IN_ENCLOSING_BLOCK, False),  # a copy in an enclosing block covers if/try/except below it
    (_HELPER_COPY, False),              # grid_resolver_surf's helper shape
], ids=["pre_fix", "fixed", "copy_after_write", "other_object", "copy_on_another_branch",
        "copy_in_enclosing_block", "helper_copy"])
def test_the_guard_sees_the_shape_it_exists_for(source, flagged):
    """Positive and negative controls: a guard that flags nothing would pass the scan above."""
    assert bool(_violations(source)) is flagged
