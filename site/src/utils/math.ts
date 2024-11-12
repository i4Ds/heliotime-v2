export function resCeil(value: number, resolution: number): number {
  return Math.ceil(value / resolution) * resolution;
}

export function resFloor(value: number, resolution: number): number {
  return Math.floor(value / resolution) * resolution;
}

export function resRound(value: number, resolution: number): number {
  return Math.round(value / resolution) * resolution;
}

export function log(value: number, base: number): number {
  return Math.log(value) / Math.log(base);
}

export function expCeil(value: number, base: number): number {
  return base ** Math.ceil(log(value, base));
}

export function expFloor(value: number, base: number): number {
  return base ** Math.floor(log(value, base));
}
