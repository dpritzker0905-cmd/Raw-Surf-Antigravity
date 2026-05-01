"""
Auto-fix model imports: Add missing 'from models import ...' to sub-modules.
These are different from standard library imports because they all come from 'models'.
Uses the same AST-based insertion strategy as _fix_imports.py v2.
"""
import ast
import os

BASE = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\backend\routes'
packages = ['photographer', 'surf_spots', 'posts', 'messages', 'surfer_gallery', 'uploads', 'grom_hq', 'condition_reports', 'sessions']

# Model names and their source module
# Most come from 'models', some are helper functions
MODELS_MODULE = {
    'Profile', 'Post', 'PostLike', 'Comment', 'PostReaction', 'CommentReaction',
    'SurfSpot', 'LiveSession', 'SessionParticipant', 'Booking', 'BookingParticipant',
    'Message', 'Conversation', 'ConversationParticipant',
    'GalleryItem', 'Gallery', 'PhotoTag', 'SurferLocker',
    'ConditionReport', 'ConditionReportGallery',
    'RoleEnum', 'GromAccount', 'ParentalLink',
    'Notification',
}

# Helper functions from models or utils
HELPERS = {
    'is_grom_parent_eligible': 'from .schemas import is_grom_parent_eligible',
}

def get_all_defined(tree):
    """Get all names defined in the module (including inside functions)."""
    defined = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                defined.add(alias.asname or alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                defined.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    defined.add(target.id)
    return defined

def get_all_used(tree):
    """Get all Name references."""
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            used.add(node.id)
    return used

def find_top_level_import_end(tree):
    """Find line number of last top-level import."""
    last = 0
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            last = node.end_lineno or node.lineno
        elif isinstance(node, ast.Try):
            # Check for try/import blocks
            for child in node.body + node.handlers:
                if isinstance(child, (ast.Import, ast.ImportFrom)):
                    last = max(last, child.end_lineno or child.lineno)
                elif hasattr(child, 'body'):
                    for c in child.body:
                        if isinstance(c, (ast.Import, ast.ImportFrom)):
                            last = max(last, c.end_lineno or c.lineno)
            last = max(last, node.end_lineno or node.lineno)
    return last

def find_docstring_end(content):
    """Find end line of module docstring (0-indexed), or -1."""
    lines = content.split('\n')
    in_docstring = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not in_docstring and (i < 2 or (i == 2 and not lines[1].strip())):
            if stripped.startswith('"""') or stripped.startswith("'''"):
                quote = stripped[:3]
                if stripped.count(quote) >= 2:
                    return i
                in_docstring = True
                continue
        if in_docstring:
            if '"""' in stripped or "'''" in stripped:
                return i
    return -1


def fix_file(fpath, pkg_name):
    """Add missing model imports to a file."""
    content = open(fpath, encoding='utf-8').read()
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        return False, 0, f"SYNTAX ERROR: {e}"
    
    defined = get_all_defined(tree)
    used = get_all_used(tree)
    
    # Find missing model imports
    missing_models = sorted(n for n in used if n in MODELS_MODULE and n not in defined)
    missing_helpers = sorted(n for n in used if n in HELPERS and n not in defined)
    
    if not missing_models and not missing_helpers:
        return False, 0, None
    
    # Check if there's already a 'from models import' line — if so, extend it
    lines = content.split('\n')
    model_import_line_idx = None
    model_import_line = None
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('from models import') or stripped.startswith('from models import'):
            model_import_line_idx = i
            model_import_line = stripped
            break
    
    if model_import_line_idx is not None and missing_models:
        # Extend existing import line
        # Parse existing imports
        existing = model_import_line.replace('from models import', '').strip()
        existing_names = [n.strip() for n in existing.split(',')]
        all_names = sorted(set(existing_names + missing_models))
        new_line = f"from models import {', '.join(all_names)}"
        lines[model_import_line_idx] = new_line
    elif missing_models:
        # Add new import line
        import_end = find_top_level_import_end(tree)
        if import_end > 0:
            insert_idx = import_end  # 0-indexed line after last import
        else:
            docstring_end = find_docstring_end(content)
            insert_idx = docstring_end + 1 if docstring_end >= 0 else 0
        
        new_line = f"from models import {', '.join(sorted(missing_models))}"
        lines.insert(insert_idx, new_line)
    
    # Add helper imports  
    if missing_helpers:
        # Check if this is a grom_hq file — is_grom_parent_eligible comes from schemas
        for helper_name in missing_helpers:
            # Check if it's defined in the package's schemas.py
            schemas_path = os.path.join(os.path.dirname(fpath), 'schemas.py')
            if os.path.exists(schemas_path):
                schemas_content = open(schemas_path, encoding='utf-8').read()
                if f'def {helper_name}' in schemas_content or f'{helper_name} =' in schemas_content:
                    import_line = f'from .schemas import {helper_name}'
                else:
                    # It might be defined inline in the legacy monolith
                    # For is_grom_parent_eligible, it's typically a top-level function in the monolith
                    # We'll need to add it to schemas.py or import it differently
                    import_line = None
            else:
                import_line = None
            
            if import_line:
                # Find insertion point
                new_lines = '\n'.join(lines).split('\n')
                # Find last import
                last_import = 0
                for i, l in enumerate(new_lines):
                    if l.strip().startswith('from ') or l.strip().startswith('import '):
                        last_import = i
                new_lines.insert(last_import + 1, import_line)
                lines = new_lines
    
    new_content = '\n'.join(lines)
    
    # Verify
    try:
        ast.parse(new_content)
    except SyntaxError as e:
        return False, 0, f"INJECTION SYNTAX ERROR: {e}"
    
    open(fpath, 'w', encoding='utf-8').write(new_content)
    total = len(missing_models) + len(missing_helpers)
    return True, total, None


total_fixed = 0
total_count = 0
errors = []

for pkg in packages:
    pkg_dir = os.path.join(BASE, pkg)
    for fname in sorted(os.listdir(pkg_dir)):
        if not fname.endswith('.py') or fname in ('__init__.py', 'schemas.py'):
            continue
        fpath = os.path.join(pkg_dir, fname)
        fixed, count, error = fix_file(fpath, pkg)
        if error:
            errors.append(f"  {pkg}/{fname}: {error}")
            print(f"  ERROR: {pkg}/{fname}: {error}")
        elif fixed:
            total_fixed += 1
            total_count += count
            print(f"  FIXED: {pkg}/{fname} (+{count} model imports)")
        else:
            print(f"  OK:    {pkg}/{fname}")

print(f"\nSummary: Fixed {total_fixed} files, added {total_count} model imports")
if errors:
    for e in errors:
        print(e)

# Verify
print("\nAST verification:")
all_ok = True
for pkg in packages:
    pkg_dir = os.path.join(BASE, pkg)
    for fname in sorted(os.listdir(pkg_dir)):
        if not fname.endswith('.py'):
            continue
        try:
            ast.parse(open(os.path.join(pkg_dir, fname), encoding='utf-8').read())
        except SyntaxError as e:
            print(f"  FAIL: {pkg}/{fname}: {e}")
            all_ok = False
if all_ok:
    print("  ALL FILES PASS")
