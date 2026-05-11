/**
 * ScriptPage — Overhauled
 *
 * Full-featured scripting interface with CodeMirror editor, template library,
 * live recharts profit chart, session timer, mode toggle, and filterable log.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconTerminal2,
  IconCode,
  IconChartLine,
  IconActivity,
  IconClock,
  IconTrophy,
  IconMoodSad,
  IconArrowUpRight,
  IconArrowDownRight,
  IconFlame,
  IconTrash,
  IconAlertTriangle,
  IconFileCode,
  IconSearch,
  IconCopy,
  IconShieldCheck,
} from '@tabler/icons-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { ScriptSessions } from '@/components/ScriptSessions';

// --- CodeMirror editor component ---
import { useCodeMirror } from '@/hooks/useCodeMirror';

// Types matching Go ScriptState
interface ScriptState {
  state: 'idle' | 'running' | 'stopped' | 'error';
  error?: string;
  mode?: string;
  sessionId?: string;
  bets: number;
  wins: number;
  losses: number;
  profit: number;
  balance: number;
  wagered: number;
  winStreak: number;
  loseStreak: number;
  currentGame: string;
  betsPerSecond: number;
  chart?: { x: number; y: number; win: boolean }[];
}

interface LogEntry {
  time: string;
  message: string;
}

// --- Script Templates ---
const TEMPLATES: { name: string; description: string; script: string }[] = [
  {
    name: 'Martingale',
    description: 'Double on loss, reset on win',
    script: `// Martingale — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
nextbet = basebet

dobet = function() {
  if (win) {
    nextbet = basebet
  } else {
    nextbet = previousbet * 2
  }
}`,
  },
  {
    name: "D'Alembert",
    description: 'Linear progression',
    script: `// D'Alembert — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
unit = basebet
nextbet = basebet

dobet = function() {
  if (win) {
    nextbet = Math.max(basebet, nextbet - unit)
  } else {
    nextbet = nextbet + unit
  }
}`,
  },
  {
    name: 'Fibonacci',
    description: 'Fibonacci sequence on losses',
    script: `// Fibonacci — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
nextbet = basebet
var fib_prev = basebet
var fib_curr = basebet

dobet = function() {
  if (win) {
    fib_prev = basebet
    fib_curr = basebet
    nextbet = basebet
  } else {
    var temp = fib_curr
    fib_curr = fib_prev + fib_curr
    fib_prev = temp
    nextbet = fib_curr
  }
}`,
  },
  {
    name: 'Flat Bet',
    description: 'Fixed bet amount, no progression',
    script: `// Flat Bet — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
nextbet = basebet

dobet = function() {
  nextbet = basebet
}`,
  },
  {
    name: 'Streak Hunter',
    description: 'Increase after N consecutive losses',
    script: `// Streak Hunter — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
nextbet = basebet
var streak_trigger = 3
var streak_multiplier = 5

dobet = function() {
  if (win) {
    nextbet = basebet
  } else if (losestreak >= streak_trigger) {
    nextbet = basebet * streak_multiplier
  } else {
    nextbet = basebet
  }
}`,
  },
  {
    name: 'Labouchere',
    description: 'Cancellation system',
    script: `// Labouchere — Dice
chance = 49.5
bethigh = true
basebet = 0.00000001
var sequence = [1, 2, 3, 4, 5]
var seq = sequence.slice()

function getBet() {
  if (seq.length === 0) seq = sequence.slice()
  if (seq.length === 1) return seq[0] * basebet
  return (seq[0] + seq[seq.length - 1]) * basebet
}

nextbet = getBet()

dobet = function() {
  if (win) {
    if (seq.length <= 2) {
      seq = sequence.slice()
    } else {
      seq.shift()
      seq.pop()
    }
  } else {
    var bet_units = seq.length <= 1 ? seq[0] || 1 : seq[0] + seq[seq.length - 1]
    seq.push(bet_units)
  }
  nextbet = getBet()
}`,
  },
];

const DEFAULT_SCRIPT = TEMPLATES[0].script;
const LIVE_GAMES = new Set(['dice', 'limbo']);

// Lazy-load Wails bindings
let scriptBindingsPromise: Promise<typeof import('@bindings/bindings/scriptmodule')> | null = null;
const getScriptBindings = () => {
  if (!scriptBindingsPromise) scriptBindingsPromise = import('@bindings/bindings/scriptmodule');
  return scriptBindingsPromise;
};

export function ScriptPage() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [selectedGame, setSelectedGame] = useState('dice');
  const [selectedCurrency, setSelectedCurrency] = useState('trx');
  const [startBalance, setStartBalance] = useState(1.0);
  const [selectedMode, setSelectedMode] = useState<'simulated' | 'live'>('simulated');
  const [showTemplates, setShowTemplates] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [state, setState] = useState<ScriptState>({
    state: 'idle',
    bets: 0, wins: 0, losses: 0, profit: 0, balance: 0,
    wagered: 0, winStreak: 0, loseStreak: 0,
    currentGame: '', betsPerSecond: 0,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // CodeMirror editor
  const editorRef = useRef<HTMLDivElement>(null);
  useCodeMirror({
    container: editorRef,
    value: script,
    onChange: setScript,
    readOnly: state.state === 'running',
  });

  useEffect(() => {
    if (selectedMode === 'live' && !LIVE_GAMES.has(selectedGame)) {
      setSelectedGame('dice');
    }
  }, [selectedMode, selectedGame]);

  // Poll script state while running
  const pollState = useCallback(async () => {
    try {
      const { GetScriptState, GetScriptLog } = await getScriptBindings();
      const [newState, newLogs] = await Promise.all([
        GetScriptState(),
        GetScriptLog(),
      ]);
      setState(newState as unknown as ScriptState);
      if (newLogs && Array.isArray(newLogs)) {
        setLogs(newLogs as LogEntry[]);
      }
    } catch {
      // Bindings not ready yet
    }
  }, []);

  useEffect(() => {
    if (state.state === 'running') {
      pollRef.current = window.setInterval(pollState, 500);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.state, pollState]);

  // Session timer
  useEffect(() => {
    if (state.state === 'running') {
      if (!startedAt) setStartedAt(Date.now());
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startedAt || Date.now())) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (state.state === 'idle') {
        setElapsed(0);
        setStartedAt(null);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state.state, startedAt]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleStart = useCallback(async () => {
    if (selectedMode === 'live') {
      const confirmed = window.confirm(
        'You are about to start a LIVE betting session.\n\nThis will place REAL bets with REAL money.\n\nAre you sure?'
      );
      if (!confirmed) return;
    }

    setStarting(true);
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      const { StartScript } = await getScriptBindings();
      await StartScript(script, selectedGame, selectedCurrency, startBalance, selectedMode);
      setState(prev => ({ ...prev, state: 'running' }));
      toast.success(`Script started (${selectedMode} mode)`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start script');
      setStartedAt(null);
    } finally {
      setStarting(false);
    }
  }, [script, selectedGame, selectedCurrency, startBalance, selectedMode]);

  const handleStop = useCallback(async () => {
    try {
      const { StopScript } = await getScriptBindings();
      await StopScript();
      await pollState();
      toast.success('Script stopped');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to stop script');
    }
  }, [pollState]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const handleLoadTemplate = useCallback((tmpl: typeof TEMPLATES[0]) => {
    setScript(tmpl.script);
    setShowTemplates(false);
  }, []);

  const isRunning = state.state === 'running';
  const winRate = state.bets > 0 ? ((state.wins / state.bets) * 100).toFixed(1) : '0.0';

  // Filtered logs
  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter(e => e.message.toLowerCase().includes(q));
  }, [logs, logFilter]);

  // Format elapsed time
  const formatElapsed = (secs: number) => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/5 text-primary">
            <IconCode size={20} />
          </div>
          <div>
            <h1 className="font-display text-sm uppercase tracking-wider text-foreground">Script Engine</h1>
            <p className="text-xs text-muted-foreground">bot2love-compatible betting automation</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Session timer */}
          {(isRunning || elapsed > 0) && (
            <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <IconClock size={12} />
              {formatElapsed(elapsed)}
            </div>
          )}

          {/* Mode indicator */}
          {selectedMode === 'live' && (
            <div className="flex items-center gap-1.5 border border-red-500/30 bg-red-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-red-400">
              <IconAlertTriangle size={10} />
              Live Mode
            </div>
          )}

          {/* Status badge */}
          <div className={cn(
            'flex items-center gap-2 border px-3 py-1.5 font-mono text-xs uppercase tracking-wider',
            state.state === 'running' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
            state.state === 'idle' && 'border-border bg-muted/30 text-muted-foreground',
            state.state === 'stopped' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
            state.state === 'error' && 'border-red-500/30 bg-red-500/10 text-red-400',
          )}>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              state.state === 'running' && 'bg-cyan-400 animate-pulse',
              state.state === 'idle' && 'bg-muted-foreground',
              state.state === 'stopped' && 'bg-amber-400',
              state.state === 'error' && 'bg-red-400',
            )} />
            {state.state}
          </div>
        </div>
      </div>

      {/* Error display */}
      {state.error && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 font-mono text-xs text-red-400">
          {state.error}
        </div>
      )}

      {/* Main grid: Editor + Stats */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Editor panel */}
        <div className="flex flex-col gap-3">
          {/* Editor toolbar */}
          <div className="flex items-center justify-between border border-border bg-muted/30 px-4 py-2">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <IconTerminal2 size={12} />
              Script Editor
            </span>
            <div className="flex items-center gap-2">
              {/* Template button */}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowTemplates(!showTemplates)}
                disabled={isRunning}
              >
                <IconFileCode size={12} />
                Templates
              </Button>

              <div className="h-4 w-px bg-border" />

              {/* Mode toggle */}
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value as 'simulated' | 'live')}
                disabled={isRunning}
                className={cn(
                  'h-7 border px-2 font-mono text-[11px] uppercase tracking-wider',
                  selectedMode === 'live'
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-border bg-background text-foreground',
                )}
              >
                <option value="simulated">Sim</option>
                <option value="live">Live</option>
              </select>

              <select
                value={selectedGame}
                onChange={(e) => setSelectedGame(e.target.value)}
                disabled={isRunning}
                className="h-7 border border-border bg-background px-2 font-mono text-[11px] uppercase tracking-wider text-foreground"
              >
                <option value="dice">Dice</option>
                <option value="limbo">Limbo</option>
                {selectedMode !== 'live' && (
                  <>
                    <option value="wheel">Wheel</option>
                    <option value="keno">Keno</option>
                    <option value="mines">Mines</option>
                    <option value="plinko">Plinko</option>
                    <option value="hilo">HiLo</option>
                    <option value="blackjack">Blackjack</option>
                    <option value="baccarat">Baccarat</option>
                    <option value="roulette">Roulette</option>
                  </>
                )}
              </select>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                disabled={isRunning}
                className="h-7 border border-border bg-background px-2 font-mono text-[11px] uppercase tracking-wider text-foreground"
              >
                <option value="trx">TRX</option>
                <option value="usdc">USDC</option>
                <option value="btc">BTC</option>
                <option value="eth">ETH</option>
                <option value="doge">DOGE</option>
                <option value="ltc">LTC</option>
              </select>
              <input
                type="number"
                min={0.00000001}
                step={0.00000001}
                value={startBalance}
                onChange={(e) => setStartBalance(Number(e.target.value))}
                disabled={isRunning}
                className="h-7 w-24 border border-border bg-background px-2 font-mono text-[11px] text-foreground"
                title="Starting balance"
              />
              {!isRunning ? (
                <Button
                  size="sm"
                  className={cn(
                    'gap-2 h-7 text-xs',
                    selectedMode === 'live'
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'btn-terminal',
                  )}
                  onClick={handleStart}
                  disabled={starting || !script.trim()}
                >
                  {starting ? (
                    <IconActivity size={12} className="animate-spin" />
                  ) : selectedMode === 'live' ? (
                    <IconShieldCheck size={12} />
                  ) : (
                    <IconPlayerPlay size={12} />
                  )}
                  {starting ? 'Starting...' : selectedMode === 'live' ? 'Go Live' : 'Run'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-2 h-7 text-xs"
                  onClick={handleStop}
                >
                  <IconPlayerStop size={12} />
                  Stop
                </Button>
              )}
            </div>
          </div>

          {/* Template library dropdown */}
          {showTemplates && !isRunning && (
            <div className="border border-primary/20 bg-[hsl(var(--card))] p-3">
              <span className="block mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Script Templates
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TEMPLATES.map(t => (
                  <button
                    key={t.name}
                    onClick={() => handleLoadTemplate(t)}
                    className="flex flex-col items-start p-2.5 border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
                  >
                    <span className="font-mono text-xs font-semibold text-foreground">{t.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* CodeMirror editor */}
          <div
            ref={editorRef}
            className={cn(
              'min-h-[400px] border border-border overflow-hidden',
              isRunning && 'opacity-60 pointer-events-none',
            )}
          />

          {/* Session history */}
          <ScriptSessions />

          {/* Log panel */}
          <div className="flex flex-col border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <IconTerminal2 size={12} />
                Log Output
                {logs.length > 0 && (
                  <span className="text-primary">{logs.length}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {/* Log filter */}
                <div className="relative">
                  <IconSearch size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    type="text"
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    placeholder="Filter..."
                    className="h-6 w-28 border border-border bg-background pl-6 pr-2 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={handleClearLogs}
                >
                  <IconTrash size={12} />
                </Button>
              </div>
            </div>
            <div className="h-[180px] overflow-y-auto bg-[hsl(var(--card))] p-3 scrollbar-thin">
              {filteredLogs.length === 0 ? (
                <span className="font-mono text-xs text-muted-foreground/50">
                  {logFilter ? 'No matching log entries' : 'Script output will appear here...'}
                </span>
              ) : (
                filteredLogs.map((entry, i) => (
                  <div key={i} className="group flex items-start justify-between font-mono text-xs leading-relaxed">
                    <div>
                      <span className="text-muted-foreground/60">
                        [{new Date(entry.time).toLocaleTimeString()}]
                      </span>{' '}
                      <span className="text-foreground">{entry.message}</span>
                    </div>
                    <button
                      className="ml-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(entry.message);
                        toast.success('Copied to clipboard');
                      }}
                    >
                      <IconCopy size={10} />
                    </button>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Stats panel */}
        <div className="flex flex-col gap-3">
          {/* Profit chart — recharts AreaChart */}
          <div className="border border-border">
            <div className="border-b border-border bg-muted/30 px-4 py-2">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <IconChartLine size={12} />
                Profit Chart
              </span>
            </div>
            <div className="h-[140px] p-2">
              {state.chart && state.chart.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={state.chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <YAxis hide domain={['auto', 'auto']} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.2} strokeDasharray="3 3" />
                    <Area
                      type="monotone"
                      dataKey="y"
                      stroke="hsl(var(--primary))"
                      strokeWidth={1.5}
                      fill="url(#profitGradient)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground/50">
                  Chart data will appear after bets...
                </div>
              )}
            </div>
          </div>

          {/* Session stats */}
          <div className="border border-border">
            <div className="border-b border-border bg-muted/30 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Session Stats
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              <StatCell icon={IconActivity} label="Bets" value={state.bets.toLocaleString()} />
              <StatCell icon={IconFlame} label="Speed" value={`${state.betsPerSecond.toFixed(1)}/s`} />
              <StatCell icon={IconTrophy} label="Wins" value={state.wins.toLocaleString()} accent="cyan" />
              <StatCell icon={IconMoodSad} label="Losses" value={state.losses.toLocaleString()} accent="red" />
              <StatCell icon={IconArrowUpRight} label="Win Rate" value={`${winRate}%`} accent="cyan" />
              <StatCell icon={IconClock} label="Game" value={state.currentGame || '—'} />
            </div>
          </div>

          {/* Financial stats */}
          <div className="border border-border">
            <div className="border-b border-border bg-muted/30 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Financials
              </span>
            </div>
            <div className="space-y-0 divide-y divide-border">
              <FinancialRow label="Profit" value={state.profit} format="signed" />
              <FinancialRow label="Balance" value={state.balance} format="plain" />
              <FinancialRow label="Wagered" value={state.wagered} format="plain" />
            </div>
          </div>

          {/* Streak stats */}
          <div className="border border-border">
            <div className="border-b border-border bg-muted/30 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Streaks
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              <StatCell icon={IconArrowUpRight} label="Win Streak" value={state.winStreak.toString()} accent="cyan" />
              <StatCell icon={IconArrowDownRight} label="Lose Streak" value={state.loseStreak.toString()} accent="red" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: 'cyan' | 'red' | 'amber';
}) {
  const accentClass = {
    cyan: 'text-cyan-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
  };

  return (
    <div className="bg-background p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={10} className="text-muted-foreground" />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <span className={cn(
        'font-mono text-sm font-semibold',
        accent ? accentClass[accent] : 'text-foreground'
      )}>
        {value}
      </span>
    </div>
  );
}

function FinancialRow({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format: 'signed' | 'plain';
}) {
  const formatted = format === 'signed'
    ? (value >= 0 ? '+' : '') + value.toFixed(8)
    : value.toFixed(8);

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        'font-mono text-xs font-semibold',
        format === 'signed' && value > 0 && 'text-cyan-400',
        format === 'signed' && value < 0 && 'text-red-400',
        format === 'signed' && value === 0 && 'text-muted-foreground',
        format === 'plain' && 'text-foreground',
      )}>
        {formatted}
      </span>
    </div>
  );
}

export default ScriptPage;
