"""Narrow subprocess protocol for dataset-wide temporal unavailability."""
import re

TIME_UNAVAILABLE_EXIT = 65
TIME_UNAVAILABLE_MARKER = 'ERROR_CODE:COPERNICUS_TIME_UNAVAILABLE'


class CopernicusTimeUnavailable(RuntimeError):
    """The requested time is outside this dataset, independently of spatial tile."""


def temporal_bounds_error(error):
    # The SDK uses one bounds exception for longitude, latitude, depth AND time.
    # Only its explicit time dimension is dataset-wide. Never classify generic outages.
    return (type(error).__name__ == 'CoordinatesOutOfDatasetBounds'
            and bool(re.search(r'\btime\s+dimension\b|\(time\s*[<>]', str(error), re.I)))


def subprocess_time_unavailable(result):
    return (result.returncode == TIME_UNAVAILABLE_EXIT
            and TIME_UNAVAILABLE_MARKER in (result.stdout or '').splitlines())
