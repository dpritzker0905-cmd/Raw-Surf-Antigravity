"""
Migration script: Replace all insecure admin_id query param patterns
with the shared get_current_admin JWT dependency.

Handles two patterns:
  1. Inline admin verification (select + is_admin check in endpoint body)
  2. require_admin / check_is_admin helper calls

Run from backend/ directory:
    python migrate_admin_auth.py
"""
import os
import re
import sys

ROUTES_DIR = os.path.join(os.path.dirname(__file__), "routes")

# Files we've already manually fixed
ALREADY_FIXED = {
    "reviews.py",
    "compliance.py", 
    "analytics.py",
    "admin_analytics.py",
}

# The import line we need to add
IMPORT_LINE = "from deps.admin_auth import get_current_admin"

def fix_file(filepath):
    """Fix a single file's admin auth pattern."""
    filename = os.path.basename(filepath)
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content
    changes = []
    
    # Skip if no admin_id pattern exists
    if "admin_id" not in content:
        return 0
    
    # Skip files without admin auth patterns
    has_require = "require_admin" in content or "check_is_admin" in content
    has_inline = re.search(r'admin_id.*=.*Query\(\.\.\.', content)
    
    if not has_require and not has_inline:
        return 0
    
    # 1. Add import if not already present
    if IMPORT_LINE not in content:
        # Find a good insertion point — after the last 'from' import block
        # Try after "from database import get_db"
        db_import = "from database import get_db"
        if db_import in content:
            content = content.replace(
                db_import,
                f"{db_import}\n{IMPORT_LINE}"
            )
            changes.append("Added get_current_admin import")
        else:
            # Fallback: add after first import block
            lines = content.split("\n")
            insert_idx = 0
            for i, line in enumerate(lines):
                if line.startswith("from ") or line.startswith("import "):
                    insert_idx = i + 1
            lines.insert(insert_idx, IMPORT_LINE)
            content = "\n".join(lines)
            changes.append("Added get_current_admin import (fallback position)")
    
    # 2. Remove local require_admin / check_is_admin function definitions
    # Pattern: async def require_admin(admin_id: str, db: AsyncSession) -> Profile:
    #          ... body ... return admin
    local_func_pattern = re.compile(
        r'\n*async def (?:require_admin|check_is_admin)\(admin_id: str.*?\n'
        r'(?:.*?\n)*?'
        r'    return admin\n',
        re.MULTILINE
    )
    if local_func_pattern.search(content):
        content = local_func_pattern.sub('\n', content)
        changes.append("Removed local require_admin/check_is_admin function")
    
    # 3. Replace endpoint signatures:
    # Pattern A: admin_id: str = Query(...),
    # Replace with: admin: Profile = Depends(get_current_admin),
    # But only in function defs (not in body code)
    
    # Find all endpoint function definitions and fix their signatures
    def fix_endpoint_signature(match):
        """Fix a single endpoint function signature."""
        full = match.group(0)
        # Replace admin_id: str = Query(...) with admin dependency
        fixed = re.sub(
            r'    admin_id: str = Query\(\.\.\.\),?\n',
            '    admin: Profile = Depends(get_current_admin),\n',
            full
        )
        # Also handle: admin_id: str, (path/query param without Query)
        fixed = re.sub(
            r'    admin_id: str,\n',
            '    admin: Profile = Depends(get_current_admin),\n',
            fixed
        )
        return fixed
    
    # Match "async def func_name(\n    ...params...\n):"
    endpoint_pattern = re.compile(
        r'(async def \w+\(\n(?:.*?\n)*?^\):\n)',
        re.MULTILINE
    )
    
    new_content = endpoint_pattern.sub(fix_endpoint_signature, content)
    if new_content != content:
        content = new_content
        changes.append("Replaced admin_id params in endpoint signatures")
    
    # 4. Remove the await require_admin / check_is_admin calls from bodies
    content = re.sub(
        r'    await (?:require_admin|check_is_admin)\(admin_id, db\)\n',
        '',
        content
    )
    content = re.sub(
        r'    admin = await (?:require_admin|check_is_admin)\(admin_id, db\)\n',
        '',
        content
    )
    changes.append("Removed require_admin/check_is_admin calls from bodies")
    
    # 5. Replace remaining admin_id references in bodies with admin.id
    # But be careful not to replace things like AdminLog(admin_id=admin_id)
    # We want: admin_id -> admin.id in assignments and log references
    content = re.sub(r'admin_id=admin_id', 'admin_id=admin.id', content)
    content = re.sub(r'"admin_id": admin_id', '"admin_id": admin.id', content)
    content = re.sub(r'reviewed_by=admin_id', 'reviewed_by=admin.id', content)
    content = re.sub(r'approved_by=admin_id', 'approved_by=admin.id', content)
    content = re.sub(r'edited_by=admin_id', 'edited_by=admin.id', content)
    content = re.sub(r'reported_by=admin_id', 'reported_by=admin.id', content)
    content = re.sub(r'assigned_to=admin_id', 'assigned_to=admin.id', content)
    content = re.sub(r'updated_by.*=.*admin_id', 'updated_by=admin.id', content)
    
    # Ensure Profile is imported (needed for type hint)
    if "Profile = Depends(get_current_admin)" in content:
        if "from models import" not in content and "Profile" not in content:
            # Need to add Profile import
            content = content.replace(IMPORT_LINE, f"{IMPORT_LINE}\nfrom models import Profile")
            changes.append("Added Profile import")
    
    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ {filename}: {len(changes)} changes — {', '.join(changes)}")
        return len(changes)
    else:
        return 0


def main():
    print("🔒 Admin Auth Migration — Replacing insecure admin_id patterns\n")
    
    total_files = 0
    total_changes = 0
    
    for filename in sorted(os.listdir(ROUTES_DIR)):
        if not filename.endswith(".py"):
            continue
        if filename in ALREADY_FIXED:
            continue
        if filename == "__init__.py":
            continue
        
        filepath = os.path.join(ROUTES_DIR, filename)
        n = fix_file(filepath)
        if n > 0:
            total_files += 1
            total_changes += n
    
    print(f"\n📊 Summary: {total_files} files modified, {total_changes} changes applied")
    print("⚠️  Review the changes — some admin_id references in data structures may need manual review")


if __name__ == "__main__":
    main()
