import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

def download_and_parse():
    if len(sys.argv) < 3:
        print("Error: Missing input and output JSON file arguments.")
        sys.exit(1)
        
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    
    with open(input_path, "r") as f:
        req = json.load(f)
        
    latitudes = req["latitudes"]
    longitudes = req["longitudes"]
    forecast_days = req["forecast_days"]
    variables = req.get("variables")
    
    username = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    password = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not username or not password:
        print("Error: Credentials missing.")
        sys.exit(1)
        
    dataset_id = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    
    # Compute bounding box
    if len(latitudes) <= 2:
        lat_min = min(latitudes) - 0.15
        lat_max = max(latitudes) + 0.15
        lon_min = min(longitudes) - 0.15
        lon_max = max(longitudes) + 0.15
    else:
        lat_min = min(latitudes) - 0.05
        lat_max = max(latitudes) + 0.05
        lon_min = min(longitudes) - 0.05
        lon_max = max(longitudes) + 0.05

    lat_min = max(-90, lat_min)
    lat_max = min(90, lat_max)
    lon_min = max(-180, lon_min)
    lon_max = min(180, lon_max)

    forecast_days = min(forecast_days, 3)

    # CMEMS VARIABLE MAP (open-meteo to copernicus mapping)
    VARIABLE_MAP = [
        ("VHM0",     "wave_height",                    "m"),
        ("VMDR",     "wave_direction",                  "°"),
        ("VTM10",    "wave_period",                     "s"),
        ("VHM0_SW1", "swell_wave_height",              "m"),
        ("VMDR_SW1", "swell_wave_direction",            "°"),
        ("VTM01_SW1","swell_wave_period",               "s"),
        ("VHM0_SW2", "secondary_swell_wave_height",     "m"),
        ("VMDR_SW2", "secondary_swell_wave_direction",  "°"),
        ("VTM01_SW2","secondary_swell_wave_period",     "s"),
        ("VHM0_WW",  "wind_wave_height",                "m"),
        ("VMDR_WW",  "wind_wave_direction",             "°"),
        ("VTM01_WW", "wind_wave_period",                "s"),
    ]
    COPERNICUS_VARS = [v[0] for v in VARIABLE_MAP]
    
    OM_TO_COPERNICUS = {v[1]: v[0] for v in VARIABLE_MAP}
    if variables and len(variables) > 0:
        requested_cop_vars = []
        for om_var in variables:
            if om_var in OM_TO_COPERNICUS:
                requested_cop_vars.append(OM_TO_COPERNICUS[om_var])
        fetch_vars = requested_cop_vars if requested_cop_vars else COPERNICUS_VARS
    else:
        fetch_vars = COPERNICUS_VARS

    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=forecast_days)
    
    import tempfile
    fd, temp_path_str = tempfile.mkstemp(suffix=".nc", prefix="cmems_subset_")
    os.close(fd)
    temp_file = Path(temp_path_str)
    
    # Set credentials directory to temp directory
    os.environ["COPERNICUSMARINE_CREDENTIALS_DIRECTORY"] = str(temp_file.parent)
    
    import copernicusmarine
    # Delete the pre-created 0-byte temp file placeholder so copernicusmarine.subset can download and write to the path successfully
    if temp_file.exists():
        temp_file.unlink()
        
    print(f"Downloading subset to {temp_file}...")
    try:
        copernicusmarine.subset(
            dataset_id=dataset_id,
            variables=fetch_vars,
            minimum_longitude=lon_min,
            maximum_longitude=lon_max,
            minimum_latitude=lat_min,
            maximum_latitude=lat_max,
            start_datetime=start_time.strftime("%Y-%m-%dT%H:%M:%S"),
            end_datetime=end_time.strftime("%Y-%m-%dT%H:%M:%S"),
            output_directory=str(temp_file.parent),
            output_filename=temp_file.name,
            username=username,
            password=password
        )
        print("Download completed successfully.")
        
        # Import scientific libraries in the subprocess
        import netCDF4
        import numpy as np
        
        print("Parsing downloaded NetCDF file using netCDF4...")
        nc = netCDF4.Dataset(temp_file, "r")
        
        lats = nc.variables["latitude"][:]
        lons = nc.variables["longitude"][:]
        time_var = nc.variables["time"]
        times_raw = time_var[:]
        
        # Convert times to string dates
        times_parsed = netCDF4.num2date(times_raw, units=time_var.units)
        times = [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times_parsed]
        
        results = []
        for i in range(len(latitudes)):
            lat_val = latitudes[i]
            lon_val = longitudes[i]
            try:
                lat_idx = np.abs(lats - lat_val).argmin()
                lon_idx = np.abs(lons - lon_val).argmin()
                
                snapped_lat = float(lats[lat_idx])
                snapped_lon = float(lons[lon_idx])
                
                hourly = {"time": times}
                hourly_units = {"time": "iso8601"}
                
                for cop_var, om_var, unit in VARIABLE_MAP:
                    if cop_var in nc.variables:
                        vals = nc.variables[cop_var][:, lat_idx, lon_idx]
                        hourly[om_var] = [
                            round(float(v), 4) if not np.ma.is_masked(v) and not np.isnan(v) else None
                            for v in vals
                        ]
                    else:
                        hourly[om_var] = [None] * len(times)
                    hourly_units[om_var] = unit
                    
                results.append({
                    "latitude": snapped_lat,
                    "longitude": snapped_lon,
                    "generationtime_ms": 0,
                    "utc_offset_seconds": 0,
                    "timezone": "GMT",
                    "timezone_abbreviation": "GMT",
                    "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": hourly_units,
                    "hourly": hourly,
                })
            except Exception as pe:
                print(f"Point {lat_val},{lon_val} parse error: {pe}")
                results.append({
                    "latitude": lat_val,
                    "longitude": lon_val,
                    "generationtime_ms": 0,
                    "utc_offset_seconds": 0,
                    "timezone": "GMT",
                    "timezone_abbreviation": "GMT",
                    "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": {"time": "iso8601"},
                    "hourly": {"time": []},
                })
                
        # Close NetCDF file
        nc.close()
        
        # Save output to response path
        with open(output_path, "w") as out_f:
            json.dump(results, out_f)
        print("Response JSON written successfully.")
        
    except Exception as e:
        print(f"Failed: {e}")
        sys.exit(1)
    finally:
        if temp_file and temp_file.exists():
            try: temp_file.unlink()
            except Exception: pass

if __name__ == "__main__":
    download_and_parse()
