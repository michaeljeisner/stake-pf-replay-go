import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconArrowRight, IconFilter, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import * as bindings from '@bindings/bindings';
import * as store from '@bindings/internal/store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RunsTableProps {
  data: bindings.RunsList;
  query: bindings.RunsQuery;
  onQueryChange: (query: Partial<bindings.RunsQuery>) => void;
}

interface GameOption {
  label: string;
  value: string | undefined;
}

function useGameOptions(): GameOption[] {
  const [options, setOptions] = useState<GameOption[]>([{ label: 'All games', value: undefined }]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { GetGames } = await import('@bindings/bindings/app');
        const specs = await GetGames();
        if (cancelled || !Array.isArray(specs)) return;
        const gameOpts: GameOption[] = [
          { label: 'All games', value: undefined },
          ...specs.map((s: { id: string; name: string }) => ({ label: s.name, value: s.id })),
        ];
        setOptions(gameOpts);
      } catch {
        // Fall back to static list if bindings not ready
        setOptions([
          { label: 'All games', value: undefined },
          { label: 'Limbo', value: 'limbo' },
          { label: 'Dice', value: 'dice' },
          { label: 'Roulette', value: 'roulette' },
          { label: 'Pump', value: 'pump' },
          { label: 'Plinko', value: 'plinko' },
          { label: 'Keno', value: 'keno' },
          { label: 'Wheel', value: 'wheel' },
          { label: 'Mines', value: 'mines' },
          { label: 'Chicken', value: 'chicken' },
          { label: 'HiLo', value: 'hilo' },
          { label: 'Blackjack', value: 'blackjack' },
          { label: 'Baccarat', value: 'baccarat' },
          { label: 'Video Poker', value: 'videopoker' },
        ]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return options;
}

function formatTimeAgo(iso: string) {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const diffMins = Math.floor(diff / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return '--';
  }
}

function getStatus(run: store.Run) {
  if (run.timed_out) {
    return { label: 'Timeout', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' };
  }
  if (run.hit_count > 0) {
    return { label: 'Complete', color: 'text-primary', border: 'border-primary/30', bg: 'bg-primary/10' };
  }
  return { label: 'No Hits', color: 'text-muted-foreground', border: 'border-border', bg: 'bg-muted/30' };
}

export function RunsTable({ data, query, onQueryChange }: RunsTableProps) {
  const navigate = useNavigate();
  const runs = data?.runs ?? [];
  const GAME_OPTIONS = useGameOptions();

  const pageTotal = useMemo(() => {
    const perPage = query.perPage ?? 25;
    return Math.max(1, Math.ceil((data?.totalCount ?? 0) / perPage));
  }, [data?.totalCount, query.perPage]);

  const handleGameFilter = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || undefined;
    onQueryChange({ game: value as bindings.RunsQuery['game'], page: 1 });
  };

  const startIndex = (query.page - 1) * (query.perPage ?? 25) + 1;
  const endIndex = Math.min(query.page * (query.perPage ?? 25), data.totalCount ?? 0);

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <IconFilter size={14} className="text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Filter:</span>
          <select
            value={query.game ?? ''}
            onChange={handleGameFilter}
            className="h-8 border border-border bg-background px-3 font-mono text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
          >
            {GAME_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ''} className="bg-card text-foreground">
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Page {query.page} / {pageTotal}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Run ID
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Created
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Game
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Nonce Range
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Hits
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Progress
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Status
              </th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {runs.map((run, index) => {
              const status = getStatus(run);
              const range = run.nonce_end - run.nonce_start;
              const progress = range > 0 ? Math.min(100, (run.total_evaluated / range) * 100) : 0;

              return (
                <tr
                  key={run.id}
                  className="data-row group cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => navigate(`/runs/${run.id}`)}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <code className="border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px]">
                      {run.id.slice(0, 8)}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-xs text-foreground">{new Date(run.created_at).toLocaleDateString()}</span>
                      <span className="text-[10px] text-muted-foreground">{formatTimeAgo(run.created_at)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="badge-terminal">{run.game.toUpperCase()}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs text-foreground">
                        {run.nonce_start.toLocaleString()} → {run.nonce_end.toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{range.toLocaleString()} nonces</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <span className={cn('font-mono text-sm font-bold', run.hit_count > 0 ? 'text-hit hit-glow' : 'text-muted-foreground')}>
                      {run.hit_count.toLocaleString()}
                    </span>
                    {run.total_evaluated > 0 && (
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {((run.hit_count / run.total_evaluated) * 100).toFixed(3)}%
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <div className="h-1.5 w-24 overflow-hidden border border-border bg-muted/30">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${progress.toFixed(1)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">{progress.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={cn('border px-2 py-0.5 font-mono text-[10px] uppercase', status.border, status.bg, status.color)}>
                      {status.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/runs/${run.id}`);
                      }}
                    >
                      <IconArrowRight size={14} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="font-mono text-[10px] text-muted-foreground">
          Showing <span className="text-foreground">{startIndex}</span> - <span className="text-foreground">{endIndex}</span> of{' '}
          {data.totalCount ?? 0}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={query.page <= 1}
            onClick={() => onQueryChange({ page: Math.max(1, (query.page ?? 2) - 1) })}
          >
            <IconChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={query.page >= pageTotal}
            onClick={() => onQueryChange({ page: Math.min(pageTotal, (query.page ?? 1) + 1) })}
          >
            <IconChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
