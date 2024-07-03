import FluxBrush, { FluxBrushRef } from '@/chart/FluxBrush';
import { FluxMain } from '@/chart/FluxMain';
import { useRef, useState } from 'react';
import { View } from './flux';

export interface FluxChartProps {
  width: number;
  height: number;
  onTimeSelect?: (timestamp: Date) => void;
}

export default function FluxChart({ width, height, onTimeSelect }: FluxChartProps) {
  const brushHeight = height * 0.15;
  const marginLeft = 70;

  const brushRef = useRef<FluxBrushRef>(null);
  const viewState = useState<View>();
  const [view, setView] = viewState;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <FluxMain
        width={width - marginLeft}
        height={height - brushHeight - 40}
        left={marginLeft}
        view={view}
        setView={(setter) => setView((previous) => brushRef.current?.updateBrush(setter(previous)))}
        onTimeSelect={onTimeSelect}
      />
      <FluxBrush
        ref={brushRef}
        width={width - marginLeft}
        height={brushHeight}
        top={height - brushHeight}
        left={marginLeft}
        onBrush={(range) => setView(range)}
      />
    </svg>
  );
}
