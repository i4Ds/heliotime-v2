import { Text } from '@visx/text';
import { D3Scale } from '@visx/scale';
import { THEME } from '@/app/theme';
import { HorizontalBand } from '@/components/svg/HorizontalBand';
import { PositionSizeProps } from '@/components/svg/base';
import React from 'react';

export interface FlareClassBandsProps extends PositionSizeProps {
  scale: D3Scale<number>;
}

// eslint-disable-next-line prefer-arrow-callback
export default React.memo(function FlareClassBands({
  width,
  height,
  top = 0,
  left = 0,
  scale,
}: FlareClassBandsProps) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((index) => (
        <HorizontalBand
          key={index}
          scale={scale}
          from={10 ** (-7 + index)}
          to={10 ** (-8 + index)}
          top={top}
          left={left}
          width={width}
          height={height}
          className={index % 2 ? 'fill-bg' : 'fill-bg-0'}
          label={'ABCMX'[index]}
          labelOffset={width + 12}
          labelProps={{ textAnchor: 'start', className: 'fill-text' }}
        />
      ))}
      <Text
        x={left + width + 38}
        y={top + height / 2}
        verticalAnchor="end"
        textAnchor="middle"
        angle={90}
        className="fill-text"
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...THEME.textSize.sm}
      >
        Xray Flare Class
      </Text>
    </>
  );
});
