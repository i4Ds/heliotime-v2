from datetime import timedelta
from enum import Enum

# Amount of time subtracted form the auto refresh horizon to account for timing inaccuracies
AUTO_REFRESH_SLACK = timedelta(minutes=2)


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
    ARCHIVE = (
        'flux_archive',
        timedelta(seconds=1),
        {res: timedelta() for res in (
            _Resolution.R_10S,
            _Resolution.R_1M,
            _Resolution.R_10M,
            _Resolution.R_1H,
            _Resolution.R_12H,
            _Resolution.R_5D,
        )}
    )
    LIVE = (
        'flux_live',
        timedelta(minutes=1),
        {
            _Resolution.R_10M: timedelta(days=8),
            _Resolution.R_1H: timedelta(days=8),
            _Resolution.R_12H: timedelta(days=8),
            _Resolution.R_5D: timedelta(days=15),
        }
    )

    table_name: str
    raw_resolution: timedelta
    auto_refresh_horizons: dict[_Resolution, timedelta]

    def __init__(
            self,
            table_name: str,
            raw_resolution: timedelta,
            auto_refresh_horizons: dict[_Resolution, timedelta]
    ):
        """
        :param auto_refresh_horizons: How far back the resolutions get auto-refreshed.
             Must be ordered form smallest to biggest resolution.
        """
        self.table_name = table_name
        self.raw_resolution = raw_resolution
        self.auto_refresh_horizons = auto_refresh_horizons

    def select_relation(self, interval: timedelta) -> str:
        for resolution in reversed(self.auto_refresh_horizons):
            if interval >= resolution.size:
                return self.table_name + resolution.suffix
        return self.table_name
