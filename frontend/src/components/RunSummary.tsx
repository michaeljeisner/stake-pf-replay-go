import * as store from '@bindings/internal/store';
import { IconClock, IconTarget, IconHash, IconDice, IconTrendingUp } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface RunSummaryProps {
  run: store.Run;
}

export function RunSummary({ run }: RunSummaryProps) {
  let parsedParams: Record<string, unknown> = {};
  try {
    parsedParams = JSON.parse(run.params_json);
  } catch (e) {
    console.warn('Failed to parse params JSON:', e);
  }

  const createdDate = new Date(run.created_at).toLocaleString();
  const hitRate = run.total_evaluated > 0 ? (run.hit_count / run.total_evaluated) * 100 : 0;

  const formatNumber = (num: number | undefined | null, precision = 6) => {
    if (num === undefined || num === null) return 'N/A';
    return num.toFixed(precision);
  };

  return (
    <div className="card-terminal">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
            <IconTrendingUp size={20} />
          </div>
          <div>
            <h2 className="font-display text-sm uppercase tracking-wider text-foreground">Scan Summary</h2>
            <p className="text-xs text-muted-foreground">Run ID: {run.id}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6 p-6">
        {/* Parameters & Metadata Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Scan Parameters */}
          <div className="space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Scan Parameters</h3>
            <div className="space-y-2">
              <DataRow icon={<IconDice size={14} />} label="Game">
                <span className="badge-terminal">{run.game.toUpperCase()}</span>
              </DataRow>
              <DataRow icon={<IconHash size={14} />} label="Server Hash">
                <code className="font-mono text-xs text-muted-foreground">{run.server_seed_hash.substring(0, 16)}...</code>
              </DataRow>
              <DataRow label="Client Seed">
                <code className="font-mono text-xs text-foreground">{run.client_seed}</code>
              </DataRow>
              <DataRow label="Nonce Range">
                <span className="font-mono text-xs">
                  {run.nonce_start.toLocaleString()} → {run.nonce_end.toLocaleString()}
                </span>
              </DataRow>
              <DataRow icon={<IconTarget size={14} />} label="Target">
                <span className="font-mono text-xs">
                  {run.target_op} <span className="text-hit">{run.target_val}</span> ±{run.tolerance}
                </span>
              </DataRow>
              {Object.keys(parsedParams).length > 0 && (
                <DataRow label="Game Params">
                  <code className="font-mono text-[10px] text-muted-foreground">{JSON.stringify(parsedParams)}</code>
                </DataRow>
              )}
            </div>
          </div>

          {/* Execution Metadata */}
          <div className="space-y-3">
            <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Execution Metadata</h3>
            <div className="space-y-2">
              <DataRow icon={<IconClock size={14} />} label="Created">
                <span className="text-xs">{createdDate}</span>
              </DataRow>
              <DataRow label="Engine Version">
                <code className="border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px]">{run.engine_version}</code>
              </DataRow>
              <DataRow label="Status">
                {run.timed_out ? (
                  <span className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase text-amber-400">Timed Out</span>
                ) : (
                  <span className="border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase text-primary">Completed</span>
                )}
              </DataRow>
              <DataRow label="Hit Limit">
                <span className="font-mono text-xs">{run.hit_limit.toLocaleString()}</span>
              </DataRow>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Statistics</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Evaluated" value={run.total_evaluated.toLocaleString()} color="text-primary" />
            <StatCard label="Hits Found" value={run.hit_count.toLocaleString()} color="text-hit" />
            <StatCard label="Hit Rate" value={`${hitRate.toFixed(4)}%`} color="text-copper" />
            <StatCard label="Summary Count" value={run.summary_count ? run.summary_count.toLocaleString() : 'N/A'} color="text-blue-400" />
          </div>

          {(run.summary_min !== undefined || run.summary_max !== undefined || run.summary_sum !== undefined) && (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Min Metric" value={formatNumber(run.summary_min)} color="text-destructive" />
              <StatCard label="Max Metric" value={formatNumber(run.summary_max)} color="text-primary" />
              <StatCard label="Sum Metric" value={formatNumber(run.summary_sum)} color="text-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DataRow({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon && <span className="text-primary">{icon}</span>}
      <span className="text-muted-foreground">{label}:</span>
      {children}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1 border border-border bg-muted/20 p-4 text-center">
      <span className={cn('font-mono text-xl font-bold', color)}>{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );
}
