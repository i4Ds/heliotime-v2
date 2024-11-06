import { THEME, toPx } from '@/app/theme';
import { BarRounded } from '@visx/shape';
import { getStringWidth, Text, TextProps } from '@visx/text';

const ANCHOR_POSITION = {
  start: 0,
  middle: 0.5,
  end: 1,
} as const;

export interface TextRectProps extends TextProps {
  textAnchor?: keyof typeof ANCHOR_POSITION;
  rectClassName?: string;

  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;

  cornerRadius?: number;
  rounded?: boolean;
  roundTop?: boolean;
  roundBottom?: boolean;
  roundLeft?: boolean;
  roundRight?: boolean;
  roundTopLeft?: boolean;
  roundTopRight?: boolean;
  roundBottomLeft?: boolean;
  roundBottomRight?: boolean;
}

/**
 * Like {@link Text}, but with a background rectangle.
 * Might not always correctly position the rect because Text's behavior is very complex.
 */
export function TextRect({
  // Text props
  x = 0,
  y = 0,
  dx = 0,
  dy = 0,
  textAnchor = 'start',
  verticalAnchor = 'start',
  style = {},
  children,
  // Rect props
  rectClassName = 'fill-bg-0',
  padding = undefined,
  paddingX = padding ?? THEME.spacePx(3),
  paddingY = padding ?? THEME.spacePx(1.5),
  paddingTop = paddingY,
  paddingBottom = paddingY,
  paddingLeft = paddingX,
  paddingRight = paddingX,
  cornerRadius = toPx(THEME.borderRadius.sm),
  rounded = true,
  roundTop = rounded,
  roundBottom = rounded,
  roundLeft = rounded,
  roundRight = rounded,
  roundTopLeft = roundTop || roundLeft,
  roundTopRight = roundTop || roundRight,
  roundBottomLeft = roundBottom || roundLeft,
  roundBottomRight = roundBottom || roundRight,
  // Text props
  ...props
}: TextRectProps) {
  const text = children?.toString() ?? '';
  const trueStyle = { ...style, ...props };
  const fontSize = toPx(trueStyle.fontSize ?? 0);
  const labelWidth = getStringWidth(text, trueStyle) ?? 0;

  const labelTopLeftX = toPx(x) + toPx(dx) - ANCHOR_POSITION[textAnchor] * labelWidth;
  const labelTopLeftY = toPx(y) + toPx(dy) - ANCHOR_POSITION[verticalAnchor] * fontSize;
  return (
    <>
      <BarRounded
        x={labelTopLeftX - paddingLeft}
        y={labelTopLeftY - paddingTop}
        width={labelWidth + paddingLeft + paddingRight}
        height={fontSize + paddingTop + paddingBottom}
        className={rectClassName}
        radius={cornerRadius}
        topLeft={roundTopLeft}
        topRight={roundTopRight}
        bottomLeft={roundBottomLeft}
        bottomRight={roundBottomRight}
      />
      <Text
        x={x}
        y={y}
        verticalAnchor={verticalAnchor}
        textAnchor={textAnchor}
        style={style}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...props}
        // Force single-line text because we only support single-line texts
        width={undefined}
      >
        {text}
      </Text>
    </>
  );
}
