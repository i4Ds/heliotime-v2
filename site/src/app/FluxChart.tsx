'use client';

/* eslint-disable react/no-this-in-sfc */
import { FluxSeries, fetchFluxSeries } from '@/api/flux';
import Highcharts from 'highcharts/highstock';
import HighchartsAccessibility from 'highcharts/modules/accessibility';
import HighchartsReact from 'highcharts-react-official';
import { useEffect, useState } from 'react';

if (typeof Highcharts === 'object') HighchartsAccessibility(Highcharts);

// TODO: make dynamic with fetch resolution
const updateThreshold = 10 * 1000;

type SeriesSetter = (data: FluxSeries) => void;

class SeriesLoader {
  private lastMin?: number;

  private lastMax?: number;

  private lastAborter?: AbortController;

  private lastData?: Promise<FluxSeries>;

  constructor(
    private readonly chart: Highcharts.Chart,
    private readonly seriesSetter: SeriesSetter
  ) {}

  async load(min: number = this.lastMin ?? 0, max: number = this.lastMax ?? Date.now()) {
    if (
      this.lastMin !== undefined &&
      this.lastMax !== undefined &&
      Math.abs(this.lastMin - min) < updateThreshold &&
      Math.abs(this.lastMax - max) < updateThreshold
    )
      return;
    // TODO: only show loading indicator for big changes
    this.chart.showLoading();
    // Set before starting request because it will *eventually* be completed
    // and prevents the chart from remaking a very similar request.
    this.lastMin = min;
    this.lastMax = max;

    this.lastAborter?.abort();
    // Copy into local variable as this.lastAborter might change during awaits
    const aborter = new AbortController();
    this.lastAborter = aborter;

    this.lastData = fetchFluxSeries(
      Math.floor(min),
      Math.ceil(max),
      this.chart.plotWidth,
      aborter.signal
    );
    try {
      this.seriesSetter(await this.lastData);
    } catch (error) {
      if (aborter.signal.aborted === false) throw error;
      return;
    }
    this.chart.hideLoading();
  }

  async copy(seriesSetter: SeriesSetter): Promise<SeriesLoader> {
    const copy = new SeriesLoader(this.chart, seriesSetter);
    copy.lastMin = this.lastMin;
    copy.lastMax = this.lastMax;
    copy.lastData = this.lastData;
    // Prevent abort because this new loader needs it too
    this.lastAborter = undefined;
    if (this.lastData !== undefined) seriesSetter(await this.lastData);
    return copy;
  }
}

export interface FlexChartProps {
  onTimeSelect?: (timestamp: Date) => void;
}

export function FluxChart({ onTimeSelect }: FlexChartProps) {
  const [options, setOptions] = useState<Highcharts.Options | undefined>();
  useEffect(() => {
    let firstLoad = true;
    let extendHorizonInterval: NodeJS.Timeout;
    let mainLoader: SeriesLoader;
    let navLoader: SeriesLoader;

    // TODO: migrate rest of the options from old frontend
    setOptions({
      title: {
        text: 'Solar Activity Timeline',
      },
      chart: {
        // Required to avoid flickering while reloading the graph
        // which makes the labels disappear.
        marginLeft: 100,
        animation: false,
        zooming: {
          type: 'x',
          // Hide reset button because it is broken and
          // the user can just use the "all" zoom button.
          resetButton: {
            theme: {
              style: {
                display:'none'
              }
            }
          }
        },
        events: {
          async load() {
            // For some reason the load always gets called twice
            // and the first "this" object gets deconstructed.
            if (firstLoad) {
              firstLoad = false;
              return;
            }

            mainLoader = new SeriesLoader(this, (data) => this.series[0].setData(data));
            mainLoader.load();
            navLoader = await mainLoader.copy((data) =>
              this.update({
                navigator: { series: { data } },
              })
            );

            // TODO: cleanup this block
            let lastMax = Date.now();
            const mainAxis = this.xAxis[0];
            mainAxis.setExtremes(undefined, lastMax);
            extendHorizonInterval = setInterval(() => {
              const newMax = Date.now();
              const delta = newMax - lastMax;
              if (mainAxis.max === lastMax)
                mainAxis.setExtremes(
                  mainAxis.min === undefined ? undefined : mainAxis.min + delta,
                  mainAxis.max === undefined ? undefined : mainAxis.max + delta
                );
              lastMax = newMax;

              this.update({
                navigator: {
                  xAxis: {
                    max: newMax,
                  },
                },
              });
              navLoader.load();
            }, 100);
          },
          // @ts-expect-error They forgot to type the property: https://api.highcharts.com/highstock/chart.events.click
          click: (event) => onTimeSelect?.(new Date(event.xAxis[0].value)),
        },
      },
      navigator: {
        enabled: true,
        adaptToUpdatedData: false,
        yAxis: {
          type: 'logarithmic',
        },
      },
      rangeSelector: {
        enabled: true,
        buttons: [
          {
            type: 'minute',
            count: 10,
            text: '10m',
          },
          {
            type: 'hour',
            count: 1,
            text: '1h',
          },
          {
            type: 'day',
            count: 1,
            text: '1d',
          },
          {
            type: 'month',
            count: 1,
            text: '1m',
          },
          {
            type: 'year',
            count: 1,
            text: '1y',
          },
          {
            type: 'all',
            text: 'All',
          },
        ],
        selected: 5, // all by default
      },
      xAxis: {
        max: Date.now(),
        minRange: 5 * 60 * 1000, // TODO: configure in range
        type: 'datetime',
        dateTimeLabelFormats: {
          day: "%b %d '%y",
          week: "%b %d '%y",
          month: "%b '%y",
        },
        crosshair: {
          label: {
            enabled: false,
          },
        },
        events: {
          afterSetExtremes: (event) => mainLoader.load(event.min, event.max),
        },
      },
      yAxis: {
        type: 'logarithmic',
        title: {
          text: 'X-ray Flux',
          // Required to avoid jumping around while reloading the graph
          // which makes the labels disappear.
          offset: 80,
        },
        labels: {
          x: -45,
          formatter() {
            if (typeof this.value === 'string') return this.value;
            return `10<sup>${Math.log10(this.value)}</sup>`;
          },
          useHTML: true,
          style: {
            visibility: 'visible',
          },
        },
        tickInterval: 1,
        plotBands: [0, 1, 2, 3, 4].map((index) => ({
          from: 10 ** (-7 + index),
          to: 10 ** (-8 + index),
          color: index % 2 ? '#e6e9ff' : '#d1d7ff',
          label: {
            text: 'ABCMX'[index],
            x: -25,
          },
        })),
      },
      tooltip: {
        enabled: true,
      },
      series: [
        {
          type: 'line',
          showInLegend: false,
        },
      ],
    });
    return () => clearInterval(extendHorizonInterval);
  }, [onTimeSelect]);
  return options && <HighchartsReact highcharts={Highcharts} options={options} />;
}
