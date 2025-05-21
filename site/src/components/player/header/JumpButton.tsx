import { faCalendarDay } from '@fortawesome/free-solid-svg-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { OnArgs } from 'react-calendar';
import { Value } from 'react-calendar/dist/esm/shared/types.js';
import IconButton from './IconButton';
import { Calendar, CalendarRange } from '../../ui/Calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { usePlayerRenderState, usePlayerState } from '../state/state';

/**
 * Interprets local time as utc time.
 * The calender always uses local time but we always use utc time.
 */
function toUtc(date: Date): number {
  return date.getTime() - date.getTimezoneOffset() * 60 * 1000;
}

/**
 * Interprets utc time as local time.
 */
function fromUtc(timestamp: number): Date {
  const offset = new Date(timestamp).getTimezoneOffset() * 60 * 1000;
  return new Date(timestamp + offset);
}

function JumpCalendar({ onViewSet }: { onViewSet: () => void }) {
  const state = usePlayerState();
  const { range, view } = usePlayerRenderState();
  const defaultCalendarView = useMemo(
    () => {
      const viewSize = view[1] - view[0];
      return viewSize < 31 * 24 * 60 * 60 * 1000
        ? 'month'
        : viewSize < 366 * 24 * 60 * 60 * 1000
          ? 'year'
          : viewSize < 10 * 366 * 24 * 60 * 60 * 1000
            ? 'decade'
            : 'century';
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [markedView, setMarkedView] = useState<CalendarRange>(() => [
    fromUtc(view[0]),
    // Marked view's end date is exclusive, so we need to subtract one millisecond.
    fromUtc(view[1] - 1),
  ]);
  const onMarkedViewChange = useCallback(
    (value: Value) => {
      if (!Array.isArray(value) || value[0] === null) return;
      setMarkedView(value);

      // Set actual view to marked view
      const startUtc = toUtc(value[0]);
      let endUtc: Date;
      if (value[1] === null) {
        endUtc = new Date(startUtc);
        endUtc.setUTCDate(endUtc.getUTCDate() + 1);
      } else {
        // Marked view's end date is exclusive, so we need to add one millisecond.
        endUtc = new Date(toUtc(value[1]) + 1);
      }
      state.setView([startUtc, endUtc.getTime()]);
      onViewSet();
    },
    [onViewSet, state]
  );
  const onCalendarViewChange = useCallback(
    ({ activeStartDate, view: newView, value }: OnArgs) => {
      if (activeStartDate === null || !Array.isArray(value)) return;
      // Do not change the view while selecting a range
      if (value[0] !== null && value[1] === null) return;

      // Set actual view to calendar view
      const startUtc = toUtc(activeStartDate);
      const endUtc = new Date(startUtc);
      switch (newView) {
        case 'century': {
          endUtc.setUTCFullYear(endUtc.getUTCFullYear() + 100);
          break;
        }
        case 'decade': {
          endUtc.setUTCFullYear(endUtc.getUTCFullYear() + 10);
          break;
        }
        case 'year': {
          endUtc.setUTCFullYear(endUtc.getUTCFullYear() + 1);
          break;
        }
        case 'month': {
          endUtc.setUTCMonth(endUtc.getUTCMonth() + 1);
          break;
        }
        default: {
          return;
        }
      }
      state.setView([startUtc, endUtc.getTime()]);
      onViewSet();

      // Remove marked view as entire view is active
      // eslint-disable-next-line unicorn/no-null
      setMarkedView([null, null]);
    },
    [onViewSet, state]
  );

  return (
    <Calendar
      className={markedView[0] === null && markedView[1] === null ? 'entire-view-active' : ''}
      value={markedView}
      defaultView={defaultCalendarView}
      minDate={fromUtc(range[0])}
      maxDate={fromUtc(range[1])}
      // Fix week count to avoid the header from jumping around
      showFixedNumberOfWeeks
      selectRange
      allowPartialRange
      // Does not work as intended and bugs out the calendar.
      // See: https://github.com/wojtekmaj/react-calendar/issues/611
      // goToRangeStartOnSelect={false}
      onChange={onMarkedViewChange}
      onActiveStartDateChange={onCalendarViewChange}
      onViewChange={onCalendarViewChange}
    />
  );
}

export interface JumpButtonProps {
  className?: string;
}

export default function JumpButton({ className }: JumpButtonProps) {
  // Commit to history when the calendar is closed and the view was set.
  const state = usePlayerState();
  const wasViewSet = useRef(false);
  const onViewSet = useCallback(() => {
    wasViewSet.current = true;
  }, []);
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        wasViewSet.current = false;
        return;
      }
      if (!wasViewSet.current) return;
      wasViewSet.current = false;
      state.commitToHistory();
    },
    [state]
  );
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton icon={faCalendarDay} title="Jump to date" square className={className} />
      </PopoverTrigger>
      <PopoverContent className="w-auto" side="top">
        <JumpCalendar onViewSet={onViewSet} />
      </PopoverContent>
    </Popover>
  );
}
