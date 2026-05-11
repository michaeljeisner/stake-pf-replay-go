import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconLoader2,
  IconX,
} from '@tabler/icons-react';
import { GetRun, GetSeedRuns } from '@bindings/bindings/app';
import * as bindings from '@bindings/bindings';
import * as store from '@bindings/internal/store';
import { RunSummary, HitsTable, SeedRunWorkspace } from '@/components';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { waitForWailsBinding } from '@/lib/wails';
import { cn } from '@/lib/utils';

export function RunDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<store.Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seedGroup, setSeedGroup] = useState<bindings.SeedRunGroup | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const refreshGroup = useCallback(
    async (runId?: string) => {
      const targetId = runId ?? id;
      if (!targetId) return;

      try {
        setGroupLoading(true);
        await waitForWailsBinding(['go', 'bindings', 'App', 'GetSeedRuns'], { timeoutMs: 10_000 });
        const groupData = await GetSeedRuns(targetId);
        setSeedGroup(groupData);
        setGroupError(null);
      } catch (err) {
        console.error('Failed to load related runs', err);
        setGroupError(err instanceof Error ? err.message : 'Failed to load related runs');
      } finally {
        setGroupLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    if (!id) {
      setError('Run ID is required');
      setLoading(false);
      return;
    }

    const fetchRun = async () => {
      try {
        setLoading(true);
        setError(null);
        const runData = await GetRun(id);
        setRun(runData);
        await refreshGroup(id);
      } catch (err) {
        console.error('Failed to fetch run:', err);
        setError(err instanceof Error ? err.message : 'Failed to load run details');
      } finally {
        setLoading(false);
      }
    };

    fetchRun();
  }, [id, refreshGroup]);

  const statusBadge = useMemo(() => {
    if (!run) return null;
    if (run.timed_out) {
      return (
        <div className="flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-amber-400">
          <IconClock size={12} />
          Timed Out
        </div>
      );
    }
    if (run.hit_count > 0) {
      return (
        <div className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
          <IconCheck size={12} />
          Completed
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 border border-border bg-muted/30 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <IconX size={12} />
        No Hits
      </div>
    );
  }, [run]);

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Button variant="ghost" className="w-fit gap-2 text-muted-foreground" disabled>
          <IconArrowLeft size={16} />
          Back to history
        </Button>
        <div className="card-terminal p-8">
          <div className="flex items-center gap-3 text-primary">
            <IconLoader2 className="animate-spin" size={20} />
            <p className="font-mono text-sm text-muted-foreground">Loading run details...</p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !run) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Button
          variant="ghost"
          className="w-fit gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/runs')}
        >
          <IconArrowLeft size={16} />
          Back to history
        </Button>
        <div className="border border-destructive/50 bg-destructive/10 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <IconAlertTriangle size={18} />
            <span className="font-display text-sm uppercase tracking-wider">Error loading run</span>
          </div>
          <p className="mt-2 text-sm text-destructive/80">{error ?? 'Run not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/runs')}
        >
          <IconArrowLeft size={16} />
          Back to history
        </Button>
        {statusBadge}
      </div>

      {/* Group error */}
      {groupError && (
        <div className="flex items-start gap-3 border border-destructive/50 bg-destructive/10 p-4">
          <IconAlertTriangle size={18} className="shrink-0 text-destructive" />
          <div>
            <p className="font-mono text-sm font-semibold text-destructive">Related runs unavailable</p>
            <p className="mt-1 text-xs text-destructive/80">{groupError}</p>
          </div>
        </div>
      )}

      {/* Seed Run Workspace */}
      {seedGroup && run && (
        <SeedRunWorkspace
          currentRun={run}
          group={seedGroup}
          groupLoading={groupLoading}
          refreshGroup={refreshGroup}
          onRunSelected={(runId) => {
            if (runId !== run.id) navigate(`/runs/${runId}`);
          }}
          onRunCreated={(runId) => {
            if (runId !== run.id) navigate(`/runs/${runId}`);
          }}
        />
      )}

      {/* Run Summary */}
      <RunSummary run={run} />

      {/* Hits Table */}
      <HitsTable runId={run.id} />
    </div>
  );
}
