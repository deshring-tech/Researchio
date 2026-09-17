import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * MODULE: hooks/useRefreshWhile
 *
 * Purpose
 *   Re-render the current route on an interval while background work runs.
 *
 * Why polling
 *   Ingestion and claim checks report progress through the database. Refreshing
 *   the server-rendered route is a few lines, survives server restarts, and
 *   stops costing anything the moment the work settles — a websocket would buy
 *   seconds of latency on jobs that take tens of seconds.
 *
 * Client-only: call from a Client Component.
 */
export function useRefreshWhile(active: boolean, intervalMs = 4_000): void {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
}
