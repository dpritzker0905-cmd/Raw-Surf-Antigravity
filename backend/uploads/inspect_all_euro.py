import json
import glob
from pathlib import Path
import numpy as np

path = Path("c:/Users/dprit/Raw-Surf/backend/uploads/weather_products")
files = glob.glob(str(path / "viewport_euro_marine_*.json"))

print(f"Found {len(files)} viewport_euro_marine files:")
for fpath in sorted(files):
    name = Path(fpath).name
    with open(fpath) as f:
        data = json.load(f)
        layer = data.get("layer", "unknown")
        grid = data.get("grid", {})
        vectors = grid.get("vectors", [])
        
        speeds = []
        for v in vectors:
            if v.get("is_valid", False):
                s = v.get("speed")
                if s is not None:
                    speeds.append(s)
        
        if speeds:
            speeds = np.array(speeds)
            non_zero = speeds[speeds > 0]
            print(f"File: {name}")
            print(f"  Layer: {layer}, Total valid: {len(speeds)}, Non-zero: {len(non_zero)}")
            if len(non_zero) > 0:
                print(f"  Non-zero speeds: min={non_zero.min():.4f}, max={non_zero.max():.4f}, mean={non_zero.mean():.4f}")
            else:
                print(f"  All zero speed vectors")
        else:
            print(f"File: {name} - No valid speeds found")
