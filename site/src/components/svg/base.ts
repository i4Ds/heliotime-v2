export interface PositionSizeProps {
  width: number;
  height: number;
  top?: number;
  left?: number;
}

export interface Margin {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export function applyMargin(
  { width, height, top = 0, left = 0 }: PositionSizeProps,
  {
    top: marginTop = 0,
    bottom: marginBottom = 0,
    left: marginLeft = 0,
    right: marginRight = 0,
  }: Margin
): Required<PositionSizeProps> {
  return {
    width: width - marginLeft - marginRight,
    height: height - marginTop - marginBottom,
    top: top + marginTop,
    left: left + marginLeft,
  };
}
