import FluxBrush, { FluxBrushRef } from '@/chart/FluxBrush';
import { FluxMain } from '@/chart/FluxMain';
import { useEffect, useRef, useState } from 'react';
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

  // updateBrush flag is needed to prevent recursive updates from the brush
  const updateBrush = useRef<boolean>(false);
  useEffect(() => {
    if (!updateBrush.current) return;
    brushRef.current?.updateBrush(view);
    updateBrush.current = false;
  }, [view]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <FluxMain
        width={width - marginLeft}
        height={height - brushHeight - 40}
        left={marginLeft}
        view={view}
        setView={(setter) => {
          updateBrush.current = true;
          setView((previous) =>
            // Cannot call updateBrush here because setters need to be pure
            brushRef.current?.clampView(setter(previous))
          );
        }}
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
