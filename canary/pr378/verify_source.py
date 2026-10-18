"""Build-time pin check; no imports of application code or provider clients."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
base = '6fbf439ac2bb2da5337f9a45864ffd3af8be8423'
tree = subprocess.check_output(['git', 'rev-parse', 'HEAD:backend'], cwd=root, text=True).strip()
assert tree == '6899f987ec78b500f0b8b53897944791b012c487', 'Backend tree differs from #378 pin'
pins = json.loads((Path(__file__).parent / 'pins.json').read_text())
for name, expected in pins['source_sha256_lf'].items():
    assert hashlib.sha256((root / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == expected, name
print('Backend source matches #378 pin', base)
