"""V1 Q7 -- prove or refute "the four product files changed PROSE ONLY".

Compares 578e9a1c^ vs 578e9a1c for each file:
  (a) raw AST dump                      -- docstrings ARE AST nodes, so this SHOULD differ
  (b) AST dump with every docstring Expr stripped  -- must be IDENTICAL if only prose changed
  (c) compiled code-object constants/bytecode, docstrings excluded
ASCII output only.
"""
import ast
import subprocess
import sys

FILES = ["backend/services/weather_pipeline/sim_rating.py",
         "backend/services/weather_pipeline/spot_ratings.py",
         "backend/services/weather_pipeline/surf_rating.py",
         "backend/services/weather_pipeline/surf_transform.py"]
SHA = "578e9a1c"


def show(rev, path):
    return subprocess.check_output(["git", "show", "%s:%s" % (rev, path)], text=True,
                                   encoding="utf-8", errors="replace")


def strip_docstrings(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                node.body = body[1:] or [ast.Pass()]
    return tree


def const_sig(code, out, depth=0):
    """Recursive code-object signature: bytecode + names + consts, DOCSTRING (consts[0] str) dropped."""
    consts = list(code.co_consts)
    if consts and isinstance(consts[0], str):
        consts = consts[1:]          # the docstring slot
    flat = []
    for c in consts:
        if hasattr(c, "co_code"):
            const_sig(c, out, depth + 1)
            flat.append("<code %s>" % c.co_name)
        elif isinstance(c, str):
            flat.append("STR:%d" % len(c))   # strings compared by length only at nested level
        else:
            flat.append(repr(c))
    out.append((code.co_name, code.co_code, tuple(code.co_names), tuple(code.co_varnames), tuple(flat)))
    return out


ok = True
for path in FILES:
    old, new = show(SHA + "^", path), show(SHA, path)
    raw_same = ast.dump(ast.parse(old)) == ast.dump(ast.parse(new))
    d_old = ast.dump(strip_docstrings(ast.parse(old)))
    d_new = ast.dump(strip_docstrings(ast.parse(new)))
    stripped_same = d_old == d_new
    c_old = const_sig(compile(old, path, "exec"), [])
    c_new = const_sig(compile(new, path, "exec"), [])
    code_same = c_old == c_new
    # which docstrings changed
    changed_docs = []
    to, tn = ast.parse(old), ast.parse(new)
    for a, b in zip(ast.walk(to), ast.walk(tn)):
        if isinstance(a, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            da, db = ast.get_docstring(a), ast.get_docstring(b)
            if da != db:
                changed_docs.append(getattr(a, "name", "<module>"))
    line_delta = len(new.splitlines()) - len(old.splitlines())
    print("%-52s raw_AST_same=%-5s  AST_minus_docstrings_same=%-5s  bytecode_same=%-5s  dLOC=%+d" % (
        path.split("/")[-1], raw_same, stripped_same, code_same, line_delta))
    print("    docstrings changed: %s" % (changed_docs or "NONE (comment-only edit)"))
    if not (stripped_same and code_same):
        ok = False
        print("    *** EXECUTABLE CHANGE DETECTED ***")
print()
print("VERDICT: prose-only claim %s" % ("HOLDS for all four files" if ok else "IS FALSE"))
