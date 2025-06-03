import { FluxSections } from '@/api/flux/data';
import { curveMonotoneX } from '@visx/curve';
import { ScaleLogarithmic, ScaleTime, ScaleLinear } from 'd3-scale';
import { LinePath } from '@visx/shape';
import { memo } from 'react';

export interface FluxLineProps {
  data: FluxSections;
  timeScale: ScaleTime<number, number>;
  wattScale: ScaleLogarithmic<number, number> | ScaleLinear<number, number>;
}

// eslint-disable-next-line prefer-arrow-callback
export default memo(function FluxLine({ data, timeScale, wattScale }: FluxLineProps) {
  return data.map((section, index) => (
    <LinePath
      // Use newest timestamp of oldest section to keep the ID stable while panning.
      key={section.at(index === 0 ? -1 : 0)![0]}
      curve={curveMonotoneX}
      data={section}
      x={(d) => timeScale(d[0])}
      y={(d) => wattScale(d[1])}
      className="stroke-primary"
    />
  ));
});
