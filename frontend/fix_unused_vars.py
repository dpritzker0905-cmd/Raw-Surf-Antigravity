import json
import re
import os

QA_STATUS = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\qa-agent\qa-status.json'
FRONTEND_BASE = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\frontend'

with open(QA_STATUS, 'r', encoding='utf-8-sig') as f:
    status = json.load(f)

eslint = next(c for c in status['checks'] if c['tool'] == 'ESLint')
issues = [e for e in eslint['errors'] if e['rule'] == 'unused-imports/no-unused-vars']

print(f"Total unused-var issues to fix: {len(issues)}")

# Group by file
by_file = {}
for issue in issues:
    fp = issue['file']
    by_file.setdefault(fp, []).append(issue)

total_fixed = 0

for rel_path, file_issues in by_file.items():
    # rel_path looks like \src\components\Foo.js
    full_path = FRONTEND_BASE + rel_path
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {full_path}")
        continue

    with open(full_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    modified = False

    for issue in file_issues:
        line_idx = issue['line'] - 1
        if line_idx < 0 or line_idx >= len(lines):
            continue

        line_content = lines[line_idx]

        # Extract var name from message
        m = re.match(r"^'([^']+)'", issue['message'])
        if not m:
            continue
        var_name = m.group(1)

        # Skip if already underscore prefixed
        if var_name.startswith('_'):
            continue

        new_name = f"_{var_name}"

        # Replace the first occurrence of the exact var name on this line (word boundary)
        new_line = re.sub(r'\b' + re.escape(var_name) + r'\b', new_name, line_content, count=1)

        if new_line != line_content:
            lines[line_idx] = new_line
            modified = True
            total_fixed += 1
            print(f"  Fixed {rel_path}:{issue['line']} — {var_name} -> {new_name}")
        else:
            print(f"  SKIP (no match on line) {rel_path}:{issue['line']} — {var_name}")

    if modified:
        with open(full_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

print(f"\nTotal fixes applied: {total_fixed}")
