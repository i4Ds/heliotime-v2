import { NumberRange } from '@/utils/range';
import { useMemo } from 'react';
import { useWindowEvent } from '@/utils/useWindowEvent';
import { localPoint } from '@visx/event';
import { useVolatile, useVolatileState } from '@/utils/useVolatile';
import { limitView } from '@/utils/panZoom';
import { PointerStack } from '@/utils/pointer';
import { Line } from '@visx/shape';
import { PositionSizeProps } from './base';

const TOUCH_EDGE_WIDTH = 15;

interface BrushHandelProps extends Omit<React.SVGProps<SVGRectElement>, 'fill' | 'width' | 'x'> {
  x: number;
  height: number;
  isActive: boolean;
}

function BrushHandel({ x, height, isActive, ...rest }: BrushHandelProps) {
  return (
    <>
      <Line
        from={{ x }}
        to={{ x, y: height }}
        className={`stroke-text ${isActive ? 'stroke-2' : ''}`}
      />
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
  /** Current position of brush. */
  view: BrushView;
  /**
   * Smallest allowed view size.
   * @default 0
   */
  minSize?: number;
  /**
   * Wether to allow dragging / drawing the view beyond the brush bounds.
   * @default false
   */
  allowOverflow?: boolean;
  /**
   * Size of created view when the brush region is clicked on.
   * `undefined` makes the brush disappear (zoom out completely).
   * @default undefined
   */
  clickViewSize?: number;
  /**
   * Whether to process the provided pointer event.
   * @default always true
   */
  pointerFilter?: (event: PointerEvent) => boolean;
  /**
   * Event called when a brush interaction starts.
   */
  onBrushStart?: (isDrawingNew: boolean) => void;
  /**
   * Event called when the brush view changes.
   */
  onBrush: (view: BrushView) => void;
  /**
   * Event called when the brush interactions stops.
   * Is called after `onBrush`.
   */
  onBrushEnd?: (view: BrushView) => void;
}

export default function Brush({
  width,
  height,
  top,
  left,
  view,
  minSize: rawMinSize = 0,
  allowOverflow = false,
  clickViewSize,
  pointerFilter = () => true,
  onBrushStart = () => {},
  onBrush,
  onBrushEnd = () => {},
}: BrushProps) {
  const minSize = Math.min(width, rawMinSize);
  const [renderAction, getAction, setAction] = useVolatileState<Action>();
  const [getVolatileView, setVolatileView, syncVolatileView] = useVolatile(view, onBrush);
  const setLimitedView = (newView: NonNullable<BrushView>) =>
    setVolatileView(limitView(newView, allowOverflow ? undefined : [0, width], minSize));
  const stack = useMemo(() => new PointerStack<number>(1), []);

  const startAction = (newMode: Move | StartDraw) => (event: React.PointerEvent) => {
    if (!pointerFilter(event.nativeEvent)) return;
    if (!stack.maybeAdd(event, event.clientX)) return;
    setAction(newMode);
    syncVolatileView();
    onBrushStart(newMode === START_DRAW);
  };

  useWindowEvent('pointermove', (event: PointerEvent) => {
    const interaction = getAction();
    const volatileView = getVolatileView();

    // Handle idle
    if (interaction === undefined) return;

    // Track mouse delta (event.movementX is discouraged)
    const lastX = stack.get(event);
    if (lastX === undefined) return;
    stack.maybeUpdate(event, event.clientX);
    let delta = event.clientX - lastX;

    // Handle start draw action
    if (interaction === START_DRAW) {
      if (delta === 0) return;
      const point = localPoint(event);
      if (point === null) return;
      const newSize = Math.max(minSize, Math.abs(delta));
      setLimitedView([point.x - (delta < 0 ? 0 : newSize), point.x + (delta > 0 ? 0 : newSize)]);
      setAction(delta > 0 ? Move.RIGHT : Move.LEFT);
      return;
    }

    // Handle move action
    if (delta === 0 || volatileView === undefined) return;
    // Prevent movement beyond border
    if (!allowOverflow)
      if (delta < 0)
        delta = Math.max(-(interaction.left ? volatileView[0] : volatileView[1] - minSize), delta);
      else if (delta > 0)
        delta = Math.min(
          width - (interaction.right ? volatileView[1] : volatileView[0] + minSize),
          delta
        );
    // Create updated view
    let newView: BrushView = [
      volatileView[0] + (interaction.left ? delta : 0),
      volatileView[1] + (interaction.right ? delta : 0),
    ];
    // Switch sides if view got too small
    const missingSize = minSize - (newView[1] - newView[0]);
    if (missingSize > 0) {
      newView = [
        Math.min(...newView) - (interaction.right ? missingSize : 0),
        Math.max(...newView) + (interaction.left ? missingSize : 0),
      ];
      setAction(interaction.left ? Move.RIGHT : Move.LEFT);
    }
    setVolatileView(newView);
  });

  const endAction = (event: PointerEvent) => {
    if (!stack.maybeRemove(event)) return;
    const interaction = getAction();
    if (interaction === undefined) return;
    if (interaction === START_DRAW) {
      if (clickViewSize === undefined) {
        setVolatileView(undefined);
      } else {
        const point = localPoint(event);
        if (point === null) return;
        const radius = clickViewSize / 2;
        setLimitedView([point.x - radius, point.x + radius]);
      }
    }
    setAction(undefined);
    onBrushEnd(getVolatileView());
  };
  useWindowEvent('pointerup', endAction);
  useWindowEvent('pointercancel', endAction);

  return (
    <svg x={top} y={left} width={width} height={height}>
      <rect
        width={width}
        height={height}
        fill="transparent"
        onPointerDown={startAction(START_DRAW)}
      />
      {view && (
        <>
          <rect
            x={view[0]}
            width={view[1] - view[0]}
            height={height}
            className="fill-text opacity-10 cursor-move"
            onPointerDown={startAction(Move.BOTH)}
          />
          <BrushHandel
            x={view[0]}
            height={height}
            isActive={renderAction instanceof Move && renderAction.left && !renderAction.right}
            onPointerDown={startAction(Move.LEFT)}
          />
          <BrushHandel
            x={view[1]}
            height={height}
            isActive={renderAction instanceof Move && !renderAction.left && renderAction.right}
            onPointerDown={startAction(Move.RIGHT)}
          />
        </>
      )}
    </svg>
  );
}
