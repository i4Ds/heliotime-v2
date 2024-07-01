// From https://github.com/TanStack/query/tree/e100e5d0dec754e6e167f836942b804d5a6717f4/examples/react/nextjs-app-prefetching
import { QueryClient, defaultShouldDehydrateQuery, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
      dehydrate: {
        // include pending queries in dehydration
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // Server: always make a new query client to avoid sharing sensitive cache entries between users.
  if (isServer) return makeQueryClient();
  // Browser: make a new query client if we don't already have one
  // This is very important, so we don't re-make a new client if React
  // suspends during the initial render. This may not be needed if we
  // have a suspense boundary BELOW the creation of the query client.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
