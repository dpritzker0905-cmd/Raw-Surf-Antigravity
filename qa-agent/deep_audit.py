"""Deep structural audit: scan all frontend components for common crash patterns."""
import re, os, json

frontend_src = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src')
components_dir = os.path.join(frontend_src, 'components')

issues = []

def check_file(fpath, fname):
    with open(fpath, encoding='utf-8') as f:
        src = f.read()
    
    # 1. Check for require() calls in browser code (CommonJS in ESM context)
    require_matches = re.findall(r'\brequire\s*\(', src)
    # Ignore dynamic import patterns that look like require
    actual_requires = [m for m in re.finditer(r'(?<!// )\brequire\s*\(["\']', src)]
    if actual_requires:
        for m in actual_requires:
            line = src[:m.start()].count('\n') + 1
            issues.append(f"[CRASH] {fname}:{line} - require() in browser code (use import)")
    
    # 2. Check for empty catch blocks (no-empty)
    for m in re.finditer(r'catch\s*\([^)]*\)\s*\{\s*\}', src):
        line = src[:m.start()].count('\n') + 1
        issues.append(f"[LINT] {fname}:{line} - Empty catch block")
    
    # 3. Check for useNavigate without import
    if 'useNavigate()' in src and "from 'react-router-dom'" not in src:
        issues.append(f"[CRASH] {fname} - useNavigate() used but react-router-dom not imported")
    
    # 4. Check for useAuth without import
    if 'useAuth()' in src and "from '../contexts/AuthContext'" not in src and "from './contexts/AuthContext'" not in src:
        # Check for re-exports
        if 'useAuth' not in src.split('import')[0]:  # not defined locally
            pass  # Many files import useAuth in various ways
    
    # 5. Check for duplicate imports
    import_lines = [l.strip() for l in src.split('\n') if l.strip().startswith('import ')]
    seen = {}
    for imp in import_lines:
        if imp in seen:
            line = src.index(imp)
            actual_line = src[:line].count('\n') + 1
            issues.append(f"[DUPE] {fname}:{actual_line} - Duplicate import: {imp[:80]}...")
        seen[imp] = True
    
    # 6. Check for useState/useEffect without React import
    if ('useState(' in src or 'useEffect(' in src or 'useCallback(' in src or 'useMemo(' in src):
        if "from 'react'" not in src and 'from "react"' not in src:
            issues.append(f"[CRASH] {fname} - React hooks used but 'react' not imported")
    
    # 7. Check for process.env references without fallback 
    env_refs = re.findall(r'process\.env\.(\w+)', src)
    for env_var in set(env_refs):
        if env_var not in ['REACT_APP_BACKEND_URL', 'REACT_APP_SUPABASE_URL', 'REACT_APP_SUPABASE_ANON_KEY',
                           'REACT_APP_STRIPE_KEY', 'REACT_APP_ONESIGNAL_APP_ID', 'REACT_APP_LIVEKIT_URL',
                           'REACT_APP_GIPHY_API_KEY', 'REACT_APP_MAPBOX_TOKEN', 'NODE_ENV',
                           'REACT_APP_LIVEKIT_API_KEY', 'REACT_APP_LIVEKIT_SECRET']:
            issues.append(f"[ENV] {fname} - Unknown env var: {env_var}")

# Scan all components
for root, dirs, files in os.walk(components_dir):
    for fname in files:
        if fname.endswith(('.js', '.jsx', '.tsx')) and not fname.startswith('_'):
            fpath = os.path.join(root, fname)
            check_file(fpath, fname)

# Scan hooks
hooks_dir = os.path.join(frontend_src, 'hooks')
for fname in os.listdir(hooks_dir):
    if fname.endswith('.js'):
        check_file(os.path.join(hooks_dir, fname), f"hooks/{fname}")

# Scan contexts
ctx_dir = os.path.join(frontend_src, 'contexts')
for fname in os.listdir(ctx_dir):
    if fname.endswith('.js'):
        check_file(os.path.join(ctx_dir, fname), f"contexts/{fname}")

# Scan lib/
lib_dir = os.path.join(frontend_src, 'lib')
if os.path.isdir(lib_dir):
    for fname in os.listdir(lib_dir):
        if fname.endswith('.js'):
            check_file(os.path.join(lib_dir, fname), f"lib/{fname}")

# Scan pages
pages_dir = os.path.join(frontend_src, 'pages')
if os.path.isdir(pages_dir):
    for fname in os.listdir(pages_dir):
        if fname.endswith('.js'):
            check_file(os.path.join(pages_dir, fname), f"pages/{fname}")

# Group by severity
crashes = [i for i in issues if '[CRASH]' in i]
lints = [i for i in issues if '[LINT]' in i]
dupes = [i for i in issues if '[DUPE]' in i]
envs = [i for i in issues if '[ENV]' in i]

print(f"=== DEEP STRUCTURAL AUDIT ===")
print(f"Total issues: {len(issues)}")
print(f"  CRASH-level: {len(crashes)}")
print(f"  LINT-level:  {len(lints)}")
print(f"  DUPLICATE:   {len(dupes)}")
print(f"  ENV:         {len(envs)}")
print()

if crashes:
    print("--- CRASH-LEVEL (will break at runtime) ---")
    for c in crashes:
        print(f"  {c}")
    print()

if dupes:
    print("--- DUPLICATE IMPORTS ---")
    for d in dupes:
        print(f"  {d}")
    print()

if lints:
    print("--- EMPTY CATCH BLOCKS ---")
    for l in lints:
        print(f"  {l}")
    print()

if envs:
    print("--- UNKNOWN ENV VARS ---")
    for e in envs:
        print(f"  {e}")
