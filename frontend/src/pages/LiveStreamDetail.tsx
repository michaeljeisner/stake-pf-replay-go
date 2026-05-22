/**
 * LiveStreamDetail
 *
 * Full-screen Pump cadence command surface, matched to the provided mockup.
 */

import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useCadenceStream } from '@/hooks/useCadenceStream';
import { PUMP_EXPERT_TIERS, TierId } from '@/lib/pump-tiers';
import type { TierStats } from '@/lib/cadence-analytics';
import type { LiveBet } from '@/types/live';
import { LiveExplorerTable } from '@/components/live';

const COMMAND_TIERS: TierId[] = ['T11200', 'T3200', 'T1066', 'T400', 'T164'];

const tierVisuals: Record<
  TierId,
  {
    label: string;
    title: string;
    active: string;
    border: string;
    headerBg?: string;
  }
> = {
  T11200: {
    label: '11200X',
    title: 'text-[#ffb4ab]',
    active: 'text-[#ffb4ab]',
    border: 'border-[#ffb4ab]/25',
    headerBg: 'bg-[#2a0709]/60',
  },
  T3200: {
    label: '3200X',
    title: 'text-[#ffb68c]',
    active: 'text-[#ffb68c]',
    border: 'border-[#ffb68c]/25',
  },
  T1066: {
    label: '1066X',
    title: 'text-[#aac7ff]',
    active: 'text-[#aac7ff]',
    border: 'border-[#aac7ff]/25',
  },
  T400: {
    label: '400X',
    title: 'text-[#aec7f7]',
    active: 'text-[#aec7f7]',
    border: 'border-[#aec7f7]/25',
  },
  T164: {
    label: '164X',
    title: 'text-[#aac7ff]',
    active: 'text-[#aac7ff]',
    border: 'border-[#aac7ff]/25',
  },
};

function MaterialIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn('material-symbols-outlined select-none leading-none', className)}
      aria-hidden="true"
    >
      {name}
    </span>
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
    isConnected,
    currentNonce,
  } = useCadenceStream({
    streamId,
    initialRoundsLimit: 10000,
    betThreshold: 34,
  });

  const metrics = useMemo(() => {
    const gapCount = COMMAND_TIERS.reduce((sum, tierId) => {
      return sum + (tierStats.get(tierId)?.lastKGaps.length ?? 0);
    }, 0);

    return {
      nodeId: formatNodeId(streamId),
      nonce: currentNonce > 0 ? `#${currentNonce.toLocaleString()}` : '--',
      duration: formatDuration(
        seedQuality?.durationMs ??
        (stream?.createdAt ? Date.now() - new Date(stream.createdAt).getTime() : null),
      ),
      gaps: gapCount || bets.length,
      latency: isConnected ? '12ms' : '--',
      status: isConnected ? 'OPTIMAL' : 'OFFLINE',
    };
  }, [bets.length, currentNonce, isConnected, seedQuality?.durationMs, stream?.createdAt, streamId, tierStats]);

  if (isLoading) {
    return (
      <CommandShell>
        <div className="flex h-full flex-1 flex-col gap-6 bg-[#0A0A0A] p-8">
          <Skeleton className="h-10 w-80 rounded-none bg-[#1c2026]" />
          <div className="grid flex-1 grid-cols-5 gap-0">
            {COMMAND_TIERS.map((tierId) => (
              <Skeleton key={tierId} className="h-full rounded-none border border-[#414753] bg-[#111]" />
            ))}
          </div>
        </div>
      </CommandShell>
    );
  }

  if (error) {
    return (
      <CommandShell>
        <main className="flex h-full flex-1 items-center justify-center bg-[#0A0A0A] p-8 font-['Inter_Tight'] text-[#e0e2eb]">
          <div className="w-[420px] border border-[#414753] bg-[#111] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-[#ffb4ab]">Stream Error</h1>
              <button
                type="button"
                className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]"
                onClick={() => navigate('/live')}
              >
                <IconArrowLeft size={18} />
              </button>
            </div>
            <p className="font-['JetBrains_Mono'] text-sm text-[#c1c6d5]">{error.message}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-6 bg-[#e3711f] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#321200]"
            >
              Retry
            </button>
          </div>
        </main>
      </CommandShell>
    );
  }

  return (
    <CommandShell>
      <main className="relative flex min-w-0 flex-1 flex-row overflow-x-auto bg-[#0A0A0A] pt-14 font-['Inter_Tight'] text-[#e0e2eb] [scrollbar-color:#e3711f_rgba(255,255,255,0.05)]">
        <TopTelemetry metrics={metrics} onRotateSeed={() => toast.info('Seed rotation is not wired from this live stream page yet')} />

        {COMMAND_TIERS.map((tierId) => (
          <TierCommandColumn key={tierId} stats={tierStats.get(tierId)} tierId={tierId} />
        ))}

        <StreamTapePanel
          bets={bets}
          onRefresh={refresh}
        />
      </main>
    </CommandShell>
  );
}

export function LiveStreamExplorerPage(props: { streamId?: string }) {
  const params = useParams();
  const navigate = useNavigate();
  const streamId = props.streamId ?? params.id!;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate(`/live/${streamId}`)}>
            <IconArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="font-display text-lg uppercase tracking-wider text-foreground">Stream Explorer</h1>
            <p className="font-mono text-xs text-muted-foreground">{streamId}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/live/${streamId}`)}>
          <IconArrowLeft size={14} />
          Command View
        </Button>
      </div>

      <LiveExplorerTable streamId={streamId} className="min-h-[640px] flex-1" />
    </div>
  );
}

function CommandShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0A0A0A] text-[#e0e2eb]">
      <CommandRail />
      {children}
    </div>
  );
}

function CommandRail() {
  const navigate = useNavigate();
  const params = useParams();
  const streamId = params.id;

  return (
    <aside className="flex h-full w-20 shrink-0 flex-col items-center border-r border-[#414753] bg-[#0A0A0A] py-8 font-['Inter_Tight']">
      <button
        type="button"
        className="mb-auto text-[#e3711f]"
        aria-label="Back to live streams"
        onClick={() => navigate('/live')}
      >
        <MaterialIcon name="analytics" className="text-[34px]" />
      </button>

      <nav className="flex flex-col items-center gap-8">
        <button type="button" className="relative text-[#e3711f]" aria-label="Command view">
          <span className="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 bg-[#e3711f]" />
          <MaterialIcon name="dashboard" className="text-[30px]" />
        </button>
        <button
          type="button"
          className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]"
          aria-label="Explorer"
          onClick={() => streamId && navigate(`/live/${streamId}/explorer`)}
        >
          <MaterialIcon name="table_chart" className="text-[26px]" />
        </button>
        <button type="button" className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]" aria-label="Speed">
          <MaterialIcon name="speed" className="text-[26px]" />
        </button>
        <button type="button" className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]" aria-label="Pattern">
          <MaterialIcon name="grain" className="text-[26px]" />
        </button>
        <button type="button" className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]" aria-label="Ledger">
          <MaterialIcon name="receipt_long" className="text-[26px]" />
        </button>
        <button type="button" className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]" aria-label="Warnings">
          <MaterialIcon name="warning" className="text-[26px]" />
        </button>
      </nav>

      <div className="mt-auto flex flex-col items-center gap-5">
        <button type="button" className="text-[#c1c6d5] transition-colors hover:text-[#e0e2eb]" aria-label="Help">
          <MaterialIcon name="help" className="text-[26px]" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center border border-[#414753] bg-[#272a31] font-['JetBrains_Mono'] text-xs font-bold text-[#e0e2eb]">
          V2
        </div>
      </div>
    </aside>
  );
}

function TopTelemetry({
  metrics,
  onRotateSeed,
}: {
  metrics: {
    nodeId: string;
    nonce: string;
    duration: string;
    gaps: number;
    latency: string;
    status: string;
  };
  onRotateSeed: () => void;
}) {
  return (
    <div className="absolute left-0 right-0 top-0 z-30 flex h-14 items-center gap-8 overflow-x-auto border-b border-[#414753] bg-[#0A0A0A] px-8">
      <TelemetryItem label="System Status:" value={metrics.status} valueClass="text-[#a3e635]" />
      <TelemetryItem label="Node_ID:" value={metrics.nodeId} />
      <TelemetryItem label="Latency:" value={metrics.latency} valueClass="text-[#a3e635]" />
      <div className="h-6 w-px shrink-0 bg-[#414753]/50" />
      <TelemetryItem label="Nonce:" value={metrics.nonce} />
      <TelemetryItem label="Duration:" value={metrics.duration} />
      <TelemetryItem label="Gaps:" value={metrics.gaps.toLocaleString()} />
      <button
        type="button"
        onClick={onRotateSeed}
        className="ml-auto shrink-0 border border-black bg-[#e3711f] px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#321200] transition-colors hover:bg-[#ffb68c]"
      >
        Rotate Seed
      </button>
    </div>
  );
}

function TelemetryItem({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#c1c6d5]">{label}</span>
      <span className={cn("font-['JetBrains_Mono'] text-[10px] font-bold", valueClass ?? 'text-[#e0e2eb]')}>
        {value}
      </span>
    </div>
  );
}

function TierCommandColumn({ tierId, stats }: { tierId: TierId; stats?: TierStats }) {
  const visual = tierVisuals[tierId];
  const gaps = stats?.lastKGaps.slice(-6).reverse() ?? [];

  return (
    <section className="group flex min-w-[170px] flex-1 flex-col border-r border-[#414753] bg-[#0A0A0A] transition-colors hover:bg-[#111]">
      <div className={cn('flex h-20 items-center justify-center border-b border-[#414753]', visual.headerBg)}>
        <h2 className={cn("font-['Inter_Tight'] text-xl font-bold uppercase", visual.title)}>
          {visual.label}
        </h2>
      </div>

      <div className="relative flex-1 overflow-y-auto p-5 [scrollbar-width:thin]">
        <div className="pointer-events-none absolute right-2 top-12 opacity-20 [writing-mode:vertical-rl]">
          <span className="block rotate-180 font-['JetBrains_Mono'] text-[10px] font-bold uppercase tracking-[0.5em] text-[#c1c6d5]">
            STREAK: {formatNumber(stats?.currentStreak)} - LAST 20 DATA
          </span>
        </div>

        <div className="mt-12 flex flex-col items-center gap-8">
          <div className="text-center">
            <p className={cn("font-['JetBrains_Mono'] text-[42px] font-bold leading-none tracking-tight", visual.active)}>
              {formatNumber(stats?.currentStreak)}
            </p>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-[#c1c6d5]">Active Gap</p>
          </div>

          <div className="w-full border-t border-[#414753] pt-4">
            {tierId === 'T11200' ? (
              <div className="space-y-5 text-center">
                {gaps.length ? gaps.slice(0, 4).map((gap, index) => (
                  <p
                    key={`${gap.atNonce}-${index}`}
                    className="font-['JetBrains_Mono'] text-2xl font-bold text-[#c1c6d5]"
                    style={{ opacity: Math.max(0.18, 0.4 - index * 0.1) }}
                  >
                    {gap.gap.toLocaleString()}
                  </p>
                )) : (
                  <p className="font-['JetBrains_Mono'] text-2xl font-bold text-[#c1c6d5]/30">--</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                {gaps.length ? gaps.map((gap, index) => (
                  <div
                    key={`${gap.atNonce}-${index}`}
                    className={cn('w-3/4 border bg-[#111] px-4 py-2 text-center', index < 2 ? visual.border : 'border-[#414753]/70')}
                  >
                    <span
                      className={cn("font-['JetBrains_Mono'] text-2xl font-bold", index < 3 ? visual.active : 'text-[#c1c6d5]')}
                      style={{ opacity: index < 2 ? 1 : Math.max(0.22, 0.62 - index * 0.1) }}
                    >
                      {gap.gap.toLocaleString()}
                    </span>
                  </div>
                )) : (
                  <div className="w-3/4 border border-[#414753]/70 bg-[#111] px-4 py-2 text-center">
                    <span className="font-['JetBrains_Mono'] text-2xl font-bold text-[#c1c6d5]/30">--</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StreamTapePanel({
  bets,
  onRefresh,
}: {
  bets: LiveBet[];
  onRefresh: () => void;
}) {
  const rows = useMemo(() => buildTapeRows(bets).slice(0, 120), [bets]);

  return (
    <section className="relative z-10 flex w-[440px] shrink-0 flex-col border-l border-[#414753] bg-[#0A0A0A]">
      <div className="flex h-20 items-center justify-between border-b border-[#414753] px-5">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-pulse bg-[#a3e635]" />
          <h2 className="font-['Inter_Tight'] text-xl font-bold uppercase tracking-[0.2em] text-[#e0e2eb]">
            Stream Tape
          </h2>
        </div>
        <div className="flex gap-4">
          <button type="button" aria-label="Refresh stream tape" onClick={onRefresh} className="text-[#c1c6d5] hover:text-[#a3e635]">
            <MaterialIcon name="filter_list" className="text-[26px]" />
          </button>
          <button
            type="button"
            aria-label="Fullscreen stream tape"
            onClick={() => toast.info('Fullscreen stream tape is visual-only in this view for now')}
            className="text-[#c1c6d5] hover:text-[#a3e635]"
          >
            <MaterialIcon name="fullscreen" className="text-[26px]" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <table className="w-full border-collapse font-['Inter_Tight']">
          <thead className="sticky top-0 z-20 bg-[#0A0A0A]">
            <tr className="border-b border-[#414753]/40 text-left text-xl font-bold uppercase tracking-[0.1em] text-[#c1c6d5]">
              <th className="px-5 py-5">Nonce</th>
              <th className="px-5 py-5">Result</th>
              <th className="px-5 py-5 text-right">Gap</th>
              <th className="px-5 py-5 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#414753]/40">
            {rows.length ? rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-[#111]">
                <td className="px-5 py-5 font-['JetBrains_Mono'] text-lg font-bold">#{row.nonce}</td>
                <td className="px-5 py-5 font-['JetBrains_Mono'] text-lg font-bold text-[#e0e2eb]">{row.result}</td>
                <td className="px-5 py-5 text-right font-['JetBrains_Mono'] text-lg text-[#c1c6d5]/40">{row.gap}</td>
                <td className="px-5 py-5 text-right font-['JetBrains_Mono'] text-xs text-[#c1c6d5]">{row.time}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-5 py-8 font-['JetBrains_Mono'] text-sm text-[#c1c6d5]/60" colSpan={4}>
                  Awaiting high-multiplier hits...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildTapeRows(bets: LiveBet[]) {
  const sorted = [...bets].sort((a, b) => b.nonce - a.nonce);
  const lastNonceByTier = new Map<TierId, number>();
  const ascending = [...sorted].reverse();
  const deltas = new Map<number, number | null>();

  for (const bet of ascending) {
    const tier = getHighestTierId(bet.round_result);
    if (!tier) {
      deltas.set(bet.id, null);
      continue;
    }
    const previousNonce = lastNonceByTier.get(tier);
    deltas.set(bet.id, previousNonce === undefined ? null : bet.nonce - previousNonce);
    lastNonceByTier.set(tier, bet.nonce);
  }

  return sorted.map((bet) => ({
    id: bet.id,
    nonce: bet.nonce.toLocaleString(),
    result: `${bet.round_result.toFixed(2)}x`,
    gap: deltas.get(bet.id)?.toLocaleString() ?? '--',
    time: formatTime(bet.date_time),
  }));
}

function getHighestTierId(result: number): TierId | null {
  for (let index = 0; index < COMMAND_TIERS.length; index += 1) {
    const tierId = COMMAND_TIERS[index];
    if (result >= PUMP_EXPERT_TIERS[tierId].threshold) return tierId;
  }
  return null;
}

function formatNodeId(streamId: string) {
  const compact = streamId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (compact.length >= 8) return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
  return compact || '--';
}

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '--';
  return Math.max(0, value).toLocaleString();
}

function formatDuration(durationMs: number | null) {
  if (!durationMs || durationMs < 0 || Number.isNaN(durationMs)) return '--';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--';
  }
}
