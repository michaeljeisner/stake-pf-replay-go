import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconChartBar,
  IconChevronDown,
  IconCode,
  IconHash,
  IconKey,
  IconLoader2,
  IconSearch,
  IconSettings,
  IconStack2,
  IconTarget,
} from '@tabler/icons-react';

import { toast } from '@/components/ui/use-toast';
import { callWithRetry } from '@/lib/wails';
import { scanFormSchema, validateGameParams } from '@/lib/validation';
import * as bindings from '@bindings/bindings';
import type { GameSpec } from '@bindings/internal/games/models';

type TargetOp = 'ge' | 'gt' | 'eq' | 'le' | 'lt';

type GameInfo = {
  id: string;
  name: string;
  metric_label: string;
};

type ScanState = {
  serverSeed: string;
  clientSeed: string;
  nonceStart: number;
  nonceEnd: number;
  game: string;
  targetOp: TargetOp;
  targetVal: number;
  tolerance: number;
  limit: number;
  timeoutMs: number;
};

const FALLBACK_GAMES: GameInfo[] = [
  { id: 'limbo', name: 'Limbo', metric_label: 'multiplier' },
  { id: 'dice', name: 'Dice', metric_label: 'roll' },
  { id: 'pump', name: 'Pump', metric_label: 'multiplier' },
  { id: 'plinko', name: 'Plinko', metric_label: 'multiplier' },
  { id: 'wheel', name: 'Wheel', metric_label: 'multiplier' },
  { id: 'mines', name: 'Mines', metric_label: 'first bomb' },
  { id: 'keno', name: 'Keno', metric_label: 'hit index' },
];

const DEFAULT_SCAN: ScanState = {
  serverSeed: '',
  clientSeed: '',
  nonceStart: 0,
  nonceEnd: 100000,
  game: 'limbo',
  targetOp: 'ge',
  targetVal: 1000,
  tolerance: 0,
  limit: 1000,
  timeoutMs: 300000,
};

const navItems = [
  { label: 'Search', icon: IconSearch, path: '/' },
  { label: 'Runs', icon: IconChartBar, path: '/runs' },
  { label: 'Tune', icon: IconAdjustmentsHorizontal, path: '/script' },
  { label: 'Settings', icon: IconSettings, path: '/settings' },
];

const targetOps: Array<{ value: TargetOp; label: string }> = [
  { value: 'lt', label: '<' },
  { value: 'ge', label: '≥' },
  { value: 'gt', label: '>' },
];

const presets = [
  { label: '10K', value: 10000 },
  { label: '100K', value: 100000 },
  { label: '500K', value: 500000 },
  { label: '1M', value: 1000000 },
];

let appBindingsPromise: Promise<typeof import('@bindings/bindings/app')> | null = null;

const getAppBindings = () => {
  if (!appBindingsPromise) appBindingsPromise = import('@bindings/bindings/app');
  return appBindingsPromise;
};

function getDefaultParams(game: string) {
  switch (game) {
    case 'dice':
      return { target: 50, condition: 'over' };
    case 'limbo':
      return { houseEdge: 0.99 };
    case 'pump':
      return { difficulty: 'expert' };
    case 'plinko':
      return { risk: 'medium', rows: 16 };
    case 'wheel':
      return { segments: 10, risk: 'low' };
    case 'mines':
      return { mineCount: 3 };
    case 'chicken':
      return { bones: 1 };
    case 'keno':
      return { risk: 'classic', picks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    default:
      return {};
  }
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomSeedHex(byteLength = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function ScanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [scan, setScan] = useState<ScanState>(DEFAULT_SCAN);
  const [games, setGames] = useState<GameInfo[]>(FALLBACK_GAMES);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHashing, setIsHashing] = useState(false);
  const [hashPreview, setHashPreview] = useState('');

  const selectedGame = games.find((game) => game.id === scan.game) ?? FALLBACK_GAMES[0];
  const nonceCount = Math.max(0, scan.nonceEnd - scan.nonceStart);

  const configSummary = useMemo(() => {
    const operator = targetOps.find((op) => op.value === scan.targetOp)?.label ?? '≥';
    return {
      game: selectedGame.name.toUpperCase(),
      nonces: nonceCount.toLocaleString(),
      target: `${operator} ${scan.targetVal.toLocaleString()}X`,
    };
  }, [nonceCount, scan.targetOp, scan.targetVal, selectedGame.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      try {
        setIsLoadingGames(true);
        const { GetGames } = await getAppBindings();
        const specs = await callWithRetry(() => GetGames(), 2, 200);
        if (cancelled || !Array.isArray(specs) || specs.length === 0) return;
        setGames(
          specs.map((spec: GameSpec) => ({
            id: spec.id,
            name: spec.name,
            metric_label: spec.metric_label,
          })),
        );
      } catch {
        if (!cancelled) setGames(FALLBACK_GAMES);
      } finally {
        if (!cancelled) setIsLoadingGames(false);
      }
    }

    loadGames();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateScan = <K extends keyof ScanState>(key: K, value: ScanState[K]) => {
    setScan((current) => ({ ...current, [key]: value }));
  };

  const handleRotateSeed = () => {
    updateScan('clientSeed', randomSeedHex());
    toast.success('Client seed rotated');
  };

  const handleHash = async () => {
    if (!scan.serverSeed.trim()) {
      toast.error('Enter a server seed first');
      return;
    }

    setIsHashing(true);
    try {
      try {
        const { HashServerSeed } = await getAppBindings();
        setHashPreview(await HashServerSeed(scan.serverSeed));
      } catch {
        setHashPreview(await sha256(scan.serverSeed));
      }
      toast.success('Server seed hash generated');
    } finally {
      setIsHashing(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const data = scanFormSchema.parse({
        ...scan,
        params: getDefaultParams(scan.game),
      });
      const params = validateGameParams(data.game, data.params).parse(data.params ?? {});
      const { StartScan } = await getAppBindings();
      const result = await StartScan(
        bindings.ScanRequest.createFrom({
          Game: data.game,
          Seeds: { Server: data.serverSeed, Client: data.clientSeed },
          NonceStart: data.nonceStart,
          NonceEnd: data.nonceEnd,
          Params: params,
          TargetOp: data.targetOp,
          TargetVal: data.targetVal,
          Tolerance: data.tolerance,
          Limit: data.limit,
          TimeoutMs: data.timeoutMs,
        }),
      );
      toast.success(`Scan started: ${result.RunID}`);
      navigate(`/runs/${result.RunID}`);
    } catch (error: any) {
      toast.error(error?.errors?.[0]?.message ?? error?.message ?? 'Unable to initialize scan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#070808] text-[#f4f4f1]">
      <div className="flex min-h-screen">
        <aside className="flex w-20 shrink-0 flex-col items-center border-r border-[#39414d] bg-[#080909]">
          <button type="button" className="mt-8 text-[#f37018]" aria-label="New scan">
            <IconStack2 size={34} strokeWidth={2.4} />
          </button>
          <nav className="mt-16 flex flex-col items-center gap-7">
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <button
                  type="button"
                  key={item.label}
                  aria-label={item.label}
                  onClick={() => navigate(item.path)}
                  className={active ? 'text-[#f37018]' : 'text-[#8b95a5] hover:text-[#f4f4f1]'}
                >
                  <item.icon size={25} strokeWidth={2} />
                </button>
              );
            })}
          </nav>
          <div className="mt-auto mb-9 flex flex-col items-center gap-8">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-[#8b95a5]">v2.0</span>
            <button type="button" className="text-[#8b95a5] hover:text-[#f4f4f1]" aria-label="Settings">
              <IconSettings size={25} strokeWidth={2} />
            </button>
          </div>
        </aside>

        <main className="relative min-w-0 flex-1">
          <div
            className="absolute inset-0 opacity-90"
            style={{
              backgroundImage:
                'linear-gradient(rgba(54,63,73,0.42) 1px, transparent 1px), linear-gradient(90deg, rgba(54,63,73,0.42) 1px, transparent 1px)',
              backgroundSize: '50px 50px',
            }}
          />
          <div className="relative z-10 flex h-[70px] items-center border-b border-[#39414d] bg-[#080909] px-10">
            <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#8b95a5]">
              System Status: <span className="font-bold text-[#21e679]">Ready</span>
            </span>
            <button
              type="button"
              onClick={handleRotateSeed}
              className="ml-auto border border-[#ff7b20]/80 bg-[#f37018] px-6 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-black transition-colors hover:bg-[#ff8a2f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4f4f1]"
            >
              Rotate Seed
            </button>
          </div>

          <form onSubmit={handleSubmit} className="relative z-10 px-10 pb-10 pt-10">
            <div className="mb-10 flex items-start justify-between gap-8">
              <div className="flex items-start gap-5">
                <div className="flex h-[60px] w-[60px] items-center justify-center border border-[#267fd2] bg-[#0b0d10] text-[#4ba4ff]">
                  <IconCode size={31} strokeWidth={2} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="font-['Inter_Tight'] text-[31px] font-black uppercase leading-none tracking-[-0.04em] text-[#f8f8f4]">
                      New Scan
                    </h1>
                    <span className="border border-[#267fd2] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#4ba4ff]">
                      Provably Fair
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.08em] text-[#7f8796]">
                    Configure seeds, game parameters, and target criteria to replay and analyze outcomes.
                  </p>
                </div>
              </div>

              <div className="hidden min-w-[390px] border border-[#39414d] bg-[#101318]/90 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.08em] lg:block">
                <span className="text-[#77808f]">Config</span>
                <span className="mx-3 text-[#39414d]">|</span>
                <span className="text-[#f4f4f1]">{configSummary.game}</span>
                <span className="ml-6 text-[#4ba4ff]">{configSummary.nonces} Nonces</span>
                <span className="ml-6 text-[#f4f4f1]">{configSummary.target}</span>
              </div>
            </div>

            <div className="grid gap-[30px] xl:grid-cols-[minmax(0,1fr)_460px]">
              <div className="grid gap-[30px]">
                <div className="grid gap-[30px] lg:grid-cols-2">
                <Panel title="Seeds" subtitle="Enter the server and client seeds" icon={<IconKey size={16} />}>
                    <FieldLabel>Server Seed</FieldLabel>
                    <div className="flex">
                      <InputShell
                        value={scan.serverSeed}
                        onChange={(value) => updateScan('serverSeed', value)}
                        placeholder="Enter server seed ..."
                      />
                      <button
                        type="button"
                        onClick={handleHash}
                        className="flex h-[48px] w-11 items-center justify-center border border-l-0 border-[#5d6572] bg-[#11151b] font-mono text-lg text-[#d7d9dd] hover:text-[#4ba4ff]"
                        aria-label="Hash server seed"
                      >
                        {isHashing ? <IconLoader2 size={16} className="animate-spin" /> : '#'}
                      </button>
                    </div>
                    {hashPreview && (
                      <p className="mt-3 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[#4ba4ff]">
                        SHA256: {hashPreview}
                      </p>
                    )}
                    <FieldLabel className="mt-8">Client Seed</FieldLabel>
                    <div className="flex">
                      <InputShell
                        value={scan.clientSeed}
                        onChange={(value) => updateScan('clientSeed', value)}
                        placeholder="Enter client seed ..."
                      />
                    </div>
                  </Panel>

                  <Panel title="Game" subtitle="Choose the game and parameters" icon={<IconSettings size={16} />}>
                    <FieldLabel>Select Game</FieldLabel>
                    <label className="relative block">
                      <select
                        value={scan.game}
                        onChange={(event) => updateScan('game', event.target.value)}
                        className="h-[48px] w-full appearance-none border border-[#5d6572] bg-[#0b0d10] px-3 font-['Inter_Tight'] text-base text-[#f4f4f1] outline-none focus:border-[#4ba4ff]"
                      >
                        {games.map((game) => (
                          <option key={game.id} value={game.id}>
                            {game.name}
                          </option>
                        ))}
                      </select>
                      <IconChevronDown
                        size={17}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8b95a5]"
                      />
                    </label>
                    <div className="mt-5 border-l-2 border-[#4ba4ff] bg-[#111820] px-4 py-4">
                      <p className="font-mono text-[12px] uppercase leading-6 tracking-[0.08em] text-[#c3c8d0]">
                        Selection affects the outcome derivation logic used during the batch calculation process.
                      </p>
                    </div>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-[#7f8796]">
                      {isLoadingGames ? 'Loading game registry ...' : `Metric: ${selectedGame.metric_label}`}
                    </p>
                  </Panel>
                </div>

                <Panel title="Nonce Range" subtitle="Define which bets to evaluate" icon={<IconHash size={16} />}>
                  <div className="grid gap-8 md:grid-cols-[1fr_1fr_280px]">
                    <div>
                      <FieldLabel>Start</FieldLabel>
                      <InputShell
                        type="number"
                        value={scan.nonceStart}
                        onChange={(value) => updateScan('nonceStart', Number(value))}
                      />
                    </div>
                    <div>
                      <FieldLabel>End</FieldLabel>
                      <InputShell
                        type="number"
                        value={scan.nonceEnd}
                        onChange={(value) => updateScan('nonceEnd', Number(value))}
                      />
                    </div>
                    <div className="self-end">
                      <div className="grid grid-cols-4 border border-[#39414d]">
                        {presets.map((preset) => {
                            const active = preset.value === nonceCount;
                          return (
                            <button
                              type="button"
                              key={preset.label}
                              onClick={() => updateScan('nonceEnd', scan.nonceStart + preset.value)}
                              className={`h-8 border-r border-[#39414d] font-mono text-[11px] uppercase last:border-r-0 ${
                                active ? 'bg-[#1b2028] text-[#f4f4f1]' : 'bg-[#11151b] text-[#8b95a5] hover:text-[#f4f4f1]'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-right font-mono text-[10px] uppercase tracking-[0.08em] text-[#8b95a5]">
                        Evaluating <span className="text-[#4ba4ff]">{nonceCount.toLocaleString()}</span> nonces
                      </p>
                    </div>
                  </div>
                </Panel>
              </div>

              <div className="grid content-start gap-[30px]">
                <Panel title="Target" subtitle="Define success criteria" icon={<IconTarget size={16} />}>
                  <FieldLabel>Value</FieldLabel>
                  <InputShell
                    type="number"
                    value={scan.targetVal}
                    onChange={(value) => updateScan('targetVal', Number(value))}
                    className="h-[68px] text-[26px]"
                  />

                  <FieldLabel className="mt-9">Operator</FieldLabel>
                  <div className="grid grid-cols-3 border border-[#39414d]">
                    {targetOps.map((op) => (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => updateScan('targetOp', op.value)}
                        className={`h-[61px] border-r border-[#39414d] font-mono text-xl font-bold last:border-r-0 ${
                          scan.targetOp === op.value ? 'bg-[#f37018] text-black' : 'bg-[#14171c] text-[#f4f4f1] hover:bg-[#1b2028]'
                        }`}
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </Panel>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex h-[120px] flex-col items-center justify-center gap-4 bg-[#f37018] px-6 text-center text-black transition-colors hover:bg-[#ff8a2f] disabled:opacity-70"
                >
                  {isSubmitting ? (
                    <>
                      <IconLoader2 size={24} className="animate-spin" />
                      <span className="font-['Inter_Tight'] text-[24px] font-black uppercase tracking-[0.24em]">Initializing</span>
                    </>
                  ) : (
                    <>
                      <span className="whitespace-nowrap font-['Inter_Tight'] text-[24px] font-black uppercase tracking-[0.24em]">
                        Initialize Analysis Scan
                      </span>
                      <span className="flex items-center gap-3 font-mono text-[10px] font-normal uppercase tracking-[0.08em]">
                        Execute Sequence <IconArrowRight size={18} />
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[#39414d] bg-[#080909]/82 p-6">
      <header className="mb-7 flex items-start gap-4">
        <span className="flex h-[30px] w-[30px] items-center justify-center border border-[#39414d] bg-[#11151b] text-[#c3c8d0]">
          {icon}
        </span>
        <div>
          <h2 className="font-['Inter_Tight'] text-lg font-black uppercase tracking-[0.08em] text-[#f4f4f1]">{title}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.02em] text-[#7f8796]">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function FieldLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={`mb-3 block font-mono text-[11px] font-bold uppercase tracking-[0.02em] text-[#7f8796] ${className}`}>
      {children}
    </label>
  );
}

function InputShell({
  value,
  onChange,
  type = 'text',
  placeholder,
  className = '',
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`h-[48px] w-full border border-[#5d6572] bg-[#0b0d10] px-3 font-mono text-base text-[#f4f4f1] outline-none placeholder:text-[#39414d] focus:border-[#4ba4ff] ${className}`}
    />
  );
}
