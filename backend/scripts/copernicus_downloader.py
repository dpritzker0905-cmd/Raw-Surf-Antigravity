import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

def download():
    username = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    password = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not username or not password:
        print("Error: Credentials missing.")
        sys.exit(1)
        
    dataset_id = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    variables = ["VHM0_SW1", "VMDR_SW1", "VTM01_SW1", "VHM0"]
    
    # Florida East Coast bounding box
    west, south, east, north = -85.0, 24.0, -79.0, 31.0
    
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=3)
    
    if len(sys.argv) < 3:
        print("Error: Missing output directory and output filename arguments.")
        sys.exit(1)
        
    output_dir = sys.argv[1]
    output_file = sys.argv[2]
    
    # Set credentials directory to output directory to avoid permission issues
    os.environ["COPERNICUSMARINE_CREDENTIALS_DIRECTORY"] = output_dir
    
    import copernicusmarine
    print(f"Downloading Copernicus subset to {output_dir}/{output_file}...")
    try:
        copernicusmarine.subset(
            dataset_id=dataset_id,
            variables=variables,
            minimum_longitude=west,
            maximum_longitude=east,
            minimum_latitude=south,
            maximum_latitude=north,
            start_datetime=start_time.strftime("%Y-%m-%dT%H:%M:%S"),
            end_datetime=end_time.strftime("%Y-%m-%dT%H:%M:%S"),
            output_directory=output_dir,
            output_filename=output_file,
            username=username,
            password=password
        )
        print("Download completed successfully.")
    except Exception as e:
        print(f"Download failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    download()
