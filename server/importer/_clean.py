from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import timedelta, datetime
from functools import cached_property
from typing import cast, Optional, Sequence

import numpy as np
import pandas as pd

from data.flux.spec.data import empty_flux, Flux


def _change_speed(series: pd.Series, periods=1) -> pd.Series:
    """
    series.diff() for timeseries.

    :return: Difference to last value divided by seconds elapsed.
    """
    return series.diff(periods) / series.index.diff(periods).total_seconds()


def _pick_abs_max(series_a: pd.Series, series_b: pd.Series) -> pd.Series:
    return pd.concat((
        series_b.abs(),
        series_a.abs(),
    ), axis=1).max(axis=1)


def _has_previous_bool_changed(series: pd.Series) -> pd.Series:
    """
    Marks the edges where the boolean series changes.
    """
    if len(series) == 0:
        return series & 0
    return series ^ series.shift(fill_value=series.iloc[0])


# Centered window size used for smoothing noisy measurements.
_SMOOTHING_WINDOW = timedelta(minutes=5)
# Centered windows size of how long the shortest flare would be.
_SUSTAINED_MOTION_WINDOW = timedelta(seconds=40)


def _denoise(log_flux: pd.Series) -> pd.Series:
    # Smooth out possible noise while keeping any actual motion.
    # Used to detect certain regions later.
    sustained = log_flux.rolling(_SUSTAINED_MOTION_WINDOW, center=True).mean()

    # Mask already smooth parts
    is_rough = (sustained - log_flux).abs() > 0.004
    is_slightly_rough = (sustained - log_flux).abs() > 0.0035

    # Mark valid slopes to not smooth out solar flares.
    # If a big change is actually a flare, it will reside for at least a few seconds
    # and the cumulative velocity won't drop as much after smoothing
    # compared to noisy data where values zigzag.
    # Take max as the big velocities are only at the edges of the flare,
    # and we don't want to smooth the tops.
    rough_velocity_max = _change_speed(log_flux).abs() \
        .rolling(_SUSTAINED_MOTION_WINDOW, center=True).sum() \
        .rolling(_SMOOTHING_WINDOW, center=True).max()
    sustained_velocity_max = _change_speed(sustained).abs() \
        .rolling(_SUSTAINED_MOTION_WINDOW, center=True).sum() \
        .rolling(_SMOOTHING_WINDOW, center=True).max()
    is_valid_slope = (sustained_velocity_max / rough_velocity_max) > 0.45

    # If 20% nearby is rough, smooth also this point.
    is_rough_nearby = (is_rough.rolling(_SMOOTHING_WINDOW, center=True).mean() / 0.2).clip(upper=1)
    is_slightly_rough_nearby = (is_slightly_rough.rolling(_SMOOTHING_WINDOW, center=True).mean() / 0.2).clip(upper=1)
    # Strong smoothing where there is no valid slope, and it's rough nearby.
    smooth_force = pd.concat((1 - is_valid_slope, is_rough_nearby), axis=1).min(axis=1)
    # Small smoothing where it's slightly rough, and it's not already strongly smoothed.
    detail_smooth_force = (is_slightly_rough_nearby - smooth_force).clip(lower=0)

    # Smooth out forces to not create hard edges
    smooth_force = smooth_force.rolling(_SUSTAINED_MOTION_WINDOW, center=True).mean()
    detail_smooth_force = detail_smooth_force.rolling(_SUSTAINED_MOTION_WINDOW, center=True).mean()

    # Calculate smoothing corrections
    smooth = log_flux.rolling(_SMOOTHING_WINDOW, center=True).mean()
    detail_corrections = (sustained - log_flux) * detail_smooth_force
    corrections = (smooth - log_flux) * smooth_force + detail_corrections.clip(upper=0.1, lower=-0.1)

    # Clip corrections as excessive corrections only smooth out
    # outlier spikes making them harder to detect later.
    max_correction = np.nanpercentile(corrections, 99)
    min_correction = np.nanpercentile(corrections, 1)
    corrections = corrections.clip(
        upper=min(max_correction + 0.1, 0.8),
        lower=max(min_correction - 0.1, -0.8)
    )

    # Apply corrections
    return log_flux + corrections


def _filter_impossible_dips(log_groups: Sequence[pd.Series]) -> Sequence[pd.Series]:
    """
    The flux only ever spikes up with solar flares, meaning we can remove any negative dips.
    """
    log_flux = pd.concat(log_groups)
    log_narrow_min = log_flux.rolling(timedelta(minutes=30), center=True).min()
    log_wide_min = log_narrow_min.rolling(timedelta(minutes=30), center=True).min()
    # Calculate the "bottom" of the signal without the dips.
    log_base = pd.concat((
        log_narrow_min.rolling(timedelta(hours=4), center=True).median(),
        log_wide_min.rolling(timedelta(hours=16), center=True).median(),
    ), axis=1).min(axis=1)
    filtered_log_groups = deque()
    for log_group in log_groups:
        flat_group = log_group - log_base
        if flat_group.min() < -0.2:
            # Only cut of dip parts in case the group also contains valid parts.
            log_group = log_group[flat_group > -0.05]
            # If the group was only the drip, drop it.
            if len(log_group) < 10:
                continue
        filtered_log_groups.append(log_group)
    return filtered_log_groups


_CONNECTIVITY_SAMPLE_SIZE = timedelta(minutes=1)


def _check_group_connectivity(
        log_groups: Sequence[pd.Series],
        sample_count: int,
        is_forward: bool
) -> tuple[set[int], deque[tuple[datetime, datetime, float]]]:
    """
    Will check the groups for connectivity and output potential outliers and uncertainty sections.
    Connected groups start and end at a similar value, creating a smooth transition.
    Uncertainty sections are groups that are too far time-wise from
    the previous group to make a reasonable connectivity check.

    :param log_groups: Groups to check.
    :param sample_count: Number of measurements required for calculating a reference.
    :param is_forward: If connectivity is checked in the forward direction.
    :return: Tuple of:
        - Object IDs of the outlier groups
        - Ordered list of uncertainty sections (start, end, reference).
          Reference in forward direction is the start of the section and in backward direction the end.
    """
    outliers = set()
    sections = deque[tuple[datetime, datetime, float]]()
    # Start of uncertainty section (in direction of iteration)
    section_start: datetime | None = None
    section_reference: float | None = None
    log_groups_iter = iter(log_groups if is_forward else reversed(log_groups))

    def limit_sample(raw_sample: pd.Series):
        """Cut old part of the sample if it's too big."""
        return (
            raw_sample.iloc[-sample_count:]
            if is_forward else
            raw_sample.iloc[:sample_count]
        )

    # Fill up the initial sample
    initial_sample_groups = deque()
    initial_sample_size = 0
    for log_group in log_groups_iter:
        if is_forward:
            initial_sample_groups.append(log_group)
        else:
            initial_sample_groups.appendleft(log_group)
        initial_sample_size += len(log_group)
        if initial_sample_size >= sample_count:
            break
    sample = limit_sample(cast(pd.Series, pd.concat(initial_sample_groups)))

    # Check connectivity on the rest of the groups
    for log_group in log_groups_iter:
        sample_median = sample.median()
        sample_range = (sample.index[-1] - sample.index[0]).total_seconds()
        sample_age = (
            log_group.index[0] - sample.index[-1]
            if is_forward else
            sample.index[0] - log_group.index[-1]
        ).total_seconds()

        # Delta to sampled reference
        delta = log_group.iloc[0 if is_forward else -1] - sample_median
        # Allowed delta based on range and age.
        # Creates a cone shape where the allowed delta is bigger for older samples.
        allowed_delta = 0.001 * sample_range + 0.03 * sample_age
        if allowed_delta < abs(delta):
            outliers.add(id(log_group))
            # Do not use outliers as reference
            continue

        # Maybe start uncertainty section
        just_opened = False
        if section_start is None and allowed_delta > 2:
            # Pick the farthest end of sample as start
            # as borders of gaps tend to also be outliers.
            section_start = sample.index[0 if is_forward else -1]
            # Use existing sample as reference.
            # Forward will provide the start and backward the end reference.
            section_reference = sample_median
            just_opened = True
        # Maybe close uncertainty section
        if section_start is not None:
            section_end = None
            # If group is big enough to end the gap. Assumed to be no outlier so use the closest point.
            if len(log_group) > sample_count * 5:
                section_end = log_group.index[0 if is_forward else -1]
            # If the sample has passed the gap. Used groups might be outliers so use the farthest point.
            elif not just_opened and sample_range < _CONNECTIVITY_SAMPLE_SIZE.total_seconds() * 1.5:
                section_end = sample.index[-1 if is_forward else 0]

            # If section was closed validly, add it to the result.
            if section_end is not None and (
                    section_start < section_end if is_forward else section_end < section_start
            ):
                if is_forward:
                    sections.append((section_start, section_end, section_reference))
                else:
                    sections.appendleft((section_end, section_start, section_reference))
                section_start = None
                section_reference = None

        # Update sample
        sample = limit_sample(cast(pd.Series, pd.concat(
            (sample, log_group)
            if is_forward else
            (log_group, sample)
        )))

    # Merge overlapping sections
    if len(sections) > 0:
        sections_iter = iter(sections)
        merged_sections = deque()
        open_section = next(sections_iter)
        for section in sections_iter:
            # If not overlapping
            if open_section[1] < section[0]:
                merged_sections.append(open_section)
                open_section = section
                continue
            # Merge overlapping sections
            reference = (open_section[2] if open_section[0] < section[0] else section[2]) \
                if is_forward else \
                (open_section[2] if section[1] < open_section[1] else section[2])
            open_section = (
                min(open_section[0], section[0]),
                max(open_section[1], section[1]),
                reference
            )
        merged_sections.append(open_section)
        sections = merged_sections

    return outliers, sections


@dataclass(frozen=True)
class _UncertainSection:
    """
    Represents a section where the connectivity is uncertain.
    Groups in this section will be filtered based on a linear interpolation between the neighboring certain sections.
    """
    time: tuple[datetime, datetime]
    reference: tuple[float, float]

    @cached_property
    def slope(self) -> float:
        return (self.reference[1] - self.reference[0]) / (self.time[1] - self.time[0]).total_seconds()

    def interpolate(self, time: datetime) -> float:
        return self.reference[0] + self.slope * (time - self.time[0]).total_seconds()

    def resize(self, start: datetime, end: datetime) -> _UncertainSection:
        """Resize the section and recalculates the reference."""
        return _UncertainSection(
            (start, end),
            (self.interpolate(start), self.interpolate(end))
        )

    def is_before(self, group: pd.Series) -> bool:
        return self.time[1] < group.index[-1]

    def includes(self, group: pd.Series) -> bool:
        return self.time[0] <= group.index[0] and self.time[1] >= group.index[-1]

    def is_outlier(self, group: pd.Series, check_index: int) -> bool:
        delta = group.iloc[check_index] - self.interpolate(group.index[check_index])
        return abs(delta) > 0.2


def _filter_by_connectivity(log_groups: Sequence[pd.Series], median_interval: timedelta) -> Sequence[pd.Series]:
    """
    Filter outliers by checking connectivity (if end and start of groups match up)
    """
    if len(log_groups) == 1:
        # Checking connectivity on a single group doesn't make sense.
        return log_groups
    # Number of measurements required for calculating a reference.
    sample_count = int(np.ceil(_CONNECTIVITY_SAMPLE_SIZE / median_interval))
    # Check connectivity in both directions
    forward_outliers, forward_sections = _check_group_connectivity(
        log_groups, sample_count, True
    )
    backward_outliers, backward_sections = _check_group_connectivity(
        log_groups, sample_count, False
    )

    # Intersect uncertain sections together
    uncertain_sections = deque[_UncertainSection]()
    while forward_sections and backward_sections:
        start_forward, end_forward, start_reference = forward_sections[0]
        start_backward, end_backward, end_reference = backward_sections[0]
        # Check for overlap
        if start_forward < end_backward and start_backward < end_forward:
            # Calculate the intersection range
            section = _UncertainSection(
                (start_forward, end_backward),
                (start_reference, end_reference)
            ).resize(
                max(start_forward, start_backward),
                min(end_forward, end_backward)
            )
            uncertain_sections.append(section)
        # Remove the range that ends first to move forward
        if end_forward < end_backward:
            forward_sections.popleft()
        else:
            backward_sections.popleft()

    # Filter out the outliers
    filtered_log_groups = deque()
    uncertain_sections_iter = iter(uncertain_sections)
    section = next(uncertain_sections_iter, None)
    for log_group in log_groups:
        # Check if in both outlier sets
        group_id = id(log_group)
        if group_id in forward_outliers and group_id in backward_outliers:
            continue

        # Check if in an uncertainty section
        if section is not None and section.is_before(log_group):
            section = next((
                s for s in uncertain_sections_iter
                if not s.is_before(log_group)
            ), None)
        if section is not None and section.includes(log_group) and (
                section.is_outlier(log_group, log_group.argmin()) or
                section.is_outlier(log_group, log_group.argmax())
        ):
            continue
        filtered_log_groups.append(log_group)

    return filtered_log_groups


_UPPER_VALUE_BORDER = -3
_LOWER_VALUE_BORDER = -8
_VALUE_BORDER_SLACK = 0.1


def _remove_outliers(log_flux: pd.Series, is_live: bool) -> Optional[pd.Series]:
    # Calculate flux value acceleration (speed of change)
    forward_velocity = _change_speed(log_flux)
    forward_acceleration = _change_speed(forward_velocity)
    backward_velocity = _change_speed(log_flux, -1)
    backward_acceleration = _change_speed(backward_velocity, -1)

    # Merge backwards and forwards directions.
    # It is computed both ways because the measurements are not evenly distributed,
    # so outliers immediately after a gap would be missed by the forward pass
    # because the big value jump is damped by a big time gap.
    abs_velocity = _pick_abs_max(backward_velocity, forward_velocity)
    abs_acceleration = _pick_abs_max(backward_acceleration, forward_acceleration)

    # Determine data frequency of the majority.
    # Cannot be assumed to be constant as the source might change each day.
    time_delta = cast(pd.Series, log_flux).index.diff()
    median_interval = time_delta.median()

    # Mark clipped values at the value borders
    log_max = log_flux.max()
    log_min = log_flux.min()
    is_near_upper_border = 0 if log_max <= _UPPER_VALUE_BORDER - _VALUE_BORDER_SLACK else \
        log_flux > max(log_max, _UPPER_VALUE_BORDER) - _VALUE_BORDER_SLACK
    is_near_lower_border = 0 if log_min >= _LOWER_VALUE_BORDER + _VALUE_BORDER_SLACK else \
        log_flux < min(log_min, _LOWER_VALUE_BORDER) + _VALUE_BORDER_SLACK
    if not isinstance(is_near_upper_border, int) or not isinstance(is_near_lower_border, int):
        is_clipped_value = (is_near_upper_border | is_near_lower_border) & cast(
            pd.Series, abs_velocity.rolling(median_interval * 30, center=True).median() < 1e-6
        )
        clipped_edge = _has_previous_bool_changed(is_clipped_value)
    else:
        is_clipped_value = clipped_edge = 0

    # Mark measurements with high acceleration.
    has_high_acceleration = cast(pd.Series, abs_acceleration > (0.00002 if is_live else 0.01))
    has_excessive_acceleration = cast(pd.Series, abs_acceleration > (0.00018 if is_live else 0.04))
    # Bridge small gaps in high acceleration regions.
    has_high_acceleration |= has_high_acceleration.rolling(median_interval * 5, center=True).sum() >= 2
    # Mark edges of high acceleration regions for grouping.
    high_acceleration_edge = _has_previous_bool_changed(has_high_acceleration)

    # Mark measurements after a large time gaps.
    # Must be at least 1 minute in case the source fell back to 1-minute averaged interval on a few days.
    is_after_gap = time_delta > max(median_interval * 10, timedelta(minutes=1))

    # Remove outliers and split at marked
    group_id = (clipped_edge | high_acceleration_edge | is_after_gap).cumsum()
    log_groups = log_flux[~(is_clipped_value | has_excessive_acceleration)].groupby(group_id)

    # Filter groups with unnatural velocities
    filtered_log_groups = deque()
    for _, log_group in log_groups:
        group_abs_velocity = abs_velocity.loc[
            # If possible omit the first velocity, as it isn't part of the group
            log_group.index[1:] if len(log_group) > 1 else log_group.index
        ]
        if (
                # Extremely high sustained velocity is probably an outlier
                group_abs_velocity.mean() > 0.01 or
                # Nearly no velocity is probably at artifact or at the value border
                group_abs_velocity.median() < 1e-6
        ):
            continue
        filtered_log_groups.append(log_group)
    log_groups = filtered_log_groups
    if len(log_groups) == 0:
        return None

    # Apply other filters
    log_groups = _filter_impossible_dips(log_groups)
    if len(log_groups) == 0:
        return None
    log_groups = _filter_by_connectivity(log_groups, median_interval)
    if len(log_groups) == 0:
        return None

    # Merge groups together
    return cast(pd.Series, pd.concat(log_groups))


def clean_flux(flux: Flux, is_live: bool) -> Flux:
    """
    Denoises and removes outliers from the provided measured flux.
    Tuned to work on the archive and live data.

    TODO: Consider frequency band (and calibrate for the short band).

    :param flux: Raw flux data.
    :param is_live: If the data is from the live source. (meaning 1-minute averaged)
    """
    if flux.empty:
        return empty_flux()
    # Remove obviously incorrect values
    flux = flux[(0 < flux) & (flux < 1) & ~flux.index.duplicated(keep='first')]
    if flux.empty:
        return empty_flux()
    with np.errstate(invalid='ignore'):
        # Value range is exponential so find outliers with log
        log_flux = np.log10(flux)
    log_flux = _denoise(log_flux)
    log_flux = _remove_outliers(log_flux, is_live)
    if log_flux is None or log_flux.empty:
        return empty_flux()
    # Return to normal distribution
    flux = 10 ** log_flux
    # Remove any potential NANs that got introduced
    return flux.dropna()


# Time range at start and end which will not be properly cleaned
# because there was no bordering data to compare to.
# If the date has a lot of holes this could in theory be beyond 9 hours
# because uncertainty sections might stretch beyond the border.
# TODO: Make border size formally correct, so we can better guarantee clean borders.
CLEAN_BORDER_SIZE = timedelta(hours=9)
