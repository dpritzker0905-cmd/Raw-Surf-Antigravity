"""
Auto-fix v2: Add missing imports to all decomposed sub-modules.
Uses AST to correctly identify top-level imports only (ignores function-body imports).
For files with NO top-level imports, prepends after the module docstring.
"""
import ast
import os
import re

BASE = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\backend\routes'
packages = ['photographer', 'surf_spots', 'posts', 'messages', 'surfer_gallery', 'uploads', 'grom_hq', 'condition_reports', 'sessions']

IMPORT_GROUPS = {
    'pydantic': {
        'symbols': ['BaseModel', 'ConfigDict', 'Field', 'field_validator', 'validator'],
        'template': 'from pydantic import {syms}'
    },
    'fastapi': {
        'symbols': ['APIRouter', 'Depends', 'HTTPException', 'Query', 'Body', 'Path', 'Form', 'File', 'UploadFile', 'Request'],
        'template': 'from fastapi import {syms}'
    },
    'fastapi.responses': {
        'symbols': ['JSONResponse', 'FileResponse'],
        'template': 'from fastapi.responses import {syms}'
    },
    'starlette.responses': {
        'symbols': ['StreamingResponse'],
        'template': 'from starlette.responses import {syms}'
    },
    'sqlalchemy': {
        'symbols': ['select', 'func', 'and_', 'or_', 'desc', 'asc', 'text', 'update', 'delete', 'insert', 'case', 'literal', 'distinct'],
        'template': 'from sqlalchemy import {syms}'
    },
    'sqlalchemy.ext.asyncio': {
        'symbols': ['AsyncSession'],
        'template': 'from sqlalchemy.ext.asyncio import {syms}'
    },
    'sqlalchemy.orm': {
        'symbols': ['selectinload', 'joinedload'],
        'template': 'from sqlalchemy.orm import {syms}'
    },
    'database': {
        'symbols': ['get_db'],
        'template': 'from database import {syms}'
    },
    'core.security': {
        'symbols': ['get_user_id_from_jwt_or_query'],
        'template': 'from core.security import {syms}'
    },
    'datetime': {
        'symbols': ['datetime', 'timedelta', 'timezone', 'date'],
        'template': 'from datetime import {syms}'
    },
    'typing': {
        'symbols': ['Optional', 'List', 'Dict', 'Any', 'Tuple', 'Union'],
        'template': 'from typing import {syms}'
    },
}

STANDALONE = {
    'uuid': 'import uuid',
    'json': 'import json',
    'os': 'import os',
    'logging': 'import logging',
    're': 'import re',
}

ALL_KNOWN = set()
for group in IMPORT_GROUPS.values():
    ALL_KNOWN.update(group['symbols'])
ALL_KNOWN.update(STANDALONE.keys())


def get_top_level_defined(tree):
    """Get names defined at module top-level only (not inside functions)."""
    defined = set()
    for node in tree.body:  # Only top-level statements
        if isinstance(node, ast.Import):
            for alias in node.names:
                defined.add(alias.asname or alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                defined.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defined.add(node.name)
            # Also add names imported inside function bodies
            for child in ast.walk(node):
                if isinstance(child, ast.Import):
                    for alias in child.names:
                        defined.add(alias.asname or alias.name.split('.')[0])
                elif isinstance(child, ast.ImportFrom):
                    for alias in child.names:
                        defined.add(alias.asname or alias.name)
        elif isinstance(node, ast.ClassDef):
            defined.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    defined.add(target.id)
        elif isinstance(node, ast.Try):
            # Walk try/except blocks for imports (common pattern: try: import X ...)
            for child in ast.walk(node):
                if isinstance(child, ast.Import):
                    for alias in child.names:
                        defined.add(alias.asname or alias.name.split('.')[0])
                elif isinstance(child, ast.ImportFrom):
                    for alias in child.names:
                        defined.add(alias.asname or alias.name)
    return defined


def get_all_used_names(tree):
    """Get all Name nodes used anywhere in the module."""
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
        elif isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Name):
                used.add(node.value.id)
    return used


def find_top_level_import_end(tree):
    """Find the line number of the last top-level import statement.
    Returns 0 if no imports found."""
    last_import_end = 0
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            last_import_end = node.end_lineno or node.lineno
        elif isinstance(node, ast.Try):
            # Check if this try block contains only imports (common pattern)
            has_only_imports = True
            for child in node.body:
                if not isinstance(child, (ast.Import, ast.ImportFrom, ast.Assign, ast.Expr)):
                    has_only_imports = False
                    break
            if has_only_imports:
                last_import_end = max(last_import_end, node.end_lineno or node.lineno)
    return last_import_end


def find_docstring_end(content):
    """Find the end line of the module docstring (0-indexed), or -1 if none."""
    lines = content.split('\n')
    in_docstring = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if i == 0 or (i == 1 and not stripped):
            if stripped.startswith('"""') or stripped.startswith("'''"):
                quote = stripped[:3]
                if stripped.count(quote) >= 2 and len(stripped) > 6:
                    # Single-line docstring
                    return i
                else:
                    in_docstring = True
                    continue
        if in_docstring:
            if '"""' in stripped or "'''" in stripped:
                return i
    if in_docstring:
        # Never closed? Shouldn't happen in valid Python
        return 0
    return -1


def build_import_lines(missing_names):
    """Build clean import lines for the missing names, grouped by source."""
    lines = []
    for group_name, group_info in IMPORT_GROUPS.items():
        needed = [s for s in group_info['symbols'] if s in missing_names]
        if needed:
            lines.append(group_info['template'].format(syms=', '.join(sorted(needed))))
    for name, stmt in STANDALONE.items():
        if name in missing_names:
            lines.append(stmt)
    return lines


def fix_file(fpath):
    """Fix missing imports in a single file. Returns (was_fixed, count, error)."""
    content = open(fpath, encoding='utf-8').read()
    
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        return False, 0, f"SYNTAX ERROR: {e}"
    
    defined = get_top_level_defined(tree)
    used = get_all_used_names(tree)
    
    missing = {name for name in used if name in ALL_KNOWN and name not in defined}
    
    if not missing:
        return False, 0, None
    
    new_import_lines = build_import_lines(missing)
    if not new_import_lines:
        return False, 0, None
    
    lines = content.split('\n')
    
    # Determine insertion point
    import_end = find_top_level_import_end(tree)
    
    if import_end > 0:
        # Insert after last top-level import (0-indexed: import_end is 1-indexed line)
        insert_idx = import_end  # insert_idx is 0-indexed position AFTER import_end
        injection = '\n'.join(new_import_lines)
    else:
        # No top-level imports — insert after docstring (or at line 0)
        docstring_end = find_docstring_end(content)
        insert_idx = docstring_end + 1 if docstring_end >= 0 else 0
        # For files starting with code, prepend full import block
        injection = '\n'.join(new_import_lines) + '\n'
    
    lines.insert(insert_idx, injection)
    new_content = '\n'.join(lines)
    
    # Verify it still parses
    try:
        ast.parse(new_content)
    except SyntaxError as e:
        return False, len(missing), f"INJECTION CAUSED SYNTAX ERROR at line {e.lineno}: {e.msg}"
    
    open(fpath, 'w', encoding='utf-8').write(new_content)
    return True, len(missing), None


# Also scan the dispatch/ and bookings/ packages since they were also decomposed earlier
ALL_PACKAGES = packages + ['dispatch', 'bookings', 'gallery']

total_fixed = 0
total_missing = 0
errors = []

for pkg in ALL_PACKAGES:
    pkg_dir = os.path.join(BASE, pkg)
    if not os.path.isdir(pkg_dir):
        continue
    for fname in sorted(os.listdir(pkg_dir)):
        if not fname.endswith('.py') or fname == '__init__.py':
            continue
        fpath = os.path.join(pkg_dir, fname)
        fixed, count, error = fix_file(fpath)
        
        if error:
            errors.append(f"  {pkg}/{fname}: {error}")
            print(f"  ERROR: {pkg}/{fname}: {error}")
        elif fixed:
            total_fixed += 1
            total_missing += count
            print(f"  FIXED: {pkg}/{fname} (+{count} imports)")
        else:
            print(f"  OK:    {pkg}/{fname}")

print(f"\nSummary: Fixed {total_fixed} files, added {total_missing} total missing imports")
if errors:
    print(f"\nErrors ({len(errors)}):")
    for e in errors:
        print(e)

# Post-fix verification
print("\nPost-fix AST verification:")
all_ok = True
for pkg in ALL_PACKAGES:
    pkg_dir = os.path.join(BASE, pkg)
    if not os.path.isdir(pkg_dir):
        continue
    for fname in sorted(os.listdir(pkg_dir)):
        if not fname.endswith('.py'):
            continue
        fpath = os.path.join(pkg_dir, fname)
        try:
            ast.parse(open(fpath, encoding='utf-8').read())
        except SyntaxError as e:
            print(f"  FAIL: {pkg}/{fname}: {e}")
            all_ok = False

if all_ok:
    print("  ALL FILES PASS AST CHECK")

# Re-run missing import scan to confirm none remain
print("\nPost-fix missing import scan:")
remaining = 0
for pkg in ALL_PACKAGES:
    pkg_dir = os.path.join(BASE, pkg)
    if not os.path.isdir(pkg_dir):
        continue
    for fname in sorted(os.listdir(pkg_dir)):
        if not fname.endswith('.py') or fname == '__init__.py':
            continue
        fpath = os.path.join(pkg_dir, fname)
        content = open(fpath, encoding='utf-8').read()
        tree = ast.parse(content)
        defined = get_top_level_defined(tree)
        used = get_all_used_names(tree)
        missing = {name for name in used if name in ALL_KNOWN and name not in defined}
        if missing:
            remaining += len(missing)
            print(f"  STILL MISSING: {pkg}/{fname}: {sorted(missing)}")

if remaining == 0:
    print("  NO MISSING IMPORTS REMAIN")
else:
    print(f"  {remaining} imports still missing")
