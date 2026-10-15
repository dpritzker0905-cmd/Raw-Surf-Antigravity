import json
from pathlib import Path
from metrics import color, MODELS

root = Path(__file__).resolve().parents[3] / 'evidence'
out = {}
for arm in ('before', 'after'):
    data = json.loads((root / f'field-{arm}' / 'gpu-ramp.json').read_text())
    out[arm] = {}
    for theme in ('beach', 'light', 'dark'):
        row = next(f for f in data['field'] if f['theme'] == theme and f['opacity'] == .75 and f['direction'] == 0)
        out[arm][theme] = {kind: [{'h': s['h'], 'hex': color(s['rgb'], kind, method).convert('srgb').clip().to_string(hex=True)} for s in row['samples']] for kind, method in MODELS}
(root / 'cvd-swatches.json').write_text(json.dumps(out))
