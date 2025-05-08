from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta, datetime
from functools import cached_property
from typing import Sequence


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

    @classmethod
    def which_includes(cls, ranges: Sequence[DateTimeRange]) -> DateTimeRange:
        """
        Creates a new DateTimeRange that is inclusive of the provided ranges.
        """
        if not ranges:
            raise ValueError("No ranges provided")
        return cls(
            min(r.start for r in ranges),
            max(r.end for r in ranges)
        )

    def extend(self, delta: timedelta) -> DateTimeRange:
        return DateTimeRange(self.start - delta, self.end + delta)

    def __contains__(self, item: datetime) -> bool:
        return self.start <= item < self.end

    def __str__(self):
        return f'{self.start} - {self.end}'
