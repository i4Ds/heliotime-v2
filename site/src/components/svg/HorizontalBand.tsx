import { AnyD3Scale, ScaleInput } from '@visx/scale';
import { Text, TextProps } from '@visx/text';
import { PositionSizeProps } from './base';

type BandScale = AnyD3Scale;

interface HorizontalBandProps<Scale extends BandScale>
  extends Omit<React.SVGProps<SVGRectElement>, 'scale' | 'x' | 'y' | 'width' | 'height'>,
    PositionSizeProps {
  scale: Scale;
  from: ScaleInput<Scale>;
  to: ScaleInput<Scale>;
  label?: string;
  /**
   * Offset in pixels of the label from the left side.
   */
  labelOffset?: number;
  /**
   * What ratio of the entire band needs to be visible for the label to be shown.
   */
  showLabelRelativeThreshold?: number;
  /**
   * How high the visible part of the band needs to be for the label to be shown.
   */
  showLabelAbsoluteThreshold?: number;
  labelProps?: Omit<TextProps, 'x' | 'y' | 'verticalAnchor'>;
}

export function HorizontalBand<Scale extends BandScale>({
  scale,
  from,
  to,
  top = 0,
  left = 0,
  width,
  height,
  label,
  labelOffset = 5,
  labelProps = {},
  showLabelAbsoluteThreshold = Math.max(height * 0.1, 30),
  ...rectProps
}: HorizontalBandProps<Scale>) {
  const y0 = scale(from);
  const y1 = scale(to);
  if (height < y0 || y1 < 0) return undefined;
  const clippedY0 = Math.max(0, y0);
  const clippedY1 = Math.min(height, y1);
  const clippedHeight = clippedY1 - clippedY0;
  const showLabel = clippedHeight > showLabelAbsoluteThreshold;
  return (
    <svg
      x={top}
      y={clippedY0 + left}
      width={width}
      height={clippedHeight}
      className="overflow-visible"
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={clippedHeight}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...rectProps}
      />
      {showLabel && (
        <Text
          x={labelOffset}
          y={clippedHeight / 2}
          verticalAnchor="middle"
          // eslint-disable-next-line react/jsx-props-no-spreading
          {...labelProps}
        >
          {label}
        </Text>
      )}
    </svg>
  );
}
