from __future__ import annotations

import concurrent
import dataclasses
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import cast

import numpy as np
import pandas as pd

from data.flux.spec.channel import FluxChannel, SATELLITE_COMBINED_ID, FrequencyBand
from data.flux.spec.data import Flux, empty_flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME
from utils.range import DateTimeRange

# Time range at start and end which will not be properly combined
# because there was no bordering data to compare to.
# TODO: make formally correct, as the weight segment can be longer than this
COMBINE_BORDER_SIZE = timedelta(hours=6)

_SECONDS_TO_NS = 1e9
_NS_TO_SECONDS = 1e-9

_MAX_INTERVAL_NS = timedelta(minutes=1).total_seconds() * _SECONDS_TO_NS
_WEIGHT_SMOOTHING_WINDOW = '10min'
_GAP_THRESHOLD_NS = timedelta(minutes=5).total_seconds() * _SECONDS_TO_NS
_MIN_DATA_WEIGHT_THRESHOLD = 0.25


def _bidirectional_time_delta_ns(
        time_index: pd.DatetimeIndex, time_range: DateTimeRange
) -> tuple[np.ndarray, np.ndarray]:
    """
    Calculate forward and backward time deltas in nanoseconds for a given time index.

    :param time_index: Time index of the series
    :param time_range: Actual time range of the data
    :return: Tuple of (forward_time_delta, backward_time_delta) as numpy arrays
    """
    if time_index.empty:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64)
    delta_ns = np.diff(
        time_index.to_numpy(dtype=np.int64),
        prepend=np.int64(np.datetime64(time_range.start, 'ns')),
        append=np.int64(np.datetime64(time_range.end, 'ns'))
    )
    return delta_ns[:-1], delta_ns[1:]


def _time_weights(
        time_index: pd.DatetimeIndex, time_range: DateTimeRange
) -> pd.Series:
    """
    Calculate time weights based on forward and backward time deltas.

    :param time_index: Time index of the series
    :param time_range: Actual time range of the data
    :return: Series of time weights in seconds
    """
    if time_index.empty:
        return pd.Series(dtype=np.float64, index=time_index)
    forward_delta_ns, backward_delta_ns = _bidirectional_time_delta_ns(
        time_index, time_range
    )
    weight = (np.minimum(forward_delta_ns, _MAX_INTERVAL_NS) +
              np.minimum(backward_delta_ns, _MAX_INTERVAL_NS))
    return pd.Series(
        # Convert to seconds so we have more reasonable weights
        weight.astype(np.float32) * _NS_TO_SECONDS,
        index=time_index
    )


def _combine_band(
        band: FrequencyBand,
        band_channels: dict[FluxChannel, Flux],
        time_range: DateTimeRange
) -> dict[FluxChannel, Flux]:
    """
    Combine channels of a single band.

    :param band: The band to process
    :param band_channels: Dictionary of channel to flux mappings
    :param time_range: Time range for the data
    :return: Dictionary with combined channels for this band
    """
    # --- Channel Validation and Setup ---
    # Check if all channels have both clean and raw versions.
    # Both lists must have the same order and length.
    raw_band_channels = [c for c in band_channels if not c.is_clean]
    if len(raw_band_channels) != len(band_channels) / 2:
        raise ValueError(f"Missing raw channels for band {band}")
    clean_band_channels = [dataclasses.replace(c, is_clean=True) for c in raw_band_channels]
    if any(c not in band_channels for c in clean_band_channels):
        raise ValueError(f"Missing clean channels for band {band}")
    channel_count = len(raw_band_channels)

    # Early return if there is nothing to combine
    if len(raw_band_channels) == 1 and len(clean_band_channels) == 1:
        return {
            FluxChannel(SATELLITE_COMBINED_ID, band, True): band_channels[clean_band_channels[0]],
            FluxChannel(SATELLITE_COMBINED_ID, band, False): band_channels[raw_band_channels[0]]
        }

    # --- Data Merging ---
    clean_fluxes = [band_channels[c] for c in clean_band_channels]
    raw_fluxes = [band_channels[c] for c in raw_band_channels]
    clean_merged = pd.concat(clean_fluxes, axis=1)
    raw_merged = pd.concat(raw_fluxes, axis=1)
    # Unify column names for later merging
    clean_merged.columns = raw_merged.columns = pd.RangeIndex(channel_count)

    # --- Gap Detection ---
    is_after_gap = pd.Series(False, index=clean_merged.index)
    is_before_gap = pd.Series(False, index=clean_merged.index)
    # Find gaps in each clean channel
    for flux in clean_fluxes:
        forward_delta_ns, backward_delta_ns = _bidirectional_time_delta_ns(flux.index, time_range)
        is_after_gap.loc[flux.index[forward_delta_ns > _GAP_THRESHOLD_NS]] = True
        is_before_gap.loc[flux.index[backward_delta_ns > _GAP_THRESHOLD_NS]] = True

    del clean_fluxes, raw_fluxes

    # --- Process Clean and Raw Versions ---
    result_channels = {}
    for merged_df, is_clean in [(raw_merged, False), (clean_merged, True)]:
        combined_channel = FluxChannel(SATELLITE_COMBINED_ID, band, is_clean)

        # --- Segment Splitting ---
        # Clean versions might have fewer entries than raw, so we need to reindex it first.
        complete_is_before_gap = is_before_gap if is_clean else is_before_gap.reindex(merged_df.index, fill_value=False)
        complete_is_after_gap = is_after_gap if is_clean else is_after_gap.reindex(merged_df.index, fill_value=False)
        segment_ids = (complete_is_before_gap.shift(1, fill_value=False) | complete_is_after_gap).cumsum()
        segments = merged_df.groupby(segment_ids)

        # ----- Weight Calculation -----
        weights_list = deque()
        for _, segment_df in segments:
            reference_segment_df = segment_df
            if not is_clean:
                # Use clean version for segment analysis (unless empty)
                clean_reference_segment_df = clean_merged.loc[segment_df.index.min():segment_df.index.max()]
                if not clean_reference_segment_df.empty:
                    reference_segment_df = clean_reference_segment_df
            channel_counts_series = reference_segment_df.count()
            channel_weights_np = channel_counts_series.to_numpy(dtype=np.float32) / channel_counts_series.max()

            # Drop channels with insufficient data.
            # At least one channel will always have enough data,
            # because cleaning is per channel and only removes data.
            has_enough_data_np = channel_weights_np >= _MIN_DATA_WEIGHT_THRESHOLD
            channel_weights_np[~has_enough_data_np] = 0.0

            # Drop entries which would be pure interpolations
            is_fully_nan_series = segment_df.iloc[:, has_enough_data_np].isna().all(axis=1)
            index = segment_df.index[~is_fully_nan_series]
            if index.empty:
                continue

            # Add weights
            segment_weights_df = pd.DataFrame(
                np.tile(channel_weights_np, (len(index), 1)),
                index=index
            )
            weights_list.append(segment_weights_df)
        if not weights_list:
            result_channels[combined_channel] = empty_flux()
            continue

        # --- Weight Smoothing ---
        weights = pd.concat(weights_list)
        weights_np = weights.to_numpy()

        # Create time weights for smoothing
        time_weight_series = _time_weights(weights.index, time_range)
        time_weight_np = time_weight_series.to_numpy()[:, np.newaxis]
        time_weight_sum_series = time_weight_series.rolling(_WEIGHT_SMOOTHING_WINDOW, center=True).sum()
        time_weight_sum_np = time_weight_sum_series.to_numpy(dtype=np.float64)[:, np.newaxis]

        def apply_smoothing(x: np.ndarray) -> np.ndarray:
            return pd.DataFrame(x * time_weight_np, index=weights.index) \
                .rolling(_WEIGHT_SMOOTHING_WINDOW, center=True).sum() \
                .to_numpy() / time_weight_sum_np

        # Create factor to transition to zero weights at segment boundaries
        is_weight_zero_np = cast(np.ndarray, weights_np == 0)
        transition_factor_np = 1 - np.minimum(apply_smoothing(is_weight_zero_np) * 2.0, 1.0)
        # Account for slight border inaccuracies
        transition_factor_np[is_weight_zero_np] = 0.0

        # Apply smoothing and transition factor
        smoothed_weights_np = apply_smoothing(weights_np) * transition_factor_np
        # Transitions can introduce new all zero rows
        is_weight_row_valid = ~np.all(smoothed_weights_np == 0.0, axis=1)
        smoothed_weights_np = smoothed_weights_np[is_weight_row_valid]

        # --- Final Combination ---
        combined_index = weights.index[is_weight_row_valid]
        combined_index.name = FLUX_INDEX_NAME

        interpolated_df = merged_df.loc[combined_index].interpolate(method='time').ffill().bfill()
        interpolated_np = interpolated_df.to_numpy(dtype=np.float32)

        combined_np = np.sum(interpolated_np * smoothed_weights_np, axis=1) / np.sum(smoothed_weights_np, axis=1)
        combined_series = pd.Series(combined_np, index=combined_index, name=FLUX_VALUE_NAME)
        result_channels[combined_channel] = combined_series

    # --- Cleanup ---
    del clean_merged, raw_merged, segment_ids, segments, is_after_gap, is_before_gap, complete_is_before_gap, \
        complete_is_after_gap, merged_df, interpolated_df, weights, smoothed_weights_np, weights_np, \
        time_weight_series, time_weight_np, time_weight_sum_np, time_weight_sum_series, transition_factor_np, \
        is_weight_zero_np, interpolated_np

    return result_channels


def combine_flux_channels(
        flux_channels: dict[FluxChannel, Flux], time_range: DateTimeRange,
        executor: ThreadPoolExecutor | None = None
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
        for band, band_channels in channels_by_band.items():
            result_channels.update(_combine_band(band, band_channels, time_range))
    else:
        futures = [
            executor.submit(_combine_band, band, band_channels, time_range)
            for band, band_channels in channels_by_band.items()
        ]
        for future in concurrent.futures.as_completed(futures):
            result_channels.update(future.result())
    return result_channels
