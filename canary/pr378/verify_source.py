"""Build-time pin check; no imports of application code or provider clients."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
base = '6fbf439ac2bb2da5337f9a45864ffd3af8be8423'
subprocess.run(['git', 'diff', '--exit-code', base, 'HEAD', '--', 'backend'], cwd=root, check=True)
pins = json.loads((Path(__file__).parent / 'pins.json').read_text())
for name, expected in pins['source_sha256_lf'].items():
    assert hashlib.sha256((root / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == expected, name
print('Backend source matches #378 pin', base)
