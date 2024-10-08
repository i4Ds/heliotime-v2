from typing import Iterable

import numpy as np
import pandas as pd

Flux = pd.Series
# Used for queries directly returned in an API request
RawFlux = Iterable[tuple[int, float]]

FLUX_INDEX_NAME = 'time'
FLUX_VALUE_NAME = 'flux'


def empty_flux() -> Flux:
    """
    Creates an empty flux dataframe with correct form.
    """
    return pd.Series(
        name=FLUX_VALUE_NAME,
        dtype=np.float64,
        index=pd.DatetimeIndex((), name=FLUX_INDEX_NAME),
    )
