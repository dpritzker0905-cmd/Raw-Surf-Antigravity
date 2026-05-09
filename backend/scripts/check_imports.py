#!/usr/bin/env python3
"""
check_imports.py — CI/CD Governance: Import Graph Validator

Detects circular imports between backend route modules.
Walks the import graph and flags cycles that could cause runtime failures.

Usage:
    python scripts/check_imports.py [--path routes]

Exit codes:
    0 — No circular imports detected
    1 — Circular imports found
"""
import os
import sys
import ast
import argparse
from collections import defaultdict


def extract_imports(filepath: str, root_path: str) -> list:
    """Extract relative and absolute import targets from a Python file."""
    imports = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            tree = ast.parse(f.read(), filename=filepath)
    except (SyntaxError, IOError):
        return imports

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module)
    return imports


def build_import_graph(root_path: str, exclude_dirs: list = None) -> dict:
    """Build a directed graph of module imports."""
    if exclude_dirs is None:
        exclude_dirs = ['__pycache__', '.pytest_cache', 'tests']

    graph = defaultdict(set)
    modules = {}

    # Map file paths to module names
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for filename in filenames:
            if not filename.endswith('.py'):
                continue
            filepath = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(filepath, os.path.dirname(root_path))
            module_name = rel_path.replace(os.sep, '.').replace('.py', '')
            if module_name.endswith('.__init__'):
                module_name = module_name[:-9]
            modules[module_name] = filepath

    # Build edges
    for module_name, filepath in modules.items():
        imports = extract_imports(filepath, root_path)
        for imp in imports:
            # Only track imports within our routes package
            if imp.startswith('routes.') or imp.startswith('.'):
                # Normalize relative imports
                if imp.startswith('.'):
                    parent = '.'.join(module_name.split('.')[:-1])
                    imp = f"{parent}.{imp.lstrip('.')}"
                graph[module_name].add(imp)

    return dict(graph)


def find_cycles(graph: dict) -> list:
    """Find all cycles in the import graph using DFS."""
    cycles = []
    visited = set()
    rec_stack = set()

    def dfs(node, path):
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor, path)
            elif neighbor in rec_stack:
                # Found a cycle
                cycle_start = path.index(neighbor)
                cycle = path[cycle_start:] + [neighbor]
                cycles.append(cycle)

        path.pop()
        rec_stack.discard(node)

    for node in graph:
        if node not in visited:
            dfs(node, [])

    return cycles


def main():
    parser = argparse.ArgumentParser(description='Detect circular imports in backend routes')
    parser.add_argument('--path', type=str, default='routes',
                        help='Root path to scan (default: routes)')
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Import Graph Validator")
    print(f"{'='*60}\n")

    if not os.path.exists(args.path):
        print(f"\u26a0\ufe0f  Path '{args.path}' not found. Skipping.")
        return 0

    graph = build_import_graph(args.path)
    cycles = find_cycles(graph)

    # Filter to only inter-package cycles (intra-package imports are expected)
    inter_pkg_cycles = []
    for cycle in cycles:
        packages = set()
        for node in cycle:
            parts = node.split('.')
            if len(parts) >= 2:
                packages.add(parts[1])  # routes.PACKAGE.module
        if len(packages) > 1:
            inter_pkg_cycles.append(cycle)

    if inter_pkg_cycles:
        print(f"[X] CIRCULAR IMPORTS DETECTED ({len(inter_pkg_cycles)} cross-package cycles):\n")
        for i, cycle in enumerate(inter_pkg_cycles, 1):
            print(f"  Cycle {i}: {' -> '.join(cycle)}")
        print(f"\n  ACTION REQUIRED: Break these cycles before merging.\n")
    else:
        print(f"[OK] No cross-package circular imports detected.")
        print(f"  Modules scanned: {len(graph)}\n")

    total_edges = sum(len(deps) for deps in graph.values())
    print(f"  Import graph: {len(graph)} modules, {total_edges} edges")
    print(f"{'='*60}\n")

    return 1 if inter_pkg_cycles else 0


if __name__ == '__main__':
    sys.exit(main())
