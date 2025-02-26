from typing import Iterable

import numpy as np
import pandas as pd

# Columns: time, flux
Flux = pd.Series
# Used for queries directly returned in an API request
RawFlux = Iterable[tuple[int, float]]

# TODO: actually use AggregatedFlux in the code
# Columns: time, flux_min, flux_max, count
AggregatedFlux = pd.DataFrame

FLUX_INDEX_NAME = 'time'
FLUX_VALUE_NAME = 'flux'
FLUX_MIN_NAME = 'flux_min'
FLUX_MAX_NAME = 'flux_max'
FLUX_COUNT_NAME = 'count'


def empty_flux() -> Flux:
    """
    Creates an empty flux series with the correct column names and types.
    """
    return pd.Series(
        name=FLUX_VALUE_NAME,
        dtype=np.float32,
        index=pd.DatetimeIndex((), name=FLUX_INDEX_NAME),
    )


def empty_aggregated_flux() -> AggregatedFlux:
    """
    Creates an empty aggregated flux dataframe with the correct column names and types.
    """
    return pd.DataFrame(
        index=pd.DatetimeIndex((), name=FLUX_INDEX_NAME),
        columns=(
            pd.Series(name=FLUX_MIN_NAME, dtype=np.float32),
            pd.Series(name=FLUX_MAX_NAME, dtype=np.float32),
            pd.Series(name=FLUX_COUNT_NAME, dtype=np.int32),
        )
    )
