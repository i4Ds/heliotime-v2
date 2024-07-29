from collections import deque
from datetime import timedelta
from typing import cast, Optional

import numpy as np
import pandas as pd

from data.flux import Flux, empty_flux


def _top_percentile(series: pd.Series, percentage: float) -> float:
    """
    :return: The value at nth percentile of the series. Median would be 0.5.
    """
    if series.empty:
        return np.NAN
    trim_size = round(len(series) * percentage)
    max_partition = np.argpartition(series.to_numpy(), -trim_size)
    return series.iloc[max_partition[-trim_size]]


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


# Centered window size used for smoothing noisy measurements.
SMOOTHING_WINDOW = timedelta(minutes=5)
# Centered windows size of how long the shortest flare would be.
SUSTAINED_MOTION_WINDOW = timedelta(seconds=40)


def _denoise(log_flux: pd.Series) -> pd.Series:
    # Smooth out possible noise while keeping any actual motion.
    # Used to detect certain regions later.
    sustained = log_flux.rolling(SUSTAINED_MOTION_WINDOW, center=True).mean()

    # Mask already smooth parts
    is_rough = (sustained - log_flux).abs() > 0.004

    # Mark valid slopes to not smooth out solar flares.
    # If a big change is actually a flare, it will reside for at least a few seconds
    # and the cumulative velocity won't drop as much after smoothing
    # compared to noisy data where values zigzag.
    # Take max as the big velocities are only at the edges of the flare,
    # and we don't want to smooth the tops.
    rough_velocity_max = _change_speed(log_flux).abs() \
        .rolling(SUSTAINED_MOTION_WINDOW, center=True).sum() \
        .rolling(SMOOTHING_WINDOW, center=True).max()
    sustained_velocity_max = _change_speed(sustained).abs() \
        .rolling(SUSTAINED_MOTION_WINDOW, center=True).sum() \
        .rolling(SMOOTHING_WINDOW, center=True).max()
    is_valid_slope = (sustained_velocity_max / rough_velocity_max) > 0.45

    # Combine and smooth out all flags to not create hard edges
    is_valid_slope_nearby = is_valid_slope.rolling(SUSTAINED_MOTION_WINDOW, center=True).mean()
    # If 20% nearby is rough, smooth also this point.
    is_rough_nearby = (is_rough.rolling(SMOOTHING_WINDOW, center=True).mean() / 0.2).clip(upper=1)
    smooth_force = pd.concat((1 - is_valid_slope_nearby, is_rough_nearby), axis=1, ).min(axis=1)

    # Calculate smoothing corrections
    smooth = log_flux.rolling(SMOOTHING_WINDOW, center=True).mean()
    corrections = (smooth - log_flux) * smooth_force

    # Clip corrections as excessive corrections only smooth out
    # outlier spikes making them harder to detect later.
    corrections_without_nan = corrections.dropna()
    max_correction = _top_percentile(corrections_without_nan, percentage=0.01)
    min_correction = -_top_percentile(-corrections_without_nan, percentage=0.01)
    corrections = corrections.clip(
        upper=min(max_correction + 0.1, 0.8),
        lower=max(min_correction - 0.1, -0.8)
    )

    # Apply corrections
    return log_flux + corrections


# How fast the flux trend changes.
# Should be bigger than a flare but still catch up with longer term changes.
_FLUX_TREND_PACE = timedelta(hours=12)


def _remove_outliers(log_flux: pd.Series) -> Optional[pd.Series]:
    # Calculate flux value acceleration (speed of change)
    forward_velocity = _change_speed(log_flux)
    forward_acceleration = _change_speed(forward_velocity)
    backward_velocity = _change_speed(log_flux, -1)
    backward_acceleration = _change_speed(backward_velocity, -1)

    # Merge backwards and forwards directions.
    # It is computed both ways because the measurements is not evenly distributed,
    # so outliers immediately after a gap would be missed by the forward pass
    # because the big value jump is damped by a big time gap.
    abs_velocity = _pick_abs_max(backward_velocity, forward_velocity)
    abs_acceleration = _pick_abs_max(backward_acceleration, forward_acceleration)

    # Mark measurements that introduce high acceleration.
    has_high_acceleration = abs_acceleration > 0.01
    has_excessive_acceleration = abs_acceleration > 0.02
    # Mark measurements after a large time gaps for splitting.
    is_after_gap = cast(pd.Series, log_flux).index.diff() > timedelta(minutes=1)
    # Remove outliers and split at marked
    group_id = (has_high_acceleration | is_after_gap).cumsum()[~has_excessive_acceleration]
    log_groups = log_flux[~has_excessive_acceleration].groupby(group_id)

    # Filter leftover groups
    filtered_log_groups = deque()
    for _, log_group in log_groups:
        if (
                # Filter short groups
                log_group.index[-1] - log_group.index[0] < timedelta(minutes=2) or
                # Filter flat groups (probably the satellite's value border)
                log_group.rolling(timedelta(minutes=30), center=True).std().median() < 0.0001 or
                # Filter out unnaturally fast changing groups (likely leftover outlier spots)
                abs_velocity.loc[log_group.index].mean() > 0.005

        ):
            continue
        filtered_log_groups.append(log_group)
    log_groups = filtered_log_groups
    if len(log_groups) == 0:
        return None

    # Filter outlier groups
    if len(log_groups) == 1:
        # Outlier detection on a single group doesn't make sense
        return log_groups[0]
    # Calculate minimum measurements count before moving average is taken as reference
    points_per_second = len(log_flux) / (log_flux.index[-1] - log_flux.index[0]).total_seconds()
    min_measurements = 4 * 60 * 60 * points_per_second
    # Calculate bidirectional moving average
    log_flux = pd.concat(log_groups)
    log_mean_forward = log_flux.rolling(_FLUX_TREND_PACE).mean()
    log_mean_backward = log_flux[::-1].rolling(_FLUX_TREND_PACE).mean()[::-1]
    # Calculate standard deviation.
    # Both are always nearly identical so just take the min.
    log_std = max(min(
        (log_flux - log_mean_forward).std(),
        (log_flux - log_mean_backward).std()
    ), 0.2)
    # Filter based on Z-Score
    filtered_log_groups = deque()
    for log_group in log_groups:
        # Get previous and next mean as unaffected references
        start_index = log_flux.index.get_loc(log_group.index[0])
        end_index = log_flux.index.get_loc(log_group.index[-1])
        last_log_mean = log_mean_forward.iloc[max(start_index - 1, 0)]
        next_log_mean = log_mean_backward.iloc[min(end_index + 1, len(log_mean_backward) - 1)]

        # Take mean of other side if one side isn't based on enough measurements.
        # If both sides don't use enough points, we keep them as is.
        last_enough_measurements = min_measurements < start_index
        next_enough_measurements = end_index < len(log_mean_backward) - min_measurements - 1
        if last_enough_measurements or next_enough_measurements:
            if not last_enough_measurements:
                last_log_mean = next_log_mean
            if not next_enough_measurements:
                next_log_mean = last_log_mean

        # Calculate Z-Score at start and end
        zscore_start = (log_group.iloc[0] - last_log_mean) / log_std
        zscore_end = (log_group.iloc[-1] - next_log_mean) / log_std
        min_abs_zscore = min(abs(zscore_start), abs(zscore_end))

        # If one score is negative and the other positive
        # the group start over the mean and ends under it over vice versa.
        doesnt_crosses_mean = np.sign(zscore_start) == np.sign(zscore_end)

        # Filter outlier groups is way above or below
        if doesnt_crosses_mean and min_abs_zscore > 3:
            continue
        filtered_log_groups.append(log_group)
    log_groups = filtered_log_groups
    if len(log_groups) == 0:
        return None

    # Merge groups together
    return cast(pd.Series, pd.concat(log_groups))


def clean_flux(flux: Flux) -> Flux:
    """
    Denoises and removes outliers from the provided measured flux.

    Tuned to work on the archive data. Dates to test:
        (
            '1980-09-25', '1980-09-28', '1984-02-06', '1985-05-02',
            '1985-12-02', '1986-07-28', '1987-09-03', '1988-03-22',
            '1991-04-30', '1995-10-04', '1995-10-06', '1996-07-07',
            '2002-12-19', '2002-12-20', '2009-09-22', '2017-09-06'
        )
    """
    if flux.empty:
        return empty_flux()
    # Remove obviously incorrect values
    flux = flux[(0 < flux) & (flux < 1)]
    if flux.empty:
        return empty_flux()
    with np.errstate(invalid='ignore'):
        # Value range is exponential so find outliers with log
        log_flux = np.log10(flux)
    log_flux = _denoise(log_flux)
    log_flux = _remove_outliers(log_flux)
    if log_flux is None or log_flux.empty:
        return empty_flux()
    # Return to normal distribution
    flux = 10 ** log_flux
    # Remove any potential NANs that got introduced
    return flux.dropna()
