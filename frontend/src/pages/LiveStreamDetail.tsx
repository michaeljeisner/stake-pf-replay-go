/**
 * LiveStreamDetail
 *
 * Pump cadence strategy dashboard.
 * Purpose-built to support the "1066+ every ~1000 nonces ±200-400" heuristic.
 */

import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  IconArrowLeft,
  IconBroadcast,
  IconCheck,
  IconCopy,
  IconDownload,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconLayoutDashboard,
  IconTableOptions,
} from '@tabler/icons-react';
import { DeleteStream, ExportCSV } from '@desktop-bindings/internal/livehttp/livemodule';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useCadenceStream } from '@/hooks/useCadenceStream';
import { TIER_ORDER, TierId } from '@/lib/pump-tiers';
import { TierCadenceCard, LiveStreamTape, LiveExplorerTable, SeedQualityPanel, DecisionSignals } from '@/components/live';

function CopyButton({ value, size = 14 }: { value: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? <IconCheck size={size} className="text-cyan-400" /> : <IconCopy size={size} />}
    </button>
  );
}

export default function LiveStreamDetailPage(props: { streamId?: string }) {
  const params = useParams();
  const navigate = useNavigate();
  const streamId = props.streamId ?? params.id!;

  const {
    tierStats,
    bets,
    isLoading,
    error,
    stream,
    refresh,
    seedQuality,
    signals,
    isConnected,
    currentNonce,
    lastHeartbeatAt,
  } = useCadenceStream({
    streamId,
    initialRoundsLimit: 10000,
    betThreshold: 34,
  });

  const onExportCsv = useCallback(async () => {
    try {
      const exported = await ExportCSV(streamId);
      if (exported.includes('\n') || exported.includes(',')) {
        const blob = new Blob([exported], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `stream-${streamId}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);
        toast.success('CSV downloaded');
      } else {
        toast.success(`CSV written to ${exported}`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to export CSV');
    }
  }, [streamId]);

  const onDeleteStream = useCallback(async () => {
    if (!window.confirm('Delete this stream and all associated data?')) return;
    try {
      await DeleteStream(streamId);
      toast.success('Stream removed');
      navigate('/live');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  }, [streamId, navigate]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-[280px]" />
          <Skeleton className="h-[280px]" />
          <Skeleton className="h-[280px]" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="ghost" className="w-fit gap-2" onClick={() => navigate('/live')}>
          <IconArrowLeft size={16} /> Back
        </Button>
        <div className="max-w-md border border-destructive/50 bg-destructive/10 p-6 rounded-xl">
          <h2 className="font-display text-lg uppercase tracking-wider text-destructive">Error</h2>
          <p className="mt-2 text-sm text-destructive/80">{error.message}</p>
          <Button onClick={refresh} variant="destructive" size="sm" className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate('/live')}>
            <IconArrowLeft size={18} />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <IconBroadcast size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg uppercase tracking-wider text-foreground">
                  Pump Cadence
                </h1>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <code className="font-mono text-[10px]">{streamId.slice(0, 8)}</code>
                <CopyButton value={streamId} size={12} />
                {stream && (
                  <>
                    <span>•</span>
                    <span className="font-mono">{stream.clientSeed.slice(0, 12)}...</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <IconSettings size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportCsv}>
                <IconDownload size={14} className="mr-2" /> Export CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDeleteStream} className="text-destructive focus:text-destructive">
                <IconTrash size={14} className="mr-2" /> Delete Stream
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs: Dashboard | Explorer */}
      <Tabs defaultValue="dashboard" className="flex flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="dashboard" className="gap-2">
            <IconLayoutDashboard size={14} />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="explorer" className="gap-2">
            <IconTableOptions size={14} />
            Explorer
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* Seed Quality Panel */}
          <SeedQualityPanel
            quality={seedQuality}
            currentNonce={currentNonce}
            isConnected={isConnected}
          />

          {/* Decision Signals */}
          <DecisionSignals signals={signals} />

          {/* Connection Health Bar */}
          <ConnectionHealthBar
            isConnected={isConnected}
            currentNonce={currentNonce}
            lastHeartbeatAt={lastHeartbeatAt}
          />

          {/* All 5 tiers in a single row */}
          <div className="grid grid-cols-5 gap-3">
            {(['T164', 'T400', 'T1066', 'T3200', 'T11200'] as TierId[]).map((tierId) => {
              const stats = tierStats.get(tierId);
              if (!stats) return <Skeleton key={tierId} className="h-[200px]" />;
              return <TierCadenceCard key={tierId} stats={stats} compact />;
            })}
          </div>

          {/* Stream tape fills remaining height */}
          <div className="min-h-0 flex-1">
            <LiveStreamTape bets={bets} maxItems={120} className="h-full min-h-0" />
          </div>
        </TabsContent>

        {/* Explorer Tab */}
        <TabsContent value="explorer" className="flex-1 mt-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
          <LiveExplorerTable streamId={streamId} className="h-full" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConnectionHealthBar({
  isConnected,
  currentNonce,
  lastHeartbeatAt,
}: {
  isConnected: boolean;
  currentNonce: number;
  lastHeartbeatAt: string | null;
}) {
  const timeSinceLastSeen = lastHeartbeatAt
    ? formatTimeSince(lastHeartbeatAt)
    : '—';

  return (
    <div className={cn(
      'flex items-center gap-4 rounded-lg border px-4 py-2 text-xs font-mono',
      isConnected
        ? 'border-cyan-500/20 bg-cyan-500/5'
        : 'border-red-500/20 bg-red-500/5'
    )}>
      <div className="flex items-center gap-2">
        <span className={cn(
          'h-2 w-2 rounded-full',
          isConnected ? 'bg-cyan-400 animate-pulse' : 'bg-red-400'
        )} />
        <span className={isConnected ? 'text-cyan-400' : 'text-red-400'}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <span className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="uppercase tracking-wider text-[10px]">Nonce</span>
        <span className="text-foreground">{currentNonce > 0 ? currentNonce.toLocaleString() : '—'}</span>
      </div>
      <span className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="uppercase tracking-wider text-[10px]">Last heartbeat</span>
        <span className="text-foreground">{timeSinceLastSeen}</span>
      </div>
    </div>
  );
}

function formatTimeSince(isoDate: string): string {
  try {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
  } catch {
    return '—';
  }
}

function InfoItem({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <code className="truncate font-mono text-foreground">{value}</code>
        {copyable && <CopyButton value={value} size={12} />}
      </div>
    </div>
  );
}

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return '—';
  }
}
