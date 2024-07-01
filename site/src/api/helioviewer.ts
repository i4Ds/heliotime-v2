const layers = '[SDO,AIA,AIA,171,1,100]';

export function getSolarImageUrl(timestamp: Date, resolution = 256): string {
  const params = new URLSearchParams({
    date: timestamp.toISOString(),
    layers,
    imageScale: (2500 / resolution).toString(),
    width: resolution.toString(),
    height: resolution.toString(),
    x0: '0',
    y0: '0',
    display: 'true',
    watermark: 'false',
  });
  return `https://api.helioviewer.org/v2/takeScreenshot/?${params}`;
}

export function getHelioviewerUrl(timestamp: Date): string {
  const params = new URLSearchParams({
    date: timestamp.toISOString(),
    imageLayers: layers,
  });
  return `https://helioviewer.org/?${params}`;
}
