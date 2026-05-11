import { useState, useEffect, useMemo } from 'react';
import {
  IconAlertTriangle,
  IconHistory,
  IconPlus,
  IconRefresh,
  IconChartBar,
  IconDatabase,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { ListRuns } from '@bindings/bindings/app';
import * as bindings from '@bindings/bindings';
import { RunsTable } from '@/components/RunsTable';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RunsList() {
  const navigate = useNavigate();
  const [runsData, setRunsData] = useState<bindings.RunsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuery, setCurrentQuery] = useState<bindings.RunsQuery>({
    page: 1,
    perPage: 25,
    game: undefined,
  });

  const fetchRuns = async (query: bindings.RunsQuery) => {
    try {
      setLoading(true);
      setError(null);
      await waitForWailsBinding(['go', 'bindings', 'App', 'ListRuns'], { timeoutMs: 10_000 });
      const result = await callWithRetry(() => ListRuns(query), 4, 250);
      setRunsData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load runs';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns(currentQuery);
  }, [currentQuery]);

  const handleQueryChange = (patch: Partial<bindings.RunsQuery>) => {
    setCurrentQuery((prev) => ({
      ...prev,
      ...patch,
      page: patch.page ?? 1,
    }));
  };

  const refresh = () => fetchRuns(currentQuery);

  const totalPages = useMemo(() => {
    if (!runsData?.totalCount || !currentQuery.perPage) return 1;
    return Math.max(1, Math.ceil(runsData.totalCount / currentQuery.perPage));
  }, [runsData?.totalCount, currentQuery.perPage]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-blue-500/30 bg-blue-500/10 text-blue-400">
            <IconHistory size={24} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Scan History</h1>
            <p className="text-sm text-muted-foreground">View and manage your previous scan results.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 font-mono text-xs uppercase"
            onClick={refresh}
            disabled={loading}
          >
            <IconRefresh size={14} className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" className="btn-terminal gap-2 text-xs" onClick={() => navigate('/')}>
            <IconPlus size={14} />
            New Scan
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/50 bg-destructive/10 p-4">
          <IconAlertTriangle size={18} className="shrink-0 text-destructive" />
          <div>
            <p className="font-mono text-sm font-semibold text-destructive">Error loading scan history</p>
            <p className="mt-1 text-xs text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Stats summary */}
      {!error && runsData && runsData.totalCount !== undefined && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Scans"
            value={runsData.totalCount.toLocaleString()}
            icon={IconChartBar}
            color="text-primary"
          />
          <StatCard
            label="Current Page"
            value={`${currentQuery.page} / ${totalPages}`}
            icon={IconDatabase}
            color="text-blue-400"
          />
          <StatCard
            label="Per Page"
            value={String(currentQuery.perPage)}
            icon={IconHistory}
            color="text-copper"
          />
          {currentQuery.game && (
            <div className="card-terminal flex items-center justify-between p-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Filter</div>
                <span className="badge-terminal mt-1">{currentQuery.game.toUpperCase()}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data table */}
      <div className="card-terminal relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="font-mono text-sm text-muted-foreground">Loading runs...</span>
            </div>
          </div>
        )}

        {!loading && runsData && runsData.runs && runsData.runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-6 p-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center border border-border bg-muted/30">
              <IconHistory size={28} className="text-muted-foreground" />
            </div>
            <div>
              <p className="font-display text-lg uppercase tracking-wider text-foreground">No scan history yet</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                You haven't run any scans. Start by creating your first provable fairness analysis.
              </p>
            </div>
            <Button className="btn-terminal gap-2" onClick={() => navigate('/')}>
              <IconPlus size={14} />
              Create first scan
            </Button>
          </div>
        ) : runsData && runsData.runs ? (
          <RunsTable data={runsData} query={currentQuery} onQueryChange={handleQueryChange} />
        ) : null}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="card-terminal flex items-center justify-between p-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={cn('mt-1 font-mono text-2xl font-bold', color || 'text-foreground')}>{value}</div>
      </div>
      <div className={cn('flex h-10 w-10 items-center justify-center border border-current/30 bg-current/10', color)}>
        <Icon size={18} />
      </div>
    </div>
  );
}
