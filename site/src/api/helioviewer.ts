const layers = '[SDO,AIA,AIA,171,1,100]';

export function getSolarImageUrl(timestamp: Date): string {
  const params = new URLSearchParams({
    date: timestamp.toISOString(),
    layers,
    // TODO: make size dynamic
    imageScale: '5',
    width: '500',
    height: '500',
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
