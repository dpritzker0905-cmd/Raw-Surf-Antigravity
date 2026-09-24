"""Report executed changed Python statements, including import-time registry wiring."""
import ast
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
folder = Path(__file__).parent
executed = json.loads((folder / "executed-lines.json").read_text())
result = {}
for name in ("grid_resolver", "grid_resolver_selection", "science_registry"):
    rel = f"backend/services/weather_pipeline/{name}.py"
    diff = subprocess.check_output(["git", "diff", "91b90ae9", "-U0", "--", rel], cwd=ROOT, text=True)
    added = []
    for line in diff.splitlines():
        if line.startswith("@@"):
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            start, count = int(match[1]), int(match[2] or "1")
            added.extend(range(start, start + count))
    nodes = ast.walk(ast.parse((ROOT / rel).read_text(encoding="utf-8")))
    executable = {n.lineno for n in nodes if isinstance(n, ast.stmt)
                  and not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                           and isinstance(n.value.value, str))}
    changed = set(added) & executable
    seen = set(executed[str((ROOT / rel).resolve()).casefold()])
    result[rel] = {"changed_statement_lines": sorted(changed), "executed": sorted(changed & seen),
                   "not_seen": sorted(changed - seen)}
(folder / "changed-line-coverage.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
assert not any(item["not_seen"] for item in result.values())
