from dataclasses import dataclass
from enum import Enum

from asyncpg import Connection

SATELLITE_COMBINED_ID = 0


class FrequencyBand(Enum):
    """
    SHORT: 0.5 - 4.0 Å
    LONG: 1.0 - 8.0 Å
    """
    SHORT = 'short'
    LONG = 'long'

    @classmethod
    async def register_codec(cls, connection: Connection):
        await connection.set_type_codec(
            'frequency_band',
            encoder=lambda c: c.value.encode(),
            decoder=lambda v: cls(str(v).upper()),
            schema='public',
            format='binary'
        )


@dataclass(frozen=True)
class FluxChannel:
    """
    Version of the recorded data. Defined by:
    - Which satellite recorded it (or the combined consensus from all).
    - The frequency band that was recorded.
    - Whether the data was post-processed to clean it.
    """
    satellite: int
    band: FrequencyBand
    is_clean: bool
