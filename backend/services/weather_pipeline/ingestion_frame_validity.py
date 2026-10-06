"""Dark WI-05 write guard; invalid data must not replace a good stored forecast frame."""
import math
import os


def grid_frame_save_allowed(product):
    if os.environ.get('INGEST_REJECT_INVALID_FRAMES', '0') != '1':
        return True  # Legacy path, without any cell scan.
    grid = getattr(product, 'grid', None)
    marine = str(getattr(product, 'domain', '')).lower() == 'marine'
    for cell in getattr(grid, 'vectors', None) or ():
        if getattr(cell, 'is_valid', False) is not True:
            continue
        speed = getattr(cell, 'speed', None)
        if not isinstance(speed, (int, float)) or not math.isfinite(speed) or (marine and speed < 0):
            continue
        value = getattr(cell, 'value', None)
        if value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value)):
            continue
        return True  # A measured zero or a partial grid with one genuine cell is usable.
    return False
