import {
  faAngleLeft,
  faAngleRight,
  faAnglesLeft,
  faAnglesRight,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Calendar as BaseCalendar, CalendarProps } from 'react-calendar';
import type { Range } from 'react-calendar/dist/esm/shared/types.js';

export type { CalendarProps } from 'react-calendar';
export type { View as CalendarView } from 'react-calendar/dist/esm/shared/types.js';

export type CalendarRange = Range<Date | null>;

/**
 * Styling is in globals.css
 */
export function Calendar(props: CalendarProps) {
  return (
    <BaseCalendar
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
      nextLabel={<FontAwesomeIcon icon={faAngleRight} />}
      next2Label={<FontAwesomeIcon icon={faAnglesRight} />}
      prevLabel={<FontAwesomeIcon icon={faAngleLeft} />}
      prev2Label={<FontAwesomeIcon icon={faAnglesLeft} />}
      // We do not currently support localization
      locale="en-US"
      calendarType="iso8601"
    />
  );
}
