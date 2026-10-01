"""No serve path may write into a grid VECTOR that the ProductStore L1 cache still holds.

The diagnostics half of this defect class is guarded by `tests/test_grid_resolver_shared_diagnostics.py` §4. This is
the vector half, the shape #211 fixed. `ProductStore.load_product` and `route_helpers.filter_grid_to_bbox` copy the
product and grid containers ONE level: `grid.vectors` of a served product is a list (often the cache's own list)
of the CACHE'S GridVector objects. `coarse_gulf_fill` once did

    masked = [v for v in grid.vectors if _is_masked(v)]
    for v in masked:
        v.speed = best.speed            # <- writes GFS numbers into the cached EURO product

and every later reader of that L1 entry got GFS cells with no provenance stamp (#211, measured live 2026-10-01).

The rule, checked per function over `services/` and `routes/` with `ast`:

1. A list is SHARED when it is `X.vectors` (any object's `vectors` attribute), or a pass-through view of a shared
   list: a comprehension whose element is the loop variable itself (`[v for v in S if ...]`), `list(S)`, `sorted(S)`,
   `reversed(S)`, `filter(f, S)`, a slice `S[a:b]`, or a name bound to one of those. An element of a shared list (a
   loop variable over it, also through `enumerate`, or `S[i]`) is a SHARED VECTOR.
2. A shared vector may not be written: no `v.attr = ...`, `v.attr += ...`, `setattr(v, ...)`, `del v.attr`; and the
   shared list `X.vectors` itself may not be mutated in place (`X.vectors[i] = ...`, `.append/.pop/.sort/...`).
3. `X.vectors` is the request's OWN (not shared) after a structurally dominating rebind to fresh objects
   (`X.vectors = [v.model_copy() for v in ...]`, any comprehension whose element is not the bare loop variable, or a
   `copy.deepcopy`), or after a dominating deep copy of an object it hangs off (`out = gfs.model_copy(deep=True)`).
   Dominance is the diagnostics guard's: an earlier statement of the write's own block or of an enclosing one.
4. A function that writes elements of one of its PARAMETERS (`for v in vectors: v.speed = ...`) is a MUTATOR of that
   parameter. It is not flagged where it is defined; every CALL that hands it a shared list is, including through
   `asyncio.to_thread(fn, *args)` and `loop.run_in_executor(executor, fn, *args)`.

What it cannot see (by design, stated so nobody trusts it further): an alias of a single vector stored elsewhere
(`self.last = v`), mutators reached through a variable or a method (only direct calls by NAME), a pass-through it
does not list (`itertools.chain`, a generator function), and early returns that make a non-dominating copy enough.
"""
import ast

import pytest

from tests.test_grid_resolver_shared_diagnostics import _BACKEND, _FUNCS, _dominates, _statements

_SCAN_ROOTS = ("services", "routes")
_PASS_THROUGH_CALLS = {"list", "sorted", "reversed", "filter", "tuple"}
_DEEP_COPY_CALLS = {"copy.deepcopy", "deepcopy"}
_THREAD_HOPS = {"asyncio.to_thread", "to_thread"}             # the function is args[0]
_EXECUTOR_HOPS = {"run_in_executor"}                          # the function is args[1]
_LIST_MUTATORS = {"append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse"}

# Writes the rule cannot prove safe but that ARE safe, keyed (file, function, written target source), each with its
# argument. An entry that stops violating must leave (ratchet below).
_EXEMPT = {}
# Known violations on `dev`, each with the change that removes it. Same ratchet.
_KNOWN_UNFIXED = {}


def _src(node):
    return ast.unparse(node)


def _is_vectors_attr(node):
    return isinstance(node, ast.Attribute) and node.attr == "vectors"


def _copies_elements(comp):
    """True when a comprehension builds NEW element objects (its element is not the bare loop variable)."""
    if not isinstance(comp, (ast.ListComp, ast.GeneratorExp)):
        return False
    targets = {n.id for g in comp.generators for n in ast.walk(g.target) if isinstance(n, ast.Name)}
    return not (isinstance(comp.elt, ast.Name) and comp.elt.id in targets)


def _is_deep_copy(value):
    if not isinstance(value, ast.Call):
        return False
    if _src(value.func) in _DEEP_COPY_CALLS:
        return True
    return (isinstance(value.func, ast.Attribute) and value.func.attr == "model_copy"
            and any(k.arg == "deep" and isinstance(k.value, ast.Constant) and k.value.value is True
                    for k in value.keywords))


def _header(stmt):
    """The expression nodes of `stmt` itself, not of the statements in its blocks."""
    for field, value in ast.iter_fields(stmt):
        if field in ("body", "orelse", "finalbody", "handlers", "cases"):
            continue
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, ast.AST):
                yield from ast.walk(item)


def _callee(call):
    """(called function's name, its positional args), seeing through a thread or executor hop."""
    name = _src(call.func)
    if name in _THREAD_HOPS and call.args:
        return _src(call.args[0]).split(".")[-1], call.args[1:]
    if isinstance(call.func, ast.Attribute) and call.func.attr in _EXECUTOR_HOPS and len(call.args) > 1:
        return _src(call.args[1]).split(".")[-1], call.args[2:]
    return name.split(".")[-1], call.args


class _Scope:
    """Shared-vector bookkeeping for one function: its statements in order, with their dominance paths."""

    def __init__(self, fn):
        self.stmts = _statements(fn)
        self.shared_names = set()      # names bound to a shared LIST (or a pass-through view of one)
        self.element_names = set()     # names bound to a shared VECTOR
        self.own = []                  # (path, source): `source.vectors` (or `source` itself) is own from `path` on
        self.params = set()
        self.param_elements = {}       # name -> the parameter whose element it is (rule 4)
        if isinstance(fn, _FUNCS):
            a = fn.args
            self.params = {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs}

    def own_at(self, expr_src, path):
        for p, owned in self.own:
            if _dominates(p, path) and (expr_src == owned or expr_src.startswith(owned + ".")):
                return True
        return False

    def shared_list(self, node, path):
        """True when `node` evaluates to a shared list (rule 1), honouring dominating own-rebinds (rule 3)."""
        if _is_vectors_attr(node):
            return not self.own_at(_src(node), path)
        if isinstance(node, ast.Name):
            return node.id in self.shared_names
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Slice):
            return self.shared_list(node.value, path)
        if isinstance(node, (ast.ListComp, ast.GeneratorExp)):
            return (not _copies_elements(node)) and any(self.shared_list(g.iter, path) for g in node.generators)
        if isinstance(node, ast.Call) and _src(node.func) in _PASS_THROUGH_CALLS and node.args:
            arg = node.args[1] if _src(node.func) == "filter" and len(node.args) > 1 else node.args[0]
            return self.shared_list(arg, path)
        return False

    def shared_element(self, node, path):
        """True when `node` is a shared VECTOR: a tracked element name, or `S[i]` of a shared list."""
        if isinstance(node, ast.Name):
            return node.id in self.element_names
        if isinstance(node, ast.Subscript) and not isinstance(node.slice, ast.Slice):
            return self.shared_list(node.value, path)
        return False

    def param_list(self, node):
        """The parameter whose elements `node` iterates, if any (rule 4)."""
        if isinstance(node, ast.Name) and node.id in self.params:
            return node.id
        if isinstance(node, ast.Call) and _src(node.func) in {"enumerate"} | _PASS_THROUGH_CALLS and node.args:
            return self.param_list(node.args[0])
        return None

    def bind(self, target, value, path):
        """A plain `name = value`: track what the name now holds."""
        name = target.id
        self.shared_names.discard(name)
        self.element_names.discard(name)
        self.param_elements.pop(name, None)
        if self.shared_list(value, path):
            self.shared_names.add(name)
        if self.shared_element(value, path):
            self.element_names.add(name)
        if isinstance(value, ast.Subscript) and not isinstance(value.slice, ast.Slice):
            p = self.param_list(value.value)
            if p:
                self.param_elements[name] = p

    def bind_loop(self, target, iter_node, path):
        elem, it = target, iter_node
        if isinstance(it, ast.Call) and _src(it.func) == "enumerate" and it.args:
            it = it.args[0]
            if isinstance(target, ast.Tuple) and len(target.elts) == 2:
                elem = target.elts[1]
        if not isinstance(elem, ast.Name):
            return
        if self.shared_list(it, path):
            self.element_names.add(elem.id)
        p = self.param_list(it)
        if p:
            self.param_elements[elem.id] = p


def _analyse(source, label="<snippet>", mutators=None):
    """(violations, {function: written parameter names}, attribute writes seen) for one module's source."""
    tree = ast.parse(source)
    mutators = mutators or {}
    found, written_params, writes = [], {}, 0
    for fn in [tree] + [n for n in ast.walk(tree) if isinstance(n, _FUNCS)]:
        where = getattr(fn, "name", "<module>")
        scope = _Scope(fn)
        for stmt, path in scope.stmts:
            if isinstance(stmt, ast.Assign):
                for t in stmt.targets:
                    if _is_deep_copy(stmt.value) or (_is_vectors_attr(t) and _copies_elements(stmt.value)):
                        scope.own.append((path, _src(t)))
                    if isinstance(t, ast.Name):
                        scope.bind(t, stmt.value, path)
            if isinstance(stmt, (ast.For, ast.AsyncFor)):
                scope.bind_loop(stmt.target, stmt.iter, path)
            targets = []
            if isinstance(stmt, (ast.Assign, ast.Delete)):
                targets = list(stmt.targets)
            elif isinstance(stmt, (ast.AugAssign, ast.AnnAssign)):
                targets = [stmt.target]
            for t in targets:
                if isinstance(t, ast.Attribute):
                    writes += 1
                    if scope.shared_element(t.value, path):
                        found.append((label, where, _src(t), stmt.lineno))
                    if isinstance(t.value, ast.Name) and t.value.id in scope.param_elements:
                        written_params.setdefault(where, set()).add(scope.param_elements[t.value.id])
                if isinstance(t, ast.Subscript) and _is_vectors_attr(t.value) and scope.shared_list(t.value, path):
                    found.append((label, where, _src(t), stmt.lineno))
            for node in _header(stmt):
                if not isinstance(node, ast.Call):
                    continue
                if _src(node.func) == "setattr" and node.args and scope.shared_element(node.args[0], path):
                    found.append((label, where, _src(node), stmt.lineno))
                if (isinstance(node.func, ast.Attribute) and node.func.attr in _LIST_MUTATORS
                        and _is_vectors_attr(node.func.value) and scope.shared_list(node.func.value, path)):
                    found.append((label, where, _src(node.func), stmt.lineno))
                callee, args = _callee(node)
                for i in sorted(mutators.get(callee, ())):
                    if i < len(args) and scope.shared_list(args[i], path):
                        found.append((label, where, f"{callee}(<shared {_src(args[i])}>)", stmt.lineno))
    return found, written_params, writes


def _mutator_positions(sources):
    """{function name: {positional index of each parameter whose ELEMENTS it writes}} across `sources`."""
    out = {}
    for source in sources.values():
        _, written, _ = _analyse(source)
        for fn in ast.walk(ast.parse(source)):
            if isinstance(fn, _FUNCS) and fn.name in written:
                names = [a.arg for a in fn.args.posonlyargs + fn.args.args]
                out.setdefault(fn.name, set()).update(i for i, n in enumerate(names) if n in written[fn.name])
    return out


def _sources():
    out = {}
    for root in _SCAN_ROOTS:
        for path in sorted((_BACKEND / root).rglob("*.py")):
            out[path.relative_to(_BACKEND).as_posix()] = path.read_text(encoding="utf-8-sig")
    return out


def _scan():
    sources = _sources()
    mutators = _mutator_positions(sources)
    violations, writes = [], 0
    for rel, source in sources.items():
        found, _, w = _analyse(source, rel, mutators)
        violations += found
        writes += w
    return violations, mutators, writes


def test_no_serve_path_writes_into_a_shared_grid_vector():
    violations, mutators, writes = _scan()
    # The scan must SEE the mutators that exist: the surf height and rating transforms write the vectors they are
    # handed (their one caller copies first), so a scan that cannot find them proves nothing.
    assert {"rating_transform_grid", "surf_transform_grid"} <= set(mutators), (
        f"the scan found no vector mutators ({sorted(mutators)}); it is not reading the tree")
    assert writes > 50, f"the scan saw only {writes} attribute writes; it is not reading the tree"
    new = [v for v in violations if v[:3] not in _EXEMPT and v[:3] not in _KNOWN_UNFIXED]
    assert not new, (
        "writes into grid vectors a cached product may own. `load_product` and `filter_grid_to_bbox` copy one level, "
        "so `X.grid.vectors` holds the L1 entry's GridVector objects: copy before writing "
        "(`X.grid.vectors = [v.model_copy() for v in X.grid.vectors]`, or `model_copy(update=...)` per cell into a "
        "new list, as #211 does).\n"
        + "\n".join(f"  {p}:{line} in {fn}(): {target}" for p, fn, target, line in new))


def test_the_exempt_and_known_lists_name_only_live_entries():
    violations, _, _ = _scan()
    live = {v[:3] for v in violations}
    stale = sorted(set(_EXEMPT) - live) + sorted(set(_KNOWN_UNFIXED) - live)
    assert not stale, f"no longer violating, so delete from _EXEMPT / _KNOWN_UNFIXED: {stale}"


# -- controls: a guard that flags nothing would pass the scan above ---------------------------------------------------

_PRE_211 = """
def fill(product, best):
    grid = getattr(product, "grid", None)
    masked = [v for v in grid.vectors if not v.is_valid]
    for v in masked:
        v.speed = best.speed
        v.is_valid = True
"""
_FIXED_211 = """
def fill(product, best):
    grid = product.grid
    masked = [i for i, v in enumerate(grid.vectors) if not v.is_valid]
    vectors = list(grid.vectors)
    for i in masked:
        v = vectors[i]
        vectors[i] = v.model_copy(update={"speed": best.speed, "is_valid": True})
    grid.vectors = vectors
"""
_DIRECT_LOOP = """
def zero(product):
    for v in product.grid.vectors:
        v.speed = 0.0
"""
_ENUMERATE = """
def zero(product):
    for i, v in enumerate(product.grid.vectors):
        v.u = 0.0
"""
_INDEX_WRITE = """
def zero(product):
    product.grid.vectors[0].v = 0.0
"""
_ELEMENT_THROUGH_A_COPIED_LIST = """
def zero(product):
    vectors = list(product.grid.vectors)
    v = vectors[3]
    v.speed = 0.0
"""
_LIST_MUTATION = """
def drop(product):
    product.grid.vectors.pop()
"""
_SURF_SHAPE = """
import asyncio

def rate(vectors, k):
    for v in vectors:
        v.speed = v.speed * k
    return len(vectors)

async def overlay(product):
    product.grid.vectors = [v.model_copy() for v in product.grid.vectors]
    return await asyncio.to_thread(rate, product.grid.vectors, 2.0)
"""
_SURF_SHAPE_WITHOUT_COPY = """
import asyncio

def rate(vectors, k):
    for v in vectors:
        v.speed = v.speed * k
    return len(vectors)

async def overlay(product):
    return await asyncio.to_thread(rate, product.grid.vectors, 2.0)
"""
_COPY_ON_ANOTHER_BRANCH = """
def rate(vectors):
    for v in vectors:
        v.speed = 1.0

def overlay(product, sharpen):
    if sharpen:
        product.grid.vectors = [v.model_copy() for v in product.grid.vectors]
    rate(product.grid.vectors)
"""
_DEEP_COPY = """
def build(gfs):
    out = gfs.model_copy(deep=True)
    for v in out.grid.vectors:
        v.is_valid = False
    return out
"""
_FRESH_VECTORS = """
def build(rows):
    vecs = [GridVector(lat=r[0], lng=r[1], speed=0.0) for r in rows]
    for v in vecs:
        v.speed = 1.0
    return vecs
"""


@pytest.mark.parametrize("source, flagged", [
    (_PRE_211, True),                         # the shape #211 fixed, through a filtered pass-through list
    (_FIXED_211, False),                      # #211's fix: a new list, model_copy per filled cell
    (_DIRECT_LOOP, True),
    (_ENUMERATE, True),
    (_INDEX_WRITE, True),
    (_ELEMENT_THROUGH_A_COPIED_LIST, True),   # list(...) is a new LIST of the same vectors
    (_LIST_MUTATION, True),                   # the shared LIST itself, not only its elements
    (_SURF_SHAPE, False),                     # grid_resolver_surf: copy, then hand to the mutator in a thread
    (_SURF_SHAPE_WITHOUT_COPY, True),         # the same call without the copy
    (_COPY_ON_ANOTHER_BRANCH, True),          # a copy that does not dominate the call protects nothing
    (_DEEP_COPY, False),                      # consensus_product._build's shape
    (_FRESH_VECTORS, False),                  # building new vectors and writing them is fine
], ids=["pre_211", "fixed_211", "direct_loop", "enumerate", "index_write", "element_through_a_copied_list",
        "list_mutation", "surf_shape", "surf_without_copy", "copy_on_another_branch", "deep_copy", "fresh_vectors"])
def test_the_guard_sees_the_shape_it_exists_for(source, flagged):
    mutators = _mutator_positions({"<snippet>": source})
    found, _, _ = _analyse(source, mutators=mutators)
    assert bool(found) is flagged, found
