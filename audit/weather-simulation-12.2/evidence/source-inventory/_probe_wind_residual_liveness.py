"""READ-ONLY PROBE: does the PRODUCTION fetch path ever produce the key compare_wind_to_model needs?"""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.getcwd(), "backend"))
from services.weather_pipeline import buoy_calibration as bc
from datetime import datetime, timezone
now = datetime.now(timezone.utc)
stamp = f"{now.year} {now.month:02d} {now.day:02d} {now.hour:02d} {now.minute:02d}"
PAYLOAD = ("#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE\n"
           "#yr mo dy hr mn degT m/s m/s m sec sec degT hPa degC degC degC nmi hPa ft\n"
           f"{stamp} 300 6.2 8.0 1.5 10 8.0 290 1015.0 22.0 21.0 18.0 99 +0.0 0.0\n")

class R:  # what fetch_ndbc_latest sees from httpx
    status_code = 200; text = PAYLOAD
class C:
    async def get(self, url): return R()

obs = asyncio.run(bc.fetch_ndbc_latest("46012", client=C()))
print("production fetch_ndbc_latest ->", obs)
print("has 'wspd_kt'? ->", "wspd_kt" in (obs or {}))
print("compare_wind_to_model(obs, 14.6, 310) ->", bc.compare_wind_to_model(obs, 14.6, 310.0))
