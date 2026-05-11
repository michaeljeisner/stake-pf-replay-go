import { normalizeLiveBet, type RawLiveBet } from '@/lib/live-normalizers';
import type { LiveBetPage } from '@/types/live';
import { callWithRetry } from '@/lib/wails';
import { GetBetsPage } from '@desktop-bindings/internal/livehttp/livemodule';

export async function loadBetsPageViaBridge(options: {
  streamId: string;
  minMultiplier: number;
  order: 'asc' | 'desc';
  pageSize: number;
  offset: number;
}): Promise<LiveBetPage> {
  const { streamId, minMultiplier, order, pageSize, offset } = options;
  type RawPage = {
    rows?: unknown[];
    total?: number;
  };

  const result = await callWithRetry<RawPage>(
    () => GetBetsPage(streamId, minMultiplier, order, pageSize, offset),
    4,
    250,
  );
  const rawRows: RawLiveBet[] = Array.isArray(result?.rows) ? (result.rows as RawLiveBet[]) : [];
  const rows = rawRows.map(normalizeLiveBet);
  const total = typeof result?.total === 'number' ? result.total : null;
  return { rows, total };
}
