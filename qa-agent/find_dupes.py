"""Find exact duplicate import lines in frontend files."""
import os

frontend_src = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src')

def find_dupes(fpath, fname):
    with open(fpath, encoding='utf-8') as f:
        lines = f.readlines()
    
    import_lines = {}
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('import ') and 'from ' in stripped:
            if stripped in import_lines:
                print(f"  {fname}:{i} (duplicate of line {import_lines[stripped]})")
                print(f"    -> {stripped[:120]}")
            else:
                import_lines[stripped] = i

print("=== EXACT DUPLICATE IMPORT LINES ===\n")
components_dir = os.path.join(frontend_src, 'components')
for root, dirs, files in os.walk(components_dir):
    for fname in sorted(files):
        if fname.endswith(('.js', '.jsx')):
            find_dupes(os.path.join(root, fname), fname)
