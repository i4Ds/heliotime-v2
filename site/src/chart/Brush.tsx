import { NumberRange } from '@/utils/range';
import { useCallback, useRef } from 'react';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { localPoint } from '@visx/event';
import { useVolatile, useVolatileState } from '@/utils/useVolatile';
import { PositionSizeProps } from './base';

const TOUCH_EDGE_WIDTH = 15;

interface BrushHandelProps extends Omit<React.SVGProps<SVGRectElement>, 'fill' | 'width' | 'x'> {
  x: number;
  height: number;
  isActive: boolean;
}

function BrushHandel({ x, height, isActive, ...rest }: BrushHandelProps) {
  const strokeWidth = isActive ? 2 : 1;
  return (
    <>
      <rect x={x - strokeWidth / 2} width={strokeWidth} height={height} />
      <rect
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...rest}
        x={x - TOUCH_EDGE_WIDTH / 2}
        width={TOUCH_EDGE_WIDTH}
        height={height}
        className="cursor-col-resize"
        fill="transparent"
      />
    </>
  );
}

export type BrushView = Readonly<NumberRange> | undefined;

const START_DRAW = Symbol('Draw mode token');
type StartDraw = typeof START_DRAW;

class Move {
  static readonly BOTH = new Move(true, true);

  static readonly LEFT = new Move(true, false);

  static readonly RIGHT = new Move(false, true);

  private constructor(
    readonly left: boolean,
    readonly right: boolean
  ) {}
}

type Action = Move | StartDraw;

export interface BrushProps extends PositionSizeProps {
  view: BrushView;
  onBrush: (view: BrushView) => void;
}

export default function Brush({ width, height, top, left, view, onBrush }: BrushProps) {
  const [renderAction, getAction, setAction] = useVolatileState<Action>();
  const [getVolatileView, setVolatileView, syncVolatileView] = useVolatile(view, onBrush);

  const startAction = useCallback(
    (newMode: Move | StartDraw) => {
      setAction(newMode);
      syncVolatileView();
    },
    [setAction, syncVolatileView]
  );

  const lastXRef = useRef<number>();
  useWindowEvent('mousemove', (event: MouseEvent) => {
    const volatileView = getVolatileView();
    const interaction = getAction();

    // Track mouse delta (event.movementX is discouraged)
    const lastX = lastXRef.current ?? event.x;
    lastXRef.current = event.x;
    let delta = event.x - lastX;

    // Handle idle
    if (interaction === undefined) return;

    // Handle start draw action
    if (interaction === START_DRAW) {
      if (delta === 0) return;
      const point = localPoint(event);
      if (point === null) return;
      setVolatileView(delta > 0 ? [point.x - delta, point.x] : [point.x, point.x - delta]);
      setAction({ right: delta > 0, left: delta < 0 });
      return;
    }

    // Handle move action
    if (delta === 0 || volatileView === undefined) return;
    // Prevent movement beyond border
    if (delta < 0 && interaction.left) delta = Math.max(-volatileView[0], delta);
    if (delta > 0 && interaction.right) delta = Math.min(width - volatileView[1], delta);
    // Create updated view
    let newView: BrushView = [
      volatileView[0] + (interaction.left ? delta : 0),
      volatileView[1] + (interaction.right ? delta : 0),
    ];
    // Switch sides if one side was dragged over the other
    if (newView[0] > newView[1]) {
      newView = [newView[1], newView[0]];
      setAction({
        left: !interaction.left,
        right: !interaction.right,
      });
    }
    setVolatileView(newView);
  });

  useWindowEvent('mouseup', () => {
    const interaction = getAction();
    if (interaction === undefined) return;
    if (interaction === START_DRAW) setVolatileView(undefined);
    setAction(undefined);
  });

  return (
    <svg x={top} y={left} width={width} height={height} className="overflow-visible">
      <rect
        width={width}
        height={height}
        fill="transparent"
        onMouseDown={() => startAction(START_DRAW)}
      />
      {view && (
        <>
          <rect
            x={view[0]}
            width={view[1] - view[0]}
            height={height}
            className="fill-blue-300 opacity-40 cursor-move"
            onMouseDown={() => startAction(Move.BOTH)}
          />
          <BrushHandel
            x={view[0]}
            height={height}
            isActive={renderAction instanceof Move && renderAction.left && !renderAction.right}
            onMouseDown={() => startAction(Move.LEFT)}
          />
          <BrushHandel
            x={view[1]}
            height={height}
            isActive={renderAction instanceof Move && !renderAction.left && renderAction.right}
            onMouseDown={() => startAction(Move.RIGHT)}
          />
        </>
      )}
    </svg>
  );
}
