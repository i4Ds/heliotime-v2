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
SUSTAINED_MOTION_WINDOW = timedelta(seconds=20)


def _denoise(log_flux: pd.Series) -> pd.Series:
    # Smooth out possible noise while keeping any actual motion.
    # Used to detect certain regions later.
    sustained = log_flux.rolling(SUSTAINED_MOTION_WINDOW, center=True).mean()

    # Mask already smooth parts
    is_rough = (sustained - log_flux).abs() > 0.005

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
    is_valid_slope = (sustained_velocity_max / rough_velocity_max) > 0.35

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
        upper=min(max_correction + 0.05, 0.8),
        lower=max(min_correction - 0.05, -0.8)
    )

    # Apply corrections
    return log_flux + corrections


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

    # Mark measurements that introduce excessive acceleration.
    is_outlier = abs_acceleration > 0.02
    # Mark measurements after a large time gaps for splitting.
    is_after_gap = cast(pd.Series, log_flux).index.diff() > timedelta(seconds=30)
    # Remove outliers and split at marked
    group_id = (is_outlier | is_after_gap).cumsum()[~is_outlier]
    log_groups = log_flux[~is_outlier].groupby(group_id)

    # Filter leftover groups
    filtered_log_groups = deque()
    for _, log_group in log_groups:
        if (
                # Filter flat groups (probably the satellite's value border)
                log_group.rolling(timedelta(minutes=30), center=True).std().min() < 0.001 or
                # Filter short groups
                log_group.index[-1] - log_group.index[0] < timedelta(minutes=2) or
                # Filter out unnaturally fast changing groups (likely leftover outlier spots)
                abs_velocity.loc[log_group.index].mean() > 0.005

        ):
            continue
        filtered_log_groups.append(log_group)
    log_groups = filtered_log_groups
    if len(log_groups) == 0:
        return None

    # Filter outlier groups based on Z-Score.
    # Is done after all other filters have been applied because
    # the mean and std should be as clean as possible.
    log_flux = pd.concat(log_groups)
    log_mean = log_flux.mean()
    log_std = log_flux.std()
    filtered_log_groups = deque()
    for log_group in log_groups:
        # Select closest point to mean to compute Z-Score to avoid
        # throwing out correct spikes that go back down again.
        lowest_zscore = min(
            np.abs(log_group.max() - log_mean),
            np.abs(log_group.mean() - log_mean),
            np.abs(log_group.min() - log_mean),
        ) / log_std
        if np.abs(lowest_zscore) > 3:
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
