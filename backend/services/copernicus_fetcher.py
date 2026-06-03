import sys
import json

def main():
    if len(sys.argv) < 2:
        print("ERROR: Missing payload argument")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
        dataset_id = args["dataset_id"]
        variables = args["variables"]
        minimum_longitude = args["minimum_longitude"]
        maximum_longitude = args["maximum_longitude"]
        minimum_latitude = args["minimum_latitude"]
        maximum_latitude = args["maximum_latitude"]
        start_datetime = args["start_datetime"]
        end_datetime = args["end_datetime"]
        output_directory = args["output_directory"]
        output_filename = args["output_filename"]
        username = args["username"]
        password = args["password"]
    except Exception as e:
        print(f"ERROR: Failed to parse payload: {e}")
        sys.exit(1)

    try:
        import copernicusmarine
        try:
            import dask
            dask.config.set(scheduler='single-threaded')
        except ImportError:
            pass
        import gc
        gc.collect()
        copernicusmarine.subset(
            dataset_id=dataset_id,
            variables=variables,
            minimum_longitude=minimum_longitude,
            maximum_longitude=maximum_longitude,
            minimum_latitude=minimum_latitude,
            maximum_latitude=maximum_latitude,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            output_directory=output_directory,
            output_filename=output_filename,
            username=username,
            password=password,
            force_download=True
        )
        print("SUCCESS")
    except Exception as e:
        print(f"ERROR: Ingestion subset failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
