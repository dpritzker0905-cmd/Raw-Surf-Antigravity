"""
Fix script: Replace all remaining admin_id variable references with admin.id
in function bodies that were missed by the initial migration.

The migration script correctly updated function signatures from:
    admin_id: str = Query(...) -> admin: Profile = Depends(get_current_admin)
But it missed body references like:
    created_by=admin_id -> created_by=admin.id
    log_audit(db, admin_id, ...) -> log_audit(db, admin.id, ...)
    dispute.resolved_by = admin_id -> dispute.resolved_by = admin.id

Run: python fix_admin_id_refs.py
"""
import os
import re

ROUTES_DIR = os.path.join(os.path.dirname(__file__), "routes")

# Patterns that are VARIABLE references (need admin_id -> admin.id)
# We specifically target contexts where admin_id is used as a value, not a column name
REPLACEMENTS = [
    # Function arg: log_audit(db, admin_id, ...)
    (r'(log_audit\(db,\s*)admin_id', r'\1admin.id'),
    # Keyword args: created_by=admin_id, sender_id=admin_id, etc.  
    (r'created_by=admin_id', 'created_by=admin.id'),
    (r'sender_id=admin_id', 'sender_id=admin.id'),
    (r'initiated_by=admin_id', 'initiated_by=admin.id'),
    (r'processed_by=admin_id', 'processed_by=admin.id'),
    # Assignment: .resolved_by = admin_id, .reviewed_by = admin_id
    (r'\.resolved_by\s*=\s*admin_id', '.resolved_by = admin.id'),
    (r'\.reviewed_by\s*=\s*admin_id', '.reviewed_by = admin.id'),
    (r'\.released_by\s*=\s*admin_id', '.released_by = admin.id'),
    # Comparison: == admin_id (but not Model.admin_id on the left side)
    (r'==\s*admin_id\b', '== admin.id'),
    # Dict value: "admin_id": admin_id (the key is fine, value needs fixing)
    # Already handled by the first migration
]

def fix_file(filepath):
    filename = os.path.basename(filepath)
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    
    # Skip if no admin_id references remain
    # But we need to be careful: admin_id can appear as:
    # 1. A variable reference (BROKEN - needs fixing)  
    # 2. A model column name like AdminLog.admin_id (FINE - keep as-is)
    # 3. A Pydantic field name (FINE - keep as-is)
    # 4. An import (FINE - keep as-is)
    
    for pattern, replacement in REPLACEMENTS:
        content = re.sub(pattern, replacement, content)
    
    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        
        # Count changes
        changes = 0
        for pattern, _ in REPLACEMENTS:
            changes += len(re.findall(pattern, original))
        
        print(f"  FIXED {filename}: {changes} reference(s)")
        return changes
    return 0


def main():
    print("Fixing remaining admin_id -> admin.id references\n")
    
    total = 0
    for filename in sorted(os.listdir(ROUTES_DIR)):
        if not filename.endswith(".py"):
            continue
        filepath = os.path.join(ROUTES_DIR, filename)
        total += fix_file(filepath)
    
    print(f"\nTotal refs fixed: {total}")


if __name__ == "__main__":
    main()
