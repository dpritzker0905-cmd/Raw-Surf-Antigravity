"""
Fix Pass 2: Properly migrate remaining files that still have:
  1. admin_id: str, in function signatures
  2. Inline admin verification blocks
  3. Broken admin.id references before admin is defined

These files need to:
  1. Add Depends(get_current_admin) import
  2. Replace admin_id: str in signatures with admin: Profile = Depends(get_current_admin)
  3. Remove inline verification blocks entirely
  4. Replace remaining admin_id refs with admin.id

Run: python fix_pass2.py
"""
import os
import re

ROUTES_DIR = os.path.join(os.path.dirname(__file__), "routes")

# The import line
IMPORT_LINE = "from deps.admin_auth import get_current_admin"

def fix_file(filepath):
    filename = os.path.basename(filepath)
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original = content

    # Skip if no admin_id in signatures
    if "admin_id: str," not in content and "admin_id: str\n" not in content:
        return 0
    
    # 1. Add import if missing
    if IMPORT_LINE not in content:
        if "from database import get_db" in content:
            content = content.replace(
                "from database import get_db",
                f"from database import get_db\n{IMPORT_LINE}"
            )
    
    # 2. Replace admin_id: str, in function signatures
    # Pattern: "    admin_id: str,\n" inside function defs
    content = content.replace("    admin_id: str,\n", "    admin: Profile = Depends(get_current_admin),\n")
    
    # 3. Remove inline admin verification blocks
    # Pattern:
    #     # Verify admin
    #     result = await db.execute(select(Profile).where(Profile.id == admin.id))
    #     admin = result.scalar_one_or_none()
    #     if not admin or not admin.is_admin:
    #         raise HTTPException(status_code=403, detail="Admin access required")
    inline_verify = re.compile(
        r'    # Verify admin\s*\n'
        r'    result = await db\.execute\(select\(Profile\)\.where\(Profile\.id == admin\.id\)\)\s*\n'
        r'    admin = result\.scalar_one_or_none\(\)\s*\n'
        r'    if not admin or not admin\.is_admin:\s*\n'
        r'        raise HTTPException\(status_code=403, detail="Admin access required"\)\s*\n',
        re.MULTILINE
    )
    content = inline_verify.sub('', content)
    
    # Also catch ones that still reference admin_id (before our earlier fix)
    inline_verify2 = re.compile(
        r'    # Verify admin\s*\n'
        r'    result = await db\.execute\(select\(Profile\)\.where\(Profile\.id == admin_id\)\)\s*\n'
        r'    admin = result\.scalar_one_or_none\(\)\s*\n'
        r'    if not admin or not admin\.is_admin:\s*\n'
        r'        raise HTTPException\(status_code=403, detail="Admin access required"\)\s*\n',
        re.MULTILINE
    )
    content = inline_verify2.sub('', content)
    
    # Also catch blocks without the "# Verify admin" comment
    inline_verify3 = re.compile(
        r'    result = await db\.execute\(select\(Profile\)\.where\(Profile\.id == admin\.id\)\)\s*\n'
        r'    admin = result\.scalar_one_or_none\(\)\s*\n'
        r'    if not admin or not admin\.is_admin:\s*\n'
        r'        raise HTTPException\(status_code=403, detail="Admin access required"\)\s*\n',
        re.MULTILINE
    )
    content = inline_verify3.sub('', content)
    
    # 4. Replace remaining body references
    content = content.replace("verified_by=admin_id", "verified_by=admin.id")
    content = content.replace(".verified_by = admin_id", ".verified_by = admin.id")
    content = content.replace("updated_by=admin_id", "updated_by=admin.id")
    content = content.replace("created_by=admin_id", "created_by=admin.id")
    content = content.replace("approved_by=admin_id", "approved_by=admin.id")
    content = content.replace("rejected_by=admin_id", "rejected_by=admin.id")
    content = content.replace("reviewed_by=admin_id", "reviewed_by=admin.id")
    content = content.replace("released_by=admin_id", "released_by=admin.id")
    
    # Replace in save_ad_config calls and log messages 
    content = content.replace("save_ad_config(config, admin_id, db)", "save_ad_config(config, admin.id, db)")
    content = re.sub(r'by admin \{admin_id\}', 'by admin {admin.id}', content)
    content = re.sub(r'by admin \$\{admin_id\}', 'by admin ${admin.id}', content)
    content = re.sub(r'"reviewed_by": admin_id', '"reviewed_by": admin.id', content)
    
    # Fix comp_result.verified_by = admin_id pattern
    content = content.replace("comp_result.verified_by = admin_id", "comp_result.verified_by = admin.id")
    
    if content != original:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  FIXED {filename}")
        return 1
    return 0


def main():
    print("Pass 2: Fixing files with bare admin_id: str signatures\n")
    
    total = 0
    for filename in sorted(os.listdir(ROUTES_DIR)):
        if not filename.endswith(".py"):
            continue
        filepath = os.path.join(ROUTES_DIR, filename)
        total += fix_file(filepath)
    
    print(f"\nFiles fixed: {total}")


if __name__ == "__main__":
    main()
