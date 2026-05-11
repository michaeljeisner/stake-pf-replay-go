import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm, type ControllerRenderProps } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconHash,
  IconKey,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconTarget,
} from '@tabler/icons-react';
import { scanFormSchema, validateGameParams } from '@/lib/validation';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import type * as games from '@bindings/internal/games';
import * as bindings from '@bindings/bindings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyableField } from '@/components/ui/copyable-field';
import { cn } from '@/lib/utils';

interface GameInfo {
  id: string;
  name: string;
  metric_label: string;
}

type ScanFormValues = z.input<typeof scanFormSchema>;

const DEFAULT_VALUES: ScanFormValues = {
  serverSeed: '',
  clientSeed: '',
  nonceStart: 0,
  nonceEnd: 100000,
  game: '',
  params: {},
  targetOp: 'ge',
  targetVal: 1000,
  tolerance: 0,
  limit: 1000,
  timeoutMs: 300_000,
};

const TARGET_OPERATORS = [
  { value: 'ge', label: '≥' },
  { value: 'gt', label: '>' },
  { value: 'eq', label: '=' },
  { value: 'le', label: '≤' },
  { value: 'lt', label: '<' },
] as const;

type NoncePreset = {
  label: string;
  apply: (currentStart: number, currentEnd: number) => { start: number; end: number };
};

const NONCE_PRESETS: NoncePreset[] = [
  { label: '1M', apply: () => ({ start: 0, end: 1_000_000 }) },
  { label: '500K', apply: () => ({ start: 0, end: 500_000 }) },
  { label: '100K', apply: () => ({ start: 0, end: 100_000 }) },
  { label: '10K', apply: () => ({ start: 0, end: 10_000 }) },
];

// Lazy-load Wails bindings
let appBindingsPromise: Promise<typeof import('@bindings/bindings/app')> | null = null;

const getAppBindings = () => {
  if (!appBindingsPromise) appBindingsPromise = import('@bindings/bindings/app');
  return appBindingsPromise;
};

// Section header component
function SectionHeader({ icon, label, sublabel }: { icon: ReactNode; label: string; sublabel?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-3">
      <span className="flex h-8 w-8 items-center justify-center border border-primary/30 bg-primary/5 text-primary">
        {icon}
      </span>
      <div>
        <span className="font-display text-xs uppercase tracking-wider text-foreground">{label}</span>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
    </div>
  );
}

// Game selector combobox
function GameComboboxField({
  field,
  availableGames,
  loading,
}: {
  field: ControllerRenderProps<Record<string, unknown>, 'game'>;
  availableGames: GameInfo[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedGame = availableGames.find((game) => game.id === field.value);

  return (
    <FormItem>
      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Game</FormLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FormControl>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                'w-full justify-between border-border bg-background font-mono text-sm',
                !selectedGame && 'text-muted-foreground'
              )}
              disabled={loading}
            >
              {selectedGame ? (
                <span className="flex items-center gap-2">
                  <span className="text-foreground">{selectedGame.name}</span>
                  <span className="text-muted-foreground">→ {selectedGame.metric_label}</span>
                </span>
              ) : loading ? (
                <span className="flex items-center gap-2">
                  <IconLoader2 size={14} className="animate-spin" />
                  Loading games...
                </span>
              ) : (
                'Select game...'
              )}
              <IconChevronDown size={14} className="text-muted-foreground" />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <Command>
            <CommandInput placeholder="Search games..." className="font-mono" />
            <CommandList>
              {loading ? (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <CommandEmpty>No games found.</CommandEmpty>
                  <CommandGroup>
                    {availableGames.map((game) => (
                      <CommandItem
                        key={game.id}
                        value={game.name}
                        onSelect={() => {
                          field.onChange(game.id);
                          setOpen(false);
                        }}
                        className="font-mono text-sm"
                      >
                        <span className="text-foreground">{game.name}</span>
                        <span className="ml-2 text-muted-foreground">→ {game.metric_label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FormMessage />
    </FormItem>
  );
}

function useMetricLabel(gameId: string | undefined, games: GameInfo[]) {
  return useMemo(() => {
    if (!gameId) return null;
    return games.find((game) => game.id === gameId)?.metric_label ?? null;
  }, [gameId, games]);
}

// Game-specific parameter forms
function DiceParams({ metricLabel }: { metricLabel: string | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.target"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Target {metricLabel && <span className="text-primary">({metricLabel})</span>}
            </FormLabel>
            <div className="space-y-3">
              <Slider
                min={0}
                max={99.99}
                step={0.01}
                value={[field.value ?? 50]}
                onValueChange={(value) => field.onChange(value[0])}
                className="py-2"
              />
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={99.99}
                  step={0.01}
                  className="input-terminal"
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.condition"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Condition</FormLabel>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'over'}
              onValueChange={(value) => value && field.onChange(value)}
              className="grid grid-cols-2"
            >
              <ToggleGroupItem value="over" className="font-mono text-sm">OVER</ToggleGroupItem>
              <ToggleGroupItem value="under" className="font-mono text-sm">UNDER</ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function LimboParams() {
  return (
    <FormField
      name="params.houseEdge"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">House Edge</FormLabel>
          <FormDescription>Standard: 0.99</FormDescription>
          <div className="flex items-center gap-4">
            <Slider
              min={0.01}
              max={1}
              step={0.01}
              value={[field.value ?? 0.99]}
              onValueChange={(value) => field.onChange(Number(value[0].toFixed(2)))}
              className="flex-1"
            />
            <FormControl>
              <Input
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                className="input-terminal w-24"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PumpParams() {
  const difficulties = [
    { value: 'easy', label: 'EASY', tokens: '1 POP' },
    { value: 'medium', label: 'MED', tokens: '3 POP' },
    { value: 'hard', label: 'HARD', tokens: '5 POP' },
    { value: 'expert', label: 'EXPERT', tokens: '10 POP' },
  ];

  return (
    <FormField
      name="params.difficulty"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Difficulty</FormLabel>
          <RadioGroup
            value={(field.value as string) ?? 'expert'}
            onValueChange={field.onChange}
            className="grid grid-cols-2 gap-2"
          >
            {difficulties.map((d) => (
              <label
                key={d.value}
                className={cn(
                  'flex cursor-pointer items-center gap-3 border p-3 text-left transition-all',
                  field.value === d.value
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-muted-foreground'
                )}
              >
                <RadioGroupItem value={d.value} />
                <div>
                  <div className="font-mono text-sm font-semibold">{d.label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{d.tokens}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PlinkoParams() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.risk"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Risk</FormLabel>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'medium'}
              onValueChange={(value) => value && field.onChange(value)}
              className="grid grid-cols-3"
            >
              <ToggleGroupItem value="low" className="font-mono text-xs">LOW</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="font-mono text-xs">MED</ToggleGroupItem>
              <ToggleGroupItem value="high" className="font-mono text-xs">HIGH</ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.rows"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Rows <span className="text-primary">{field.value ?? 16}</span>
            </FormLabel>
            <div className="space-y-3">
              <Slider
                min={8}
                max={16}
                step={1}
                value={[field.value ?? 16]}
                onValueChange={(value) => field.onChange(value[0])}
              />
              <div className="flex gap-1">
                {[8, 10, 12, 14, 16].map((rows) => (
                  <Button
                    key={rows}
                    type="button"
                    size="sm"
                    variant={field.value === rows ? 'default' : 'outline'}
                    className="h-7 flex-1 font-mono text-xs"
                    onClick={() => field.onChange(rows)}
                  >
                    {rows}
                  </Button>
                ))}
              </div>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function WheelParams() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.segments"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Segments</FormLabel>
            <ToggleGroup
              type="single"
              value={String(field.value ?? 10)}
              onValueChange={(value) => value && field.onChange(Number(value))}
              className="grid grid-cols-5"
            >
              {[10, 20, 30, 40, 50].map((seg) => (
                <ToggleGroupItem key={seg} value={String(seg)} className="font-mono text-xs">{seg}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.risk"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Risk</FormLabel>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'low'}
              onValueChange={(value) => value && field.onChange(value)}
              className="grid grid-cols-3"
            >
              <ToggleGroupItem value="low" className="font-mono text-xs">LOW</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="font-mono text-xs">MED</ToggleGroupItem>
              <ToggleGroupItem value="high" className="font-mono text-xs">HIGH</ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function MinesParams() {
  return (
    <FormField
      name="params.mineCount"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Mine Count <span className="text-primary">{field.value ?? 3}</span>
          </FormLabel>
          <div className="space-y-3">
            <Slider
              min={1}
              max={24}
              step={1}
              value={[field.value ?? 3]}
              onValueChange={(value) => field.onChange(value[0])}
            />
            <div className="flex gap-1">
              {[1, 3, 5, 10, 24].map((count) => (
                <Button
                  key={count}
                  type="button"
                  size="sm"
                  variant={field.value === count ? 'default' : 'outline'}
                  className="h-7 flex-1 font-mono text-xs"
                  onClick={() => field.onChange(count)}
                >
                  {count}
                </Button>
              ))}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ChickenParams() {
  return (
    <FormField
      name="params.bones"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Bones <span className="text-primary">{field.value ?? 1}</span>
          </FormLabel>
          <div className="space-y-3">
            <Slider
              min={1}
              max={20}
              step={1}
              value={[field.value ?? 1]}
              onValueChange={(value) => field.onChange(value[0])}
            />
            <div className="flex gap-1">
              {[1, 3, 5, 10, 19].map((count) => (
                <Button
                  key={count}
                  type="button"
                  size="sm"
                  variant={field.value === count ? 'default' : 'outline'}
                  className="h-7 flex-1 font-mono text-xs"
                  onClick={() => field.onChange(count)}
                >
                  {count}
                </Button>
              ))}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function KenoScanParams() {
  const parsePicks = (value: string): number[] => {
    return value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.risk"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Risk</FormLabel>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'classic'}
              onValueChange={(value) => value && field.onChange(value)}
              className="grid grid-cols-4"
            >
              <ToggleGroupItem value="classic" className="font-mono text-xs">CLASSIC</ToggleGroupItem>
              <ToggleGroupItem value="low" className="font-mono text-xs">LOW</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="font-mono text-xs">MED</ToggleGroupItem>
              <ToggleGroupItem value="high" className="font-mono text-xs">HIGH</ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.picks"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Picks (0-39)</FormLabel>
            <FormDescription>Comma-separated unique picks, up to 10 numbers.</FormDescription>
            <FormControl>
              <Input
                className="input-terminal"
                value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                onChange={(e) => field.onChange(parsePicks(e.target.value))}
                placeholder="0, 1, 2, 3, 4, 5, 6, 7, 8, 9"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function GameParams({ gameId, games }: { gameId?: string; games: GameInfo[] }) {
  const metricLabel = useMetricLabel(gameId, games);

  if (!gameId) {
    return (
      <div className="flex items-center gap-2 border border-dashed border-border p-4 text-sm text-muted-foreground">
        <IconSettings size={16} />
        Select a game to configure parameters
      </div>
    );
  }

  switch (gameId) {
    case 'dice':
      return <DiceParams metricLabel={metricLabel} />;
    case 'limbo':
      return <LimboParams />;
    case 'pump':
      return <PumpParams />;
    case 'plinko':
      return <PlinkoParams />;
    case 'wheel':
      return <WheelParams />;
    case 'mines':
      return <MinesParams />;
    case 'chicken':
      return <ChickenParams />;
    case 'keno':
      return <KenoScanParams />;
    default:
      return (
        <div className="border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          No additional parameters required for this game.
        </div>
      );
  }
}

// Advanced constraints panel
function AdvancedPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between border border-border bg-muted/30 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
        >
          <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <IconSettings size={14} />
            Advanced Constraints
          </span>
          <IconChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 border border-t-0 border-border bg-background p-4 md:grid-cols-2">
          <FormField
            name="limit"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Hit Limit</FormLabel>
                <FormDescription>Stop after N matches (default: 1000)</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    className="input-terminal"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="timeoutMs"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Timeout (ms)</FormLabel>
                <FormDescription>Cancel long scans after this duration</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    className="input-terminal"
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Main form component
export function ScanForm() {
  const navigate = useNavigate();
  const [availableGames, setAvailableGames] = useState<GameInfo[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [hashPreview, setHashPreview] = useState('');
  const [hashLoading, setHashLoading] = useState(false);
  const gameLoadAttempts = useRef(0);
  const gameRetryTimer = useRef<number | null>(null);
  const gameErrorShown = useRef(false);

  const form = useForm<ScanFormValues>({
    resolver: zodResolver(scanFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { watch, setValue, clearErrors, setError, reset, handleSubmit, formState } = form;
  const { errors, isSubmitting } = formState;

  const watchedGame = watch('game');
  const watchedServerSeed = watch('serverSeed');
  const nonceStart = watch('nonceStart');
  const nonceEnd = watch('nonceEnd');
  const targetOp = watch('targetOp');
  const targetVal = watch('targetVal');

  // Load games
  useEffect(() => {
    const loadGames = async () => {
      try {
        gameLoadAttempts.current += 1;
        setLoadingGames(true);
        await waitForWailsBinding(['go', 'bindings', 'App', 'GetGames'], { timeoutMs: 10_000 });
        const { GetGames } = await getAppBindings();
        const gameSpecs = await callWithRetry(() => GetGames(), 5, 250);
        if (!Array.isArray(gameSpecs)) throw new Error('Unexpected GetGames response');
        const gameInfos: GameInfo[] = gameSpecs.map((spec: games.GameSpec) => ({
          id: spec.id,
          name: spec.name,
          metric_label: spec.metric_label,
        }));
        setAvailableGames(gameInfos);
        gameErrorShown.current = false;
        if (gameRetryTimer.current !== null) {
          window.clearTimeout(gameRetryTimer.current);
          gameRetryTimer.current = null;
        }
      } catch (error) {
        console.error('Failed to load games:', error);
        if (!gameErrorShown.current) {
          toast.error('Failed to load games, retrying...');
          gameErrorShown.current = true;
        }
        if (gameLoadAttempts.current < 6) {
          gameRetryTimer.current = window.setTimeout(loadGames, 1200);
        }
      } finally {
        setLoadingGames(false);
      }
    };

    loadGames();
    return () => {
      if (gameRetryTimer.current !== null) window.clearTimeout(gameRetryTimer.current);
    };
  }, []);

  // Set default params when game changes
  useEffect(() => {
    if (!watchedGame) return;
    clearErrors('params');
    switch (watchedGame) {
      case 'dice':
        setValue('params.target', 50, { shouldDirty: false });
        setValue('params.condition', 'over', { shouldDirty: false });
        break;
      case 'limbo':
        setValue('params.houseEdge', 0.99, { shouldDirty: false });
        break;
      case 'pump':
        setValue('params.difficulty', 'expert', { shouldDirty: false });
        break;
      case 'plinko':
        setValue('params.risk', 'medium', { shouldDirty: false });
        setValue('params.rows', 16, { shouldDirty: false });
        break;
      case 'wheel':
        setValue('params.segments', 10, { shouldDirty: false });
        setValue('params.risk', 'low', { shouldDirty: false });
        break;
      case 'mines':
        setValue('params.mineCount', 3, { shouldDirty: false });
        break;
      case 'chicken':
        setValue('params.bones', 1, { shouldDirty: false });
        break;
      case 'keno':
        setValue('params.risk', 'classic', { shouldDirty: false });
        setValue('params.picks', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { shouldDirty: false });
        break;
      default:
        setValue('params', {}, { shouldDirty: false });
    }
  }, [watchedGame, clearErrors, setValue]);

  const nonceCount = useMemo(() => {
    const start = Number.isFinite(nonceStart) ? Number(nonceStart) : 0;
    const end = Number.isFinite(nonceEnd) ? Number(nonceEnd) : 0;
    return Math.max(0, end - start);
  }, [nonceStart, nonceEnd]);

  const handleNoncePreset = useCallback(
    (preset: NoncePreset) => {
      const values = preset.apply(nonceStart ?? 0, nonceEnd ?? 0);
      setValue('nonceStart', values.start, { shouldDirty: true });
      setValue('nonceEnd', values.end, { shouldDirty: true });
    },
    [setValue, nonceStart, nonceEnd]
  );

  const handleHashPreview = useCallback(async () => {
    if (!watchedServerSeed.trim()) {
      toast.error('Enter a server seed first');
      return;
    }
    setHashLoading(true);
    try {
      const { HashServerSeed } = await getAppBindings();
      const hash = await HashServerSeed(watchedServerSeed);
      setHashPreview(hash);
    } catch (error) {
      console.error('Failed to hash server seed:', error);
      toast.error('Failed to generate hash');
    } finally {
      setHashLoading(false);
    }
  }, [watchedServerSeed]);

  const onSubmit = async (values: ScanFormValues) => {
    try {
      const data = scanFormSchema.parse(values);
      const paramsSchema = validateGameParams(data.game, data.params);
      const validatedParams = paramsSchema.parse(data.params ?? {});

      const scanRequest = {
        Game: data.game,
        Seeds: { Server: data.serverSeed, Client: data.clientSeed },
        NonceStart: data.nonceStart,
        NonceEnd: data.nonceEnd,
        Params: validatedParams,
        TargetOp: data.targetOp,
        TargetVal: data.targetVal,
        Tolerance: data.tolerance,
        Limit: data.limit,
        TimeoutMs: data.timeoutMs,
      };

      const { StartScan } = await getAppBindings();
      const result = await StartScan(bindings.ScanRequest.createFrom(scanRequest));
      toast.success(`Scan started: ${result.RunID}`);
      navigate(`/runs/${result.RunID}`);
    } catch (error: any) {
      console.error('Scan failed:', error);
      if (error?.name === 'ZodError' && Array.isArray(error.errors)) {
        error.errors.forEach((issue: { path: (string | number)[]; message: string }) => {
          const key = issue.path.join('.') as keyof ScanFormValues;
          setError(key, { message: issue.message });
        });
      } else {
        toast.error(error?.message ?? 'An unexpected error occurred');
      }
    }
  };

  const validationErrors = Object.entries(errors);

  return (
    <TooltipProvider>
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Scan configuration summary bar */}
          <div className="flex flex-wrap items-center gap-3 border border-border bg-muted/30 px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">CONFIG</span>
            <span className="h-4 w-px bg-border" />
            <span className="font-mono text-xs text-foreground">
              {availableGames.find((g) => g.id === watchedGame)?.name ?? '—'}
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="font-mono text-xs text-primary">{nonceCount.toLocaleString()} nonces</span>
            <span className="text-muted-foreground">•</span>
            <span className="font-mono text-xs text-foreground">
              {TARGET_OPERATORS.find((o) => o.value === targetOp)?.label ?? '—'} {targetVal?.toLocaleString() ?? '—'}
            </span>
          </div>

          {/* Seeds section */}
          <section className="space-y-4">
            <SectionHeader icon={<IconKey size={16} />} label="Seeds" sublabel="Enter the server and client seeds" />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                name="serverSeed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Server Seed</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="Enter server seed..."
                          className="input-terminal flex-1"
                          value={field.value ?? ''}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={handleHashPreview}
                            disabled={hashLoading}
                            className="shrink-0"
                          >
                            {hashLoading ? <IconLoader2 size={14} className="animate-spin" /> : <IconHash size={14} />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Generate SHA-256 hash</TooltipContent>
                      </Tooltip>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="clientSeed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Client Seed</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter client seed..."
                        className="input-terminal"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Hash preview */}
            {hashPreview && (
              <div className="border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-primary">SHA-256 Hash</span>
                  <CopyableField value={hashPreview} className="flex-1" />
                </div>
              </div>
            )}
          </section>

          {/* Game section */}
          <section className="space-y-4">
            <SectionHeader icon={<IconTarget size={16} />} label="Game" sublabel="Choose the game and configure parameters" />
            <FormField
              name="game"
              render={({ field }) => <GameComboboxField field={field} availableGames={availableGames} loading={loadingGames} />}
            />
            {watchedGame && (
              <div className="border border-primary/20 bg-primary/5 p-4">
                <GameParams gameId={watchedGame} games={availableGames} />
              </div>
            )}
          </section>

          {/* Nonce range section */}
          <section className="space-y-4">
            <SectionHeader icon={<IconHash size={16} />} label="Nonce Range" sublabel="Define which bets to evaluate" />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                name="nonceStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Start</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="input-terminal"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="nonceEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">End</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="input-terminal"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                Evaluating <span className="text-primary">{nonceCount.toLocaleString()}</span> nonces
              </span>
              <div className="flex gap-1">
                {NONCE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 font-mono text-[10px] uppercase"
                    onClick={() => handleNoncePreset(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          </section>

          {/* Target section */}
          <section className="space-y-4">
            <SectionHeader icon={<IconTarget size={16} />} label="Target" sublabel="Define success criteria" />
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <FormField
                name="targetVal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Value</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.0001"
                        className="input-terminal"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="targetOp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Operator</FormLabel>
                    <ToggleGroup
                      type="single"
                      value={field.value}
                      onValueChange={(value) => value && field.onChange(value)}
                      className="grid grid-cols-5"
                    >
                      {TARGET_OPERATORS.map((op) => (
                        <ToggleGroupItem key={op.value} value={op.value} className="font-mono text-sm">
                          {op.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              name="tolerance"
              render={({ field }) => (
                <FormItem className="max-w-xs">
                  <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Tolerance</FormLabel>
                  <FormDescription>Float comparison tolerance (default: 0)</FormDescription>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.0001"
                      className="input-terminal"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {/* Advanced constraints */}
          <AdvancedPanel />

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-destructive">
                <IconAlertTriangle size={14} />
                Validation Errors
              </div>
              <ul className="mt-2 space-y-1">
                {validationErrors.map(([fieldName, error]) => (
                  <li key={fieldName} className="font-mono text-xs text-destructive/80">
                    <span className="text-destructive">{fieldName}:</span> {error?.message as string}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset(DEFAULT_VALUES);
                setHashPreview('');
              }}
              disabled={isSubmitting}
              className="gap-2"
            >
              <IconRefresh size={14} />
              Reset
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="btn-terminal gap-2"
            >
              {isSubmitting ? (
                <>
                  <IconLoader2 size={14} className="animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <IconPlayerPlay size={14} />
                  Start Scan
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </TooltipProvider>
  );
}
