"""Nearshore validation harness: stations, pairs, beach points, splits. OFFLINE ONLY: reads public buoy archives,
never the Raw Surf backend, and changes no served number.

Truth hierarchy (do not mix them up):
  1. buoy-to-buoy TRANSFER (offshore 41009 -> nearshore CDIP buoy) is MEASURED truth for how much wave energy reaches
     ~10-16 m depth, by direction and period;
  2. surf FACE height at the beach has no instrument here: the observation log (observations.csv) is the only truth for
     the breaking step, and it is sparse (n is printed with every number);
  3. reference breaking formulas are NOT truth; they are labelled "reference" wherever they appear.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'
OUT = HERE / 'out'

# Offshore reference (NDBC, its own spectral files) and nearshore truth (CDIP archive; NDBC rebroadcasts it as 411xx).
STATIONS = {
    '41009': dict(source='ndbc', name='Canaveral 20 nm E (offshore)', lat=28.508, lon=-80.185, role='offshore'),
    '143': dict(source='cdip', ndbc='41113', name='Cape Canaveral Nearshore (shadow side)', lat=28.398, lon=-80.535,
                role='nearshore'),
    '134': dict(source='cdip', ndbc='41114', name='Fort Pierce (open-coast control)', lat=27.549, lon=-80.227,
                role='nearshore'),
}

PAIRS = [
    dict(offshore='41009', nearshore='143', label='Cape Canaveral nearshore vs offshore (cape/shoal shadow)'),
    dict(offshore='41009', nearshore='134', label='Fort Pierce vs offshore (open-coast control)'),
]

# Beach points the chain is evaluated at, attached to the nearshore buoy whose waves reach them.
BEACHES = {
    '143': [('Jetty Park / Port Canaveral', 28.4061, -80.589), ('Cocoa Beach Pier', 28.3655, -80.5995)],
    '134': [('North Hutchinson Island', 27.549, -80.325)],
}

# Splits: explore on 2023-2024, judge on the HOLD-OUT (2025 and the 2026 realtime window). Never tune on the hold-out.
EXPLORE_YEARS = (2023, 2024)
HOLDOUT_YEARS = (2025, 2026)
NDBC_YEARS = (2023, 2024, 2025)          # 41009 yearly spectral files; 2026 comes from realtime2

PAIR_TOLERANCE_MIN = 20                  # offshore and nearshore records within this many minutes
LAG_MIN = 30                             # nearshore record compared with the offshore one this much EARLIER
                                         # (~35 km at shelf group speeds ~15-20 m/s for 10-13 s swell)
MIN_OFFSHORE_HS = 0.3                    # m: below this, ratios are noise
DIR_BIN_DEG = 22.5
PERIOD_BANDS = [(0, 8), (8, 10), (10, 12), (12, 30)]
NDIR = 72                                # 5-degree MEM directional bins

COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
