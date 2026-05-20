/**
 * ScriptSessions
 *
 * Displays a list of past scripting sessions with key stats.
 * Embedded in the ScriptPage as a collapsible panel.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  IconHistory,
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconArrowUpRight,
  IconArrowDownRight,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

interface SessionSummary {
  id: string;
  game: string;
  currency: string;
  mode: string;
  finalState: string;
  totalBets: number;
  totalProfit: number;
  startBalance: number;
  finalBalance?: number;
  createdAt: string;
  endedAt?: string;
}

interface SessionsPage {
  sessions: SessionSummary[];
  totalCount: number;
}

// Lazy-load Wails bindings
let scriptBindingsPromise: Promise<typeof import('@bindings/bindings/scriptmodule')> | null = null;
const getBindings = () => {
  if (!scriptBindingsPromise) scriptBindingsPromise = import('@bindings/bindings/scriptmodule');
  return scriptBindingsPromise;
};

export function ScriptSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { ListScriptSessions } = await getBindings();
      const result = await ListScriptSessions(20, 0);
      const page = result as unknown as SessionsPage;
      setSessions(page.sessions || []);
      setTotalCount(page.totalCount || 0);
    } catch {
      // Bindings not ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) {
      fetchSessions();
    }
  }, [expanded, fetchSessions]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const { DeleteScriptSession } = await getBindings();
      await DeleteScriptSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));
      toast.success('Session deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete session');
    }
  }, []);

  return (
    <div className="border border-border">
      {/* Toggle header */}
      <button
        className="flex w-full items-center justify-between bg-muted/30 px-4 py-2 hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <IconHistory size={12} />
          Session History
          {totalCount > 0 && (
            <span className="text-primary ml-1">{totalCount}</span>
          )}
        </span>
        {expanded ? <IconChevronUp size={14} className="text-muted-foreground" /> : <IconChevronDown size={14} className="text-muted-foreground" />}
      </button>

      {/* Sessions list */}
      {expanded && (
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="p-4 text-center font-mono text-xs text-muted-foreground/50">
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center font-mono text-xs text-muted-foreground/50">
              No sessions yet. Run a script to create one.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sessions.map(sess => (
                <SessionRow key={sess.id} session={sess} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session: s,
  onDelete,
}: {
  session: SessionSummary;
  onDelete: (id: string) => void;
}) {
  const stateColor = {
    stopped: 'text-amber-400',
    error: 'text-red-400',
    running: 'text-cyan-400',
  }[s.finalState] || 'text-muted-foreground';

  const profitColor = s.totalProfit > 0 ? 'text-cyan-400' : s.totalProfit < 0 ? 'text-red-400' : 'text-muted-foreground';
  const ProfitIcon = s.totalProfit >= 0 ? IconArrowUpRight : IconArrowDownRight;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-foreground uppercase">
              {s.game}
            </span>
            <span className={cn('font-mono text-[10px] uppercase', stateColor)}>
              {s.finalState}
            </span>
            {s.mode === 'live' && (
              <span className="font-mono text-[10px] uppercase text-red-400 border border-red-500/30 px-1">
                live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
            <span>{s.totalBets.toLocaleString()} bets</span>
            <span className="text-muted-foreground/30">•</span>
            <span>{formatDate(s.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className={cn('flex items-center gap-1 font-mono text-xs font-semibold', profitColor)}>
          <ProfitIcon size={12} />
          {s.totalProfit >= 0 ? '+' : ''}{s.totalProfit.toFixed(8)}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onDelete(s.id)}
        >
          <IconTrash size={12} />
        </Button>
      </div>
    </div>
  );
}

export default ScriptSessions;
