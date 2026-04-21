import os

path = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\backend\routes\career.py'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix line 205 (index 204) - corrupted docstring
lines[204] = '    """Admin/AI verifies a competition result and awards XP"""\n'

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Fixed line 205 in career.py")
