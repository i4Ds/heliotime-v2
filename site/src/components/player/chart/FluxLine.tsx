import { FluxSections } from '@/api/flux/data';
import { curveMonotoneX } from '@visx/curve';
import { ScaleLogarithmic, ScaleTime } from 'd3-scale';
import { LinePath } from '@visx/shape';
import { memo } from 'react';

export interface FluxLineProps {
  data: FluxSections;
  timeScale: ScaleTime<number, number>;
  wattScale: ScaleLogarithmic<number, number>;
}

// eslint-disable-next-line prefer-arrow-callback
export default memo(function FluxLine({ data, timeScale, wattScale }: FluxLineProps) {
  return data.map((section) => (
    <LinePath
      key={section[0][0]}
      curve={curveMonotoneX}
      data={section}
      x={(d) => timeScale(d[0])}
      y={(d) => wattScale(d[1])}
      className="stroke-primary"
    />
  ));
});
