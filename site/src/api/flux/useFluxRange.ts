import { queryOptions } from '@tanstack/react-query';
import { fetchFluxRange } from './api';

export function fluxRangeQueryOptions() {
  return queryOptions({
    queryKey: ['flux-range'],
    queryFn: ({ signal }) => fetchFluxRange(signal),
  });
}
