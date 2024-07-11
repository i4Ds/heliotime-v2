
export type NumberRange = [start: number, end: number];

export function clipRange(range: Readonly<NumberRange>, bounds: Readonly<NumberRange>): NumberRange {
  return [
    Math.min(Math.max(bounds[0], range[0]), bounds[1]),
    Math.min(Math.max(bounds[0], range[1]), bounds[1])
  ]
}
