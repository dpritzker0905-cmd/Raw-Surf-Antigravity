import json
with open('eslint_errors.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
for file_info in data:
    if 'test.js' in file_info['filePath'] or 'setupTests.js' in file_info['filePath']:
        continue
    errors = [m for m in file_info['messages'] if m['severity'] == 2]
    if errors:
        print(f"File: {file_info['filePath']}")
        for e in errors:
            print(f"  Line {e['line']}: {e['message']} [{e.get('ruleId')}]")
