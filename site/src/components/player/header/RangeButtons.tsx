import React from 'react';
import { expCeil } from '@/utils/math';
import { usePlayerRenderState, usePlayerState } from '../state/state';

function InternalRangeButtons({ rangeSize }: { rangeSize: number }) {
  const state = usePlayerState();
  return (
    <>
      {(
        [
          [1 * 60 * 60 * 1000, '1H', 'last hour'],
          [24 * 60 * 60 * 1000, '1D', 'last day'],
          [7 * 24 * 60 * 60 * 1000, '1W', 'last week'],
          [30 * 24 * 60 * 60 * 1000, '1M', 'last month'],
          [365 * 24 * 60 * 60 * 1000, '1Y', 'last year'],
        ] as const
      )
        .filter(([viewSize]) => rangeSize > viewSize)
        .map(([viewSize, label, tooltip]) => (
          <button
            key={label}
            type="button"
            className="btn-tiny"
            onClick={() => state.setFollowView(viewSize)}
            title={`View ${tooltip}`}
          >
            {label}
          </button>
        ))}
      <button
        type="button"
        className="btn-tiny"
        onClick={() => state.setView(state.range(), true)}
        title="View everything"
      >
        All
      </button>
    </>
  );
}

const MemoRangeButtons = React.memo(InternalRangeButtons);

export function RangeButtons() {
  const { range } = usePlayerRenderState();
  return <MemoRangeButtons rangeSize={expCeil(range[1] - range[0], 1.1)} />;
}
