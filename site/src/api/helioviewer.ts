import { resRound } from '@/utils/math';
import { useQuery } from '@tanstack/react-query';

const VIEWER_URL = 'https://helioviewer.org/';
const API_URL = 'https://api.helioviewer.org/';
// As the API is not CORS-enabled, we need to proxy the requests.
// Individual paths are specified in the Next.js config.
const API_PROXY_URL = '/helioviewer/';

export class HelioviewerSource {
  private static SOURCES = [
    new HelioviewerSource(
      'SDO',
      '[SDO,AIA,AIA,171,1,100]',
      10,
      1_275_429_936_000, // 2010-06-02 00:05:36
      1000 // Has roughly a 12 second cadence
    ),
    new HelioviewerSource(
      'SOHO',
      '[SOHO,EIT,EIT,171,1,100]',
      0,
      821_738_361_000, // 1996-01-15 21:39:21,
      60 * 60 * 1000 // Has roughly a 12 hour cadence
    ),
  ];

  readonly name: string;

  /**
   * Layers format: [Observatory, Instrument, Detector, Measurement, Unknown (1 works), Opacity]
   */
  private readonly layer: string;

  private readonly sourceId: number;

  private readonly startMs: number;

  private readonly roundMs: number;

  constructor(name: string, layer: string, sourceId: number, startMs: number, roundMs: number) {
    this.name = name;
    this.layer = layer;
    this.sourceId = sourceId;
    this.startMs = startMs;
    this.roundMs = roundMs;
  }

  static select(timestampMs: number): HelioviewerSource {
    return this.SOURCES.find(({ startMs: start }) => timestampMs >= start) ?? this.SOURCES.at(-1)!;
  }

  roundTimestamp(timestamp: number): number {
    return resRound(timestamp, this.roundMs);
  }

  async fetchClosestImageTimestamp(timestamp: Date): Promise<Date> {
    const params = new URLSearchParams({
      date: timestamp.toISOString(),
      sourceId: this.sourceId.toString(),
    });
    const response = await fetch(`${API_PROXY_URL}v2/getClosestImage?${params}`);
    if (!response.ok) throw new Error(`Fetch failed: ${response}`);
    const json = await response.json();
    return new Date(`${json.date.replace(' ', 'T')}Z`);
  }

  useClosestImageTimestamp(timestamp: Date): Date | undefined {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery({
      queryKey: [this, timestamp],
      queryFn: () => this.fetchClosestImageTimestamp(timestamp),
    }).data;
  }

  getClosestImageUrl(timestamp: Date, resolution = 256): string {
    const params = new URLSearchParams({
      date: timestamp.toISOString(),
      layers: this.layer,
      imageScale: (2400 / resolution).toString(),
      width: resolution.toString(),
      height: resolution.toString(),
      x0: '0',
      y0: '0',
      display: 'true',
      watermark: 'false',
    });
    return `${API_URL}v2/takeScreenshot/?${params}`;
  }

  getViewerUrl(timestamp: Date): string {
    const params = new URLSearchParams({
      date: timestamp.toISOString(),
      imageLayers: this.layer,
    });
    return `${VIEWER_URL}?${params}`;
  }
}
