from dataclasses import dataclass
from datetime import timedelta, datetime
from functools import cached_property

from psycopg2._range import DateTimeRange


@dataclass(frozen=True)
class DateTimeRange:
    """
    Represents a range of time with an exclusive end.
    """
    start: datetime
    end: datetime

    @cached_property
    def delta(self) -> timedelta:
        return self.end - self.start

    def extend(self, delta: timedelta) -> DateTimeRange:
        return DateTimeRange(self.start - delta, self.end + delta)

    def __contains__(self, item: datetime) -> bool:
        return self.start <= item < self.end

    def __str__(self):
        return f'{self.start} - {self.end}'
