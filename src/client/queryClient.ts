import { QueryClient } from "@tanstack/react-query";

/**
 * The one query client the app mounts. Every read is fresh on mount and on
 * window focus (a board is a live reading, and a stale one would lie), a
 * failed read is retried once, and nothing is persisted between loads.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 0, refetchOnWindowFocus: true, retry: 1 },
    },
  });
}
