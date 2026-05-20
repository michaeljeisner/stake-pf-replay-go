import { useState, useEffect, useRef, useCallback } from 'react';
import { IconAlertTriangle, IconTable, IconDownload } from '@tabler/icons-react';
import { GetRunHits, ExportRunCSV } from '@bindings/bindings/app';
import * as store from '@bindings/internal/store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import { cn } from '@/lib/utils';

interface HitsTableProps {
  runId: string;
}

export function HitsTable({ runId }: HitsTableProps) {
  const [data, setData] = useState<store.HitWithDelta[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bindingsReady = useRef<Promise<void> | null>(null);

  const fetchHits = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!bindingsReady.current) {
        bindingsReady.current = waitForWailsBinding(['go', 'bindings', 'App', 'GetRunHits'], { timeoutMs: 10_000 });
      }
      await bindingsReady.current;

      const perPage = 500;
      const combined: store.HitWithDelta[] = [];
      let page = 1;
      let expected = 0;
      while (true) {
        const pageData = await callWithRetry(() => GetRunHits(runId, page, perPage), 4, 250);
        if (!pageData) break;
        const hits = pageData.hits ?? [];
        if (hits.length) combined.push(...hits);
        expected = pageData.totalCount ?? expected;
        if (pageData.totalPages && pageData.page && pageData.page >= pageData.totalPages) break;
        if (hits.length < perPage) break;
        if (expected && combined.length >= expected) break;
        page += 1;
      }

      setData(combined);
      setTotalCount(expected || combined.length);
    } catch (err) {
      console.error('Failed to fetch hits:', err);
      setError(err instanceof Error ? err.message : 'Failed to load hits');
      setData([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHits();
  }, [runId]);

  const [exporting, setExporting] = useState(false);
  const handleExportCSV = useCallback(async () => {
    try {
      setExporting(true);
      const csv = await ExportRunCSV(runId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan-${runId.slice(0, 8)}-hits.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [runId]);

  // Error state
  if (error) {
    return (
      <div className="border border-destructive/50 bg-destructive/10 p-6">
        <div className="flex items-start gap-3">
          <IconAlertTriangle size={18} className="shrink-0 text-destructive" />
          <div>
            <h3 className="font-mono text-sm font-semibold text-destructive">Unable to load hits</h3>
            <p className="mt-1 text-xs text-destructive/80">{error}</p>
            <Button variant="destructive" size="sm" className="mt-4" onClick={fetchHits}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="card-terminal p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
            <IconTable size={20} />
          </div>
          <div>
            <h3 className="font-display text-sm uppercase tracking-wider text-foreground">Hit Results</h3>
            <p className="text-xs text-muted-foreground">Loading hits...</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card-terminal overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
            <IconTable size={20} />
          </div>
          <div>
            <h3 className="font-display text-sm uppercase tracking-wider text-foreground">Hit Results</h3>
            <p className="text-xs text-muted-foreground">All matching nonces and their metrics</p>
          </div>
        </div>
        {data.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="badge-terminal">{(totalCount ?? data.length).toLocaleString()} hits</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={exporting}
              className="h-7 gap-1.5 border-primary/30 px-2.5 font-mono text-[10px] uppercase tracking-wider hover:border-primary/60 hover:bg-primary/10"
            >
              <IconDownload size={14} />
              {exporting ? 'Exporting...' : 'CSV'}
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Nonce
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Metric
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Delta
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center font-mono text-sm text-muted-foreground">
                  No hits found
                </td>
              </tr>
            ) : (
              data.map((hit) => (
                <tr
                  key={`${hit.nonce}-${hit.delta_nonce ?? 'na'}`}
                  className="data-row transition-colors hover:bg-muted/30"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums text-foreground">
                    {hit.nonce.toLocaleString()}
                  </td>
                  <td className={cn(
                    "whitespace-nowrap px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums",
                    hit.metric >= 10 ? "text-hit hit-glow" : "text-foreground"
                  )}>
                    {hit.metric.toFixed(6)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {hit.delta_nonce != null ? hit.delta_nonce.toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
