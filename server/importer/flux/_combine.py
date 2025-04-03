from __future__ import annotations

import concurrent
import dataclasses
from collections import deque, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import timedelta
from typing import cast

import numpy as np
import pandas as pd

from data.flux.spec.channel import FluxChannel, SATELLITE_COMBINED_ID, FrequencyBand
from data.flux.spec.data import Flux, empty_flux
from utils.range import DateTimeRange

# Time range at start and end which will not be properly combined
# because there was no bordering data to compare to.
# TODO: make formally correct, as the weight segment can be longer than this
COMBINE_BORDER_SIZE = timedelta(hours=6)

# TODO: merge constants and utils where possible with _clean.py
_MAX_INTERVAL = timedelta(minutes=1)
_WEIGHT_SMOOTHING_WINDOW = timedelta(minutes=10)


def _calculate_bidirectional_time_delta(
        time_index: pd.DatetimeIndex, time_range: DateTimeRange
) -> tuple[pd.Series, pd.Series]:
    """
    Calculate forward and backward time deltas for a given time index.

    :param time_index: Time index of the series
    :param time_range: Actual time range of the data
    :return: Tuple of (forward_time_delta, backward_time_delta) as pandas Series
    """
    # Calculate forward time differences
    forward_time_delta = time_index.to_series().diff()
    forward_time_delta.iloc[0] = time_range.start - time_index[0]
    # Calculate backward time differences (to next point)
    backward_time_delta = forward_time_delta.shift(
        periods=-1,
        fill_value=time_index.max() - time_range.end
    )
    return forward_time_delta, backward_time_delta


def _calculate_time_weights(
        time_index: pd.DatetimeIndex, time_range: DateTimeRange
) -> pd.Series:
    """
    Calculate time weights based on forward and backward time deltas.

    :param time_index: Time index of the series
    :param time_range: Actual time range of the data
    :return: Series of time weights in seconds
    """
    forward_delta, backward_delta = _calculate_bidirectional_time_delta(time_index, time_range)
    return (
            forward_delta.clip(upper=_MAX_INTERVAL) +
            backward_delta.clip(upper=_MAX_INTERVAL)
    ).dt.total_seconds()


def _process_band(
        band: FrequencyBand,
        band_channels: dict[FluxChannel, Flux],
        time_range: DateTimeRange
) -> dict[FluxChannel, Flux]:
    """
    Process a single band to combine flux data from multiple satellites.
    Processes both clean and raw versions separately.

    :param band: The band to process
    :param band_channels: Dictionary of channel to flux mappings
    :param time_range: Time range for the data
    :return: Dictionary with combined channels for this band
    """
    # Check if all channels have both clean and raw versions.
    # Both lists must have the same order and length.
    raw_band_channels = [c for c in band_channels if not c.is_clean]
    if len(raw_band_channels) != len(band_channels) / 2:
        raise ValueError(f"Missing raw channels for band {band}")
    clean_band_channels = [dataclasses.replace(c, is_clean=True) for c in raw_band_channels]
    if any(c not in band_channels for c in clean_band_channels):
        raise ValueError(f"Missing clean channels for band {band}")

    # Get flux data (some used in gap detection)
    raw_merged = pd.concat([band_channels[channel] for channel in raw_band_channels], axis=1)
    clean_flux_channels = [band_channels[channel] for channel in clean_band_channels]
    clean_merged = pd.concat(clean_flux_channels, axis=1)
    # Unify column names for later merging
    raw_merged.columns = clean_merged.columns = pd.RangeIndex(clean_merged.columns.size)

    # Gap Detection (used for both clean and raw processing)
    gap_threshold = timedelta(minutes=5)
    is_after_gap = pd.Series(False, index=clean_merged.index)
    is_before_gap = pd.Series(False, index=clean_merged.index)
    # Find gaps in each clean channel
    for flux in clean_flux_channels:
        forward_delta, backward_delta = _calculate_bidirectional_time_delta(flux.index, time_range)
        is_after_gap[flux.index] |= forward_delta > gap_threshold
        is_before_gap[flux.index] |= backward_delta > gap_threshold

    # Process both clean and raw versions
    result_channels = {}
    for merged in (raw_merged, clean_merged):
        combined_channel = FluxChannel(SATELLITE_COMBINED_ID, band, merged is clean_merged)

        # Split data into segments based on previously detected gaps.
        # Clean index might have missing entries, so we need to reindex it first.
        complete_is_before_gap = is_before_gap.reindex(merged.index, fill_value=False)
        complete_is_after_gap = is_after_gap.reindex(merged.index, fill_value=False)
        segment_id = (complete_is_before_gap.shift(1, fill_value=False) | complete_is_after_gap).cumsum()
        segments = [segment for _, segment in merged.groupby(segment_id)]

        # ----- Weight Calculation -----
        weights_list = deque()
        for segment in segments:
            # Use clean version for segment analysis (unless empty)
            reference_segment = clean_merged.loc[segment.index.min():segment.index.max()]
            if len(reference_segment) == 0:
                reference_segment = segment
            channel_counts = reference_segment.count()
            channel_weights = channel_counts / channel_counts.max()

            # Drop channels with insufficient data
            has_enough_data = channel_weights >= 0.25
            channel_weights[~has_enough_data] = 0

            # Drop entries which would be pure interpolations
            filtered_segment = segment.loc[:, has_enough_data].dropna(how='all')
            if filtered_segment.empty:
                continue

            # Add weights
            segment_weights = pd.DataFrame(
                np.tile(channel_weights, (len(filtered_segment), 1)),
                index=filtered_segment.index
            )
            weights_list.append(segment_weights)

        if not weights_list:
            result_channels[combined_channel] = empty_flux()
            continue

        # ----- Weight Smoothing -----
        weights = pd.concat(weights_list)
        is_zero_weight = cast(pd.DataFrame, weights == 0)

        # Create time weights for smoothing
        time_weight = _calculate_time_weights(weights.index, time_range)
        time_weight_sum = time_weight.rolling(_WEIGHT_SMOOTHING_WINDOW, center=True).sum()

        # Create factor to transition to zero weights at segment boundaries
        zero_weight_smoothed = (
            is_zero_weight.mul(time_weight, axis=0)
            .rolling(_WEIGHT_SMOOTHING_WINDOW, center=True).sum()
            .div(time_weight_sum, axis=0)
        )
        transition_factor = 1 - (zero_weight_smoothed * 2).clip(upper=1)
        # Account for slight border inaccuracies
        transition_factor[is_zero_weight] = 0

        # Apply time-weighted smoothing to all weights
        smoothed_weights = (
                weights.mul(time_weight, axis=0)
                .rolling(_WEIGHT_SMOOTHING_WINDOW, center=True).sum()
                .div(time_weight_sum, axis=0) * transition_factor
        )

        # ----- Final Combination -----
        # Interpolate to fill any gaps at segment boundaries
        interpolated_data = (
            merged.loc[smoothed_weights.index]
            .interpolate(method='time')
            .bfill()
            .ffill()
        )
        # Calculate weighted average
        result_channels[combined_channel] = (
                (interpolated_data * smoothed_weights).sum(axis=1) /
                smoothed_weights.sum(axis=1)
        )
    return result_channels


def combine_flux_channels(
        flux_channels: dict[FluxChannel, Flux], time_range: DateTimeRange,
        executor: ProcessPoolExecutor = None
) -> dict[FluxChannel, Flux]:
    """
    Combine flux data from multiple satellites into a single channel for each band.
    Processes both clean and raw versions separately.
    """
    channels_by_band = defaultdict(dict)
    for channel, flux in flux_channels.items():
        channels_by_band[channel.band][channel] = flux

    result_channels = {}
    if executor is None:
        # Process bands sequentially
        for band, band_channels in channels_by_band.items():
            result_channels |= _process_band(band, band_channels, time_range)
    else:
        # Process bands in parallel
        futures = [
            executor.submit(_process_band, band, band_channels, time_range)
            for band, band_channels in channels_by_band.items()
        ]
        for future in concurrent.futures.as_completed(futures):
            result_channels |= future.result()
    return result_channels
