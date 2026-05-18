import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBroadcast,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { EventsOn } from '@/lib/wails-events';
import { ListStreams, DeleteStream, IngestInfo } from '@desktop-bindings/internal/livehttp/livemodule';
import * as livestore from '@desktop-bindings/internal/livestore';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

function normalizeStream(s: livestore.LiveStream) {
  const idStr = Array.isArray(s.id) ? s.id.join('-') : String(s.id);

  return {
    id: idStr,
    serverSeedHashed: s.server_seed_hashed ?? '',
    clientSeed: s.client_seed ?? '',
    createdAt: s.created_at ? new Date(s.created_at).toISOString() : '',
    lastSeenAt: s.last_seen_at ? new Date(s.last_seen_at).toISOString() : '',
    notes: s.notes ?? '',
    totalBets: s.total_bets ?? 0,
    highestRoundResult: s.highest_result ?? undefined,
  };
}

type Stream = ReturnType<typeof normalizeStream>;

export default function LiveStreamsListPage() {
  const navigate = useNavigate();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [autoFollow, setAutoFollow] = useState(false);
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    (async () => {
      try {
        await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'IngestInfo'], { timeoutMs: 10_000 });
        const info = await callWithRetry(() => IngestInfo(), 4, 250);
        try {
          const url = new URL(info.url);
          setApiBase(`${url.protocol}//${url.host}`);
        } catch {
          setApiBase('');
        }
      } catch (err) {
        console.warn('Failed to load ingest info', err);
        setApiBase('');
      }
    })();
  }, []);

  const load = async () => {
    try {
      setError(null);
      await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'ListStreams'], { timeoutMs: 10_000 });
      const rows = await callWithRetry(() => ListStreams(200, 0), 4, 300);
      setStreams(rows.map(normalizeStream));
    } catch (e: any) {
      setError(e?.message || 'Failed to load streams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const unsubscribers: Array<() => void> = [];
    for (const s of streams) {
      const off = EventsOn(`live:newrows:${s.id}`, () => load());
      unsubscribers.push(off);
    }
    return () => unsubscribers.forEach((off) => off());
  }, [streams]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const sorted = [...streams].sort((a, b) => {
      const ta = Date.parse(a.lastSeenAt || a.createdAt || '1970-01-01');
      const tb = Date.parse(b.lastSeenAt || b.createdAt || '1970-01-01');
      return tb - ta;
    });
    if (!q) return sorted;
    return sorted.filter((s) => {
      const hash = s.serverSeedHashed?.toLowerCase() ?? '';
      const client = s.clientSeed?.toLowerCase() ?? '';
      return hash.includes(q) || client.includes(q);
    });
  }, [streams, debouncedSearch]);

  const lastAutoFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (!autoFollow || filtered.length === 0 || loading || error) return;
    const latest = filtered[0];
    if (latest?.id && latest.id !== lastAutoFollowed.current && latest.totalBets > 0) {
      lastAutoFollowed.current = latest.id;
      window.setTimeout(() => navigate(`/live/${latest.id}`), 120);
    }
  }, [autoFollow, filtered, navigate, loading, error]);

  const onDelete = async (id: string) => {
    if (!window.confirm('Delete this stream and all associated bets?')) return;
    try {
      await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'DeleteStream'], { timeoutMs: 10_000 });
      await callWithRetry(() => DeleteStream(id), 3, 250);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete stream');
    }
  };

  const openStream = (id: string) => navigate(`/live/${id}`);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-primary/30 bg-primary/10 text-primary shadow-glow">
            <IconBroadcast size={24} strokeWidth={1.5} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Live Streams</h1>
              <span className="badge-terminal">{streams.length} Active</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Monitor active Stake Originals sessions and view live bet feeds.
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by server hash or client seed..."
            className="input-terminal pl-9"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={autoFollow} onCheckedChange={setAutoFollow} />
            <span className="font-mono text-xs uppercase">Auto-follow</span>
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={load}
                  className="h-9 w-9"
                  disabled={loading}
                >
                  <IconRefresh size={14} className={cn(loading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh now</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-3 border border-destructive/50 bg-destructive/10 p-4">
          <IconAlertTriangle size={18} className="shrink-0 text-destructive" />
          <div>
            <p className="font-mono text-sm font-semibold text-destructive">Live streams unavailable</p>
            <p className="mt-1 text-xs text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-3 border border-border bg-card p-12">
          <IconLoader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="font-mono text-sm text-muted-foreground">Loading streams...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-4 border border-border bg-card p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center border border-border bg-muted/30">
            <IconBroadcast size={28} className="text-muted-foreground" />
          </div>
          <div>
            <p className="font-display text-lg uppercase tracking-wider text-foreground">No streams yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Point Antebot to the ingest URL and start betting to populate this list.
            </p>
          </div>
        </div>
      )}

      {/* Stream grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((stream, index) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              apiBase={apiBase}
              onDelete={onDelete}
              onOpen={openStream}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StreamCard({
  stream,
  apiBase,
  onDelete,
  onOpen,
  index,
}: {
  stream: Stream;
  apiBase: string;
  onDelete: (id: string) => Promise<void> | void;
  onOpen: (id: string) => void;
  index: number;
}) {
  const lastSeen = stream.lastSeenAt ? new Date(stream.lastSeenAt).toLocaleString() : '--';
  const exportHref = apiBase ? `${apiBase}/live/streams/${stream.id}/export.csv` : undefined;

  return (
    <div
      className="card-terminal flex h-full flex-col gap-4 p-4 animate-fade-in"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Client Seed</div>
          <p className="mt-1 break-all font-mono text-sm font-medium text-foreground">{stream.clientSeed || '--'}</p>
        </div>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => exportHref && window.open(exportHref, '_blank', 'noopener,noreferrer')}
                  disabled={!exportHref}
                >
                  <IconDownload size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export CSV</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => onDelete(stream.id)}
                >
                  <IconTrash size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete stream</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Server hash */}
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Server Hash</div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {stream.serverSeedHashed ? `${stream.serverSeedHashed.slice(0, 16)}...` : '--'}
        </p>
      </div>

      {/* Stats badges */}
      <div className="flex flex-wrap gap-2">
        <span className="badge-terminal">{stream.totalBets.toLocaleString()} bets</span>
        {stream.highestRoundResult && (
          <span className="badge-hit">Peak {stream.highestRoundResult.toFixed(2)}×</span>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Last seen</div>
          <p className="font-mono text-xs text-foreground">{lastSeen}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpen(stream.id)}
          className="gap-2 font-mono text-xs uppercase"
        >
          Open
          <IconArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}
