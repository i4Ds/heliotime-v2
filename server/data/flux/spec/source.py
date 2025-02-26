from datetime import timedelta
from enum import Enum


class _Resolution(Enum):
    # Add R_ prefix because identifiers cannot start with a number
    R_10S = '10s', timedelta(seconds=10)
    R_1M = '1m', timedelta(minutes=1)
    R_10M = '10m', timedelta(minutes=10)
    R_1H = '1h', timedelta(hours=1)
    R_12H = '12h', timedelta(hours=12)
    R_5D = '5d', timedelta(days=5)

    suffix: str
    size: timedelta

    def __init__(self, name: str, size: timedelta):
        self.suffix = '_' + name
        self.size = size


class FluxSource(Enum):
    """
    Source from which data was retrieved form:
    - Archive has the highest resolution but lags by a few days.
    - Live has a lower resolution but is up to date.
    """
    ARCHIVE = (
        'flux_archive',
        timedelta(seconds=1),
        (_Resolution.R_10S,
         _Resolution.R_1M,
         _Resolution.R_10M,
         _Resolution.R_1H,
         _Resolution.R_12H,
         _Resolution.R_5D)
    )
    LIVE = (
        'flux_live',
        timedelta(minutes=1),
        (_Resolution.R_10M,
         _Resolution.R_1H,
         _Resolution.R_12H,
         _Resolution.R_5D)
    )

    table_name: str
    raw_resolution: timedelta
    resolutions: tuple[_Resolution, ...]

    def __init__(
            self,
            table_name: str,
            raw_resolution: timedelta,
            resolutions: tuple[_Resolution, ...],
    ):
        self.table_name = table_name
        self.raw_resolution = raw_resolution
        self.resolutions = resolutions

    def select_relation(self, interval: timedelta) -> str:
        for resolution in reversed(self.resolutions):
            if interval >= resolution.size:
                return self.table_name + resolution.suffix
        return self.table_name
