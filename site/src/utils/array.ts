export function splitByDelta<Value>(
  array: Value[],
  getter: (value: Value) => number,
  maxDelta: number
): Value[][] {
  if (array.length === 0) return [];
  const values = array.map((v) => getter(v));
  const sections: Value[][] = [];
  let sectionStartIndex = 0;
  let lastValue = getter(array[0]);
  for (let i = 1; i < values.length; i += 1) {
    const value = getter(array[i]);
    if (Math.abs(value - lastValue) > maxDelta) {
      sections.push(array.slice(sectionStartIndex, i));
      sectionStartIndex = i;
    }
    lastValue = value;
  }
  sections.push(array.slice(sectionStartIndex));
  return sections;
}
