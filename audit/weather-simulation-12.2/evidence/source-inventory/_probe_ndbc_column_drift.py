"""READ-ONLY PROBE (audit 12.2). Does an upstream NDBC realtime2 column insertion get
caught, or silently reassign every quantity? Imports production code, mutates NOTHING."""
import sys, os
sys.path.insert(0, os.path.join(os.getcwd(), "backend"))
from services.weather_pipeline import buoy_calibration as bc

HDR1 = "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE"
HDR2 = "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft"
ROW  = "2026 08 13 12 50  270  6.0 8.0  1.50  12.0   7.0 285 1015.0  22.0  24.0  18.0 10.0 +0.1    MM"
CUR = HDR1 + "\n" + HDR2 + "\n" + ROW

print("[A] CURRENT LAYOUT (control)")
print("   ", bc.parse_ndbc_realtime(CUR))

# UPSTREAM INSERTS ONE COLUMN before WDIR (e.g. a new 'SEC' seconds field). Header updated
# by NOAA, as it would be. len(parts) GROWS, so the only structural check passes.
HDR1_M = "#YY  MM DD hh mm SEC WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE"
ROW_M  = "2026 08 13 12 50   30  270  6.0 8.0  1.50  12.0   7.0 285 1015.0  22.0  24.0  18.0 10.0 +0.1    MM"
MUT = HDR1_M + "\n" + HDR2 + "\n" + ROW_M
print("[B] ONE COLUMN INSERTED (header UPDATED upstream, as NOAA would)")
print("    len(parts) =", len(ROW_M.split()), "vs _COL['MWD'] =", bc._COL["MWD"], "-> length check PASSES")
print("   ", bc.parse_ndbc_realtime(MUT))
print("    wind:", bc.parse_ndbc_wind(MUT, now=__import__('datetime').datetime(2026,8,13,13,0,tzinfo=__import__('datetime').timezone.utc)))

# CONTROL: the SAME class of change against the header-driven sibling parser in the same file.
LO_HDR = "#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE"
LO_ROW = "41009    28.508  -80.185 2026 08 13 12 50  270  6.0   8.0  1.5 12.0 7.0 285 1015.0  +0.1  22.0  24.0  18.0 10.0    MM"
print("[C] POSITIVE CONTROL - parse_station_coords (header-driven), same file, same class of change")
print("    intact  ->", bc.parse_station_coords(LO_HDR + "\n" + LO_ROW))
print("    LAT renamed ->", bc.parse_station_coords(LO_HDR.replace("LAT", "LATITUDE") + "\n" + LO_ROW))
