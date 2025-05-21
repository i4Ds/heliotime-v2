import React, { Suspense, useMemo } from 'react';
import { expCeil } from '@/utils/math';
import { faArrowsLeftRight } from '@fortawesome/free-solid-svg-icons';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePlayerRenderState, usePlayerState } from '../state/state';
import IconButton from './IconButton';

interface Range {
  sizeMs: number;
  shortName: string;
  longName: string;
  tooltip: string;
}

const RANGES: Range[] = [
  { sizeMs: 1 * 60 * 60 * 1000, shortName: '1H', longName: '1 hour', tooltip: 'last hour' },
  { sizeMs: 24 * 60 * 60 * 1000, shortName: '1D', longName: '1 day', tooltip: 'last day' },
  { sizeMs: 7 * 24 * 60 * 60 * 1000, shortName: '1W', longName: '1 week', tooltip: 'last week' },
  { sizeMs: 30 * 24 * 60 * 60 * 1000, shortName: '1M', longName: '1 month', tooltip: 'last month' },
  { sizeMs: 365 * 24 * 60 * 60 * 1000, shortName: '1Y', longName: '1 year', tooltip: 'last year' },
];

function useRanges(): Range[] {
  const { range } = usePlayerRenderState();
  const rangeSize = expCeil(range[1] - range[0], 1.1);
  return useMemo(() => RANGES.filter(({ sizeMs }) => rangeSize > sizeMs), [rangeSize]);
}

interface InternalProps {
  ranges: Range[];
}

function InternalRangeDropdown({ className, ranges }: RangeDropdownProps & InternalProps) {
  const state = usePlayerState();
  const button = (
    <IconButton icon={faArrowsLeftRight} title="View range" square className={className} />
  );
  return (
    <Suspense fallback={button}>
      <Popover>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent side="top" className="w-auto !p-2 flex flex-col overflow-hidden">
          {ranges.map(({ sizeMs, longName, tooltip }) => (
            <PopoverClose
              key={sizeMs}
              title={tooltip}
              type="button"
              className="btn-text text-left"
              onClick={() => {
                state.setFollowView(sizeMs);
                state.commitToHistory();
              }}
            >
              {longName}
            </PopoverClose>
          ))}
          <PopoverClose
            title="View everything"
            type="button"
            className="btn-text text-left"
            onClick={() => {
              state.setView(state.range());
              state.commitToHistory();
            }}
          >
            All
          </PopoverClose>
        </PopoverContent>
      </Popover>
    </Suspense>
  );
}

const MemoRangeDropdown = React.memo(InternalRangeDropdown);

export interface RangeDropdownProps {
  className?: string;
}

export function RangeDropdown(props: RangeDropdownProps) {
  const ranges = useRanges();
  // eslint-disable-next-line react/jsx-props-no-spreading
  return <MemoRangeDropdown {...props} ranges={ranges} />;
}

function InternalRangeButtons({ buttonsClassName, ranges }: RangeButtonsProps & InternalProps) {
  const state = usePlayerState();
  return (
    <>
      {ranges.map(({ sizeMs, shortName, tooltip }) => (
        <button
          key={shortName}
          type="button"
          className={buttonsClassName}
          onClick={() => {
            state.setFollowView(sizeMs);
            state.commitToHistory();
          }}
          title={`View ${tooltip}`}
        >
          {shortName}
        </button>
      ))}
      <button
        type="button"
        className={buttonsClassName}
        onClick={() => {
          state.setView(state.range());
          state.commitToHistory();
        }}
        title="View everything"
      >
        All
      </button>
    </>
  );
}

const MemoRangeButtons = React.memo(InternalRangeButtons);

interface RangeButtonsProps {
  buttonsClassName?: string;
}

export function RangeButtons(props: RangeButtonsProps) {
  const ranges = useRanges();
  // eslint-disable-next-line react/jsx-props-no-spreading
  return <MemoRangeButtons {...props} ranges={ranges} />;
}
