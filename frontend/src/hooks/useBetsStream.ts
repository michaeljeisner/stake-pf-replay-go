import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EventsOn } from '@/lib/wails-events';
import { Tail } from '@desktop-bindings/internal/livehttp/livemodule';
import type { LiveBet, LiveBetPage } from '@/types/live';
import { mergeRows, normalizeLiveBet, type RawLiveBet } from '@/lib/live-normalizers';
import { loadBetsPageViaBridge } from '@/lib/live-api';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';

export interface UseBetsStreamOptions {
  streamId: string;
  minMultiplier?: number;
  pageSize?: number;
  pollMs?: number;
  order?: 'asc' | 'desc';
  apiBase?: string;
  onNewRows?: (rows: LiveBet[]) => void;
}

type InfinitePages = {
  pages: { rows: LiveBet[]; total: number | null }[];
  pageParams: unknown[];
};

async function fetchHttpPage(options: {
  apiBase: string;
  streamId: string;
  minMultiplier: number;
  order: 'asc' | 'desc';
  pageSize: number;
  offset: number;
}): Promise<{ rows: RawLiveBet[]; total: number | null }> {
  const { apiBase, streamId, minMultiplier, order, pageSize, offset } = options;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String(offset),
    order: order === 'desc' ? 'nonce_desc' : 'nonce_asc',
  });
  if (minMultiplier > 0) {
    params.set('min_multiplier', String(minMultiplier));
  }
  const response = await fetch(`${apiBase}/live/streams/${streamId}/bets?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { rows?: RawLiveBet[]; total?: number | null };
  return {
    rows: payload.rows ?? [],
    total: payload.total ?? null,
  };
}

async function fetchTailPage(options: {
  apiBase?: string;
  streamId: string;
  sinceId: number;
  limit: number;
}): Promise<{ rows: RawLiveBet[]; lastId: number }> {
  const { apiBase, streamId, sinceId, limit } = options;
  if (apiBase) {
    try {
      const params = new URLSearchParams({ since_id: String(sinceId), limit: String(limit) });
      const response = await fetch(`${apiBase}/live/streams/${streamId}/tail?${params.toString()}`);
      if (response.ok) {
        const payload = (await response.json()) as { rows?: RawLiveBet[]; lastID?: number };
        return {
          rows: (payload.rows ?? []) as RawLiveBet[],
          lastId: typeof payload.lastID === 'number' ? payload.lastID : sinceId,
        };
      }
    } catch (err) {
      console.warn('HTTP tail request failed, falling back to Wails bridge.', err);
    }
  }

  await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'Tail'], { timeoutMs: 10_000 });
  const result = await callWithRetry(() => Tail(streamId, sinceId, limit), 3, 200);
  return {
    rows: (result?.rows ?? []) as RawLiveBet[],
    lastId: typeof result?.lastID === 'number' ? result.lastID : sinceId,
  };
}

export function useBetsStream({
  streamId,
  minMultiplier = 0,
  pageSize = 200,
  pollMs = 1500,
  order = 'desc',
  apiBase,
  onNewRows,
}: UseBetsStreamOptions) {
  const queryClient = useQueryClient();
  const pendingRef = useRef<LiveBet[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [bufferVersion, setBufferVersion] = useState(0);
  const lastKnownIdRef = useRef(0);

  const queryKey = useMemo(
    () => ['live-bets', streamId, { minMultiplier, pageSize, order, source: apiBase ?? 'wails' }] as const,
    [streamId, minMultiplier, pageSize, order, apiBase],
  );

  const updateLastKnownId = useCallback((rows: LiveBet[]) => {
    if (!rows.length) return;
    let maxId = lastKnownIdRef.current;
    for (const row of rows) {
      if (row.id > maxId) {
        maxId = row.id;
      }
    }
    lastKnownIdRef.current = maxId;
  }, []);

  const query = useInfiniteQuery<LiveBetPage>({
    queryKey,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.rows.length < pageSize) {
        return undefined;
      }
      return pages.length * pageSize;
    },
    queryFn: async ({ pageParam }) => {
      const offset = Number(pageParam ?? 0);
      if (apiBase) {
        try {
          const httpResult = await fetchHttpPage({
            apiBase,
            streamId,
            minMultiplier,
            order,
            pageSize,
            offset,
          });
          const page = {
            rows: httpResult.rows.map(normalizeLiveBet),
            total: httpResult.total,
          };
          updateLastKnownId(page.rows);
          return page;
        } catch (err) {
          console.warn('HTTP live bets request failed, falling back to Wails bridge.', err);
        }
      }
      const pageResult = await loadBetsPageViaBridge({
        streamId,
        minMultiplier,
        order,
        pageSize,
        offset,
      });
      updateLastKnownId(pageResult.rows);
      return pageResult;
    },
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
  });

  const flushPending = useCallback(() => {
    if (!pendingRef.current.length) return [] as LiveBet[];
    const pending = pendingRef.current;
    pendingRef.current = [];
    queryClient.setQueryData(queryKey, (current?: InfinitePages) => {
      if (!current) return current;
      const [first, ...rest] = current.pages;
      const nextFirst = {
        total: first?.total ?? null,
        rows: mergeRows(first?.rows ?? [], pending, order),
      };
      return {
        ...current,
        pages: [nextFirst, ...rest],
      };
    });
    setBufferVersion((version) => version + 1);
    return pending;
  }, [order, queryClient, queryKey]);

  useEffect(() => {
    pendingRef.current = [];
    lastKnownIdRef.current = 0;
    setBufferVersion((version) => version + 1);
  }, [streamId, minMultiplier, order]);

  useEffect(() => {
    let cancelled = false;
    let fetchingTail = false;

    const handleTailFetch = async () => {
      if (cancelled || fetchingTail) return;
      fetchingTail = true;
      try {
        const { rows: rawRows, lastId } = await fetchTailPage({
          apiBase,
          streamId,
          sinceId: lastKnownIdRef.current,
          limit: Math.max(pageSize, 500),
        });
        if (cancelled) return;
        if (!rawRows.length) {
          setIsStreaming(true);
          return;
        }
        const normalized = rawRows
          .map(normalizeLiveBet)
          .filter((bet) => bet.round_result >= minMultiplier);
        if (!normalized.length) {
          lastKnownIdRef.current = Math.max(lastKnownIdRef.current, lastId);
          setIsStreaming(true);
          return;
        }
        normalized.sort((a, b) => {
          if (b.nonce !== a.nonce) return b.nonce - a.nonce;
          return b.id - a.id;
        });
        updateLastKnownId(normalized);
        if (onNewRows) {
          onNewRows(normalized);
        }
        lastKnownIdRef.current = Math.max(lastKnownIdRef.current, lastId);
        pendingRef.current = mergeRows(pendingRef.current, normalized, order);
        setBufferVersion((version) => version + 1);
        setIsStreaming(true);
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to fetch live tail bets', err);
          setIsStreaming(false);
        }
      } finally {
        fetchingTail = false;
      }
    };

    const offRows = EventsOn(`live:newrows:${streamId}`, handleTailFetch);
    const offStatus = EventsOn(`live:status:${streamId}`, (status: 'connected' | 'disconnected') => {
      setIsStreaming(status === 'connected');
    });

    return () => {
      cancelled = true;
      offRows();
      offStatus();
    };
  }, [apiBase, fetchTailPage, minMultiplier, order, pageSize, streamId, updateLastKnownId]);

  const prepend = useCallback(
    (rows: LiveBet[]) => {
      if (!rows.length) return;
      queryClient.setQueryData(queryKey, (current?: InfinitePages) => {
        if (!current) return current;
        const [first, ...rest] = current.pages;
        const nextFirst = {
          total: first?.total ?? null,
          rows: mergeRows(first?.rows ?? [], rows, order),
        };
        return {
          ...current,
          pages: [nextFirst, ...rest],
        };
      });
    },
    [order, queryClient, queryKey],
  );

  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];

  return {
    rows,
    flushPending,
    pendingCount: pendingRef.current.length,
    bufferVersion,
    prepend,
    isStreaming,
    ...query,
  };
}
