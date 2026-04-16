"""
Script: replace hardcoded GROM_PARENT role checks with is_grom_parent_eligible() helper.
Run from the backend/ directory.
"""
import re, os

FILES_TO_PATCH = [
    'routes/grom_hq.py',
    'routes/gallery.py',
    'routes/leaderboard.py',
    'routes/messages.py',
    'routes/photographer.py',
    'routes/sessions.py',
    'routes/subscriptions.py',
    'routes/surf_spots.py',
]

IMPORT_LINE = 'from utils.grom_parent import is_grom_parent_eligible\n'

# Patterns to replace
REPLACEMENTS = [
    # Checks: if parent.role != RoleEnum.GROM_PARENT: raise ...
    (
        r'(\w+)\.role != RoleEnum\.GROM_PARENT',
        r'not is_grom_parent_eligible(\1)'
    ),
    # Checks: if not parent or parent.role != RoleEnum.GROM_PARENT:
    (
        r'not (\w+) or (\w+)\.role != RoleEnum\.GROM_PARENT',
        r'not \1 or not is_grom_parent_eligible(\2)'
    ),
    # Assignment: is_grom_parent = photographer.role == RoleEnum.GROM_PARENT
    (
        r'is_grom_parent = (\w+)\.role == RoleEnum\.GROM_PARENT',
        r'is_grom_parent = is_grom_parent_eligible(\1)'
    ),
    # Assignment with guard: is_grom_parent = photographer and photographer.role == RoleEnum.GROM_PARENT
    (
        r'is_grom_parent = (\w+) and (\w+)\.role == RoleEnum\.GROM_PARENT',
        r'is_grom_parent = bool(\1) and is_grom_parent_eligible(\2)'
    ),
    # Positive check: if parent.role == RoleEnum.GROM_PARENT:
    (
        r'(\w+)\.role == RoleEnum\.GROM_PARENT',
        r'is_grom_parent_eligible(\1)'
    ),
]

for filepath in FILES_TO_PATCH:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add import after the last existing 'from' or 'import' line near the top
    if IMPORT_LINE.strip() not in content:
        # Insert after last import in first 30 lines
        lines = content.split('\n')
        insert_at = 0
        for i, line in enumerate(lines[:30]):
            if line.startswith('from ') or line.startswith('import '):
                insert_at = i + 1
        lines.insert(insert_at, IMPORT_LINE.strip())
        content = '\n'.join(lines)
    
    # Apply replacements in order (most specific first)
    for pattern, replacement in REPLACEMENTS:
        content = re.sub(pattern, replacement, content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f"[OK] Patched: {filepath}")

print("\nAll files patched.")
