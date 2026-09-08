"""Independent algebraic controls on actual code, not a nearshore skill validation."""
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from services.weather_pipeline import surf_transform as st
from services.weather_pipeline.forecast_spread import relative_spread, confidence_level

rows = []
for period in [3., 5., 8., 12., 18., 25.]:
    for depth in [.2, 1., 5., 20., 100., 1000.]:
        k = st.wavenumber(period, depth)
        omega2 = (2 * math.pi / period) ** 2
        residual = abs(st.G * k * math.tanh(k * depth) - omega2) / omega2
        scaled = st.wavenumber(2 * period, 4 * depth)
        error = abs(scaled * 4 / k - 1)
        rows.append({'period_s': period, 'depth_m': depth,
                     'dispersion_relative_residual': residual, 'scaling_relative_error': error})
assert max(r['dispersion_relative_residual'] for r in rows) < 1e-6
assert max(r['scaling_relative_error'] for r in rows) < 1e-6
# Independently investigate non-finite inputs; record behavior rather than silently sanitizing it.
invalid = []
for spread, height in [(float('inf'), 1.), (1., float('inf')), (float('inf'), float('inf'))]:
    value = relative_spread(spread, height)
    invalid.append({'spread': str(spread), 'height': str(height),
                    'relative_spread': str(value), 'confidence': confidence_level(spread, height)})
files = ['surf_transform.py', 'forecast_spread.py', 'science_registry.py', 'surf_height_convention.py']
result = {'dispersion_cases': rows, 'nonfinite_spread_probe': invalid,
          'source_hashes': {name: hashlib.sha256((ROOT / 'backend/services/weather_pipeline' / name).read_bytes()).hexdigest() for name in files},
          'scope': 'Finite dispersion/scaling controls only. Invalid spread classifications are a reproduced helper-boundary defect; production reachability not established. No parameter changes.'}
if len(sys.argv) > 1:
    assert all(row['confidence'] is None for row in invalid)
    result['scope'] = 'Post-fix replay: finite dispersion/scaling preserved; nonfinite confidence inputs refused. Production reachability of invalid inputs remains unestablished.'
out = sys.argv[1] if len(sys.argv) > 1 else 'context-science-controls.json'
(Path(__file__).parent / out).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'cases': len(rows), 'max_residual': max(r['dispersion_relative_residual'] for r in rows), 'invalid': invalid}))
