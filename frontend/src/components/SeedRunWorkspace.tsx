import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm, type ControllerRenderProps, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconAlertCircle,
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconChecks,
  IconDeviceGamepad,
  IconGauge,
  IconInfoCircle,
  IconNumbers,
  IconPlayerPlay,
  IconRefresh,
  IconRepeat,
  IconSettings,
  IconTarget,
} from '@tabler/icons-react';
import { StartScan, GetGames } from '@bindings/bindings/app';
import * as bindings from '@bindings/bindings';
import * as store from '@bindings/internal/store';
import { scanFormSchema, validateGameParams } from '@/lib/validation';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
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
import type { z } from 'zod';

interface SeedRunWorkspaceProps {
  currentRun: store.Run;
  group: bindings.SeedRunGroup;
  onRunSelected: (runId: string) => void;
  onRunCreated: (runId: string) => void;
  refreshGroup: () => Promise<void>;
  groupLoading: boolean;
}

interface GameInfo {
  id: string;
  name: string;
  metric_label: string;
}

type RerunFormValues = z.input<typeof scanFormSchema>;

const FORM_TIMEOUT_DEFAULT = 300_000;

const TARGET_OPERATORS = [
  { value: 'ge', label: '>=' },
  { value: 'gt', label: '>' },
  { value: 'eq', label: '=' },
  { value: 'le', label: '<=' },
  { value: 'lt', label: '<' },
] as const;

type NoncePreset = {
  label: string;
  apply: (currentEnd: number | undefined, currentRun: store.Run) => { start: number; end: number };
};

const NONCE_PRESETS: NoncePreset[] = [
  {
    label: '0 → 1M',
    apply: () => ({ start: 0, end: 1_000_000 }),
  },
  {
    label: 'Last 100K',
    apply: (currentEnd) => {
      const safeEnd = Number.isFinite(currentEnd) ? Number(currentEnd) : 100_000;
      const end = Math.max(0, safeEnd);
      const start = Math.max(0, end - 100_000);
      return { start, end };
    },
  },
  {
    label: 'Match current run',
    apply: (_, currentRun) => ({ start: currentRun.nonce_start ?? 0, end: currentRun.nonce_end ?? 0 }),
  },
];

function parseParams(run: store.Run): Record<string, unknown> {
  if (!run.params_json) {
    return {};
  }
  try {
    return JSON.parse(run.params_json);
  } catch (error) {
    console.warn('Failed to parse params JSON for run', run.id, error);
    return {};
  }
}

function buildDefaults(run: store.Run, seeds: bindings.SeedGroupSeeds): RerunFormValues {
  return {
    serverSeed: seeds.server ?? '',
    clientSeed: seeds.client ?? '',
    nonceStart: run.nonce_start ?? 0,
    nonceEnd: run.nonce_end ?? 0,
    game: run.game ?? '',
    params: parseParams(run),
    targetOp: (run.target_op as RerunFormValues['targetOp']) ?? 'ge',
    targetVal: run.target_val ?? 0,
    tolerance: run.tolerance ?? 0,
    limit: run.hit_limit && run.hit_limit > 0 ? run.hit_limit : 1000,
    timeoutMs: FORM_TIMEOUT_DEFAULT,
  };
}

function sortRuns(runs: store.Run[]) {
  return [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function useMetricLabel(gameId: string | undefined, games: GameInfo[]) {
  return useMemo(() => {
    if (!gameId) return null;
    return games.find((game) => game.id === gameId)?.metric_label ?? null;
  }, [gameId, games]);
}

function SectionHeader({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-3">
      <span className="flex h-8 w-8 items-center justify-center border border-primary/30 bg-primary/5 text-primary">
        {icon}
      </span>
      <div>
        <span className="font-display text-xs uppercase tracking-wider text-foreground">{title}</span>
        {description && <p className="text-xs font-normal text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function GameComboboxField({
  field,
  availableGames,
  loadingGames,
}: {
  field: ControllerRenderProps<FieldValues, 'game'>;
  availableGames: GameInfo[];
  loadingGames: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedGame = availableGames.find((game) => game.id === field.value);

  return (
    <FormItem className="space-y-3">
      <FormLabel>Game</FormLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FormControl>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between text-left"
              disabled={loadingGames}
            >
              {selectedGame ? (
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{selectedGame.name}</span>
                  <span className="text-xs text-muted-foreground">Metric: {selectedGame.metric_label}</span>
                </span>
              ) : loadingGames ? (
                'Loading games…'
              ) : (
                'Select a game'
              )}
              <IconChevronDown size={16} className="text-muted-foreground" aria-hidden />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <Command>
            <CommandInput placeholder="Search games…" />
            <CommandList>
              {loadingGames ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-8 w-full" />
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
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{game.name}</span>
                          <span className="text-xs text-muted-foreground">{game.metric_label}</span>
                        </div>
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

function HeaderContextChips({
  group,
  runsCount,
  groupLoading,
  onRefresh,
}: {
  group: bindings.SeedRunGroup;
  runsCount: number;
  groupLoading: boolean;
  onRefresh: () => void;
}) {
  const serverHash = group.seeds.serverHash ? `${group.seeds.serverHash.slice(0, 12)}…` : '--';
  const serverSeedPreview = group.seeds.server ? `${group.seeds.server.slice(0, 12)}…` : 'Unavailable';
  const clientSeedPreview = group.seeds.client ?? 'Unavailable';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <CopyableField
        value={group.seeds.serverHash ?? ''}
        displayValue={serverHash}
        label="Server hash"
        className="space-x-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-muted-foreground"
      />
      {group.seeds.server && (
        <CopyableField
          value={group.seeds.server}
          displayValue={serverSeedPreview}
          label="Server seed"
          className="space-x-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-muted-foreground"
        />
      )}
      <CopyableField
        value={group.seeds.client ?? ''}
        displayValue={clientSeedPreview}
        label="Client seed"
        className="space-x-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-muted-foreground"
      />
      <Badge className="border border-[hsl(var(--primary))]/25 bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]">
        {runsCount} run{runsCount === 1 ? '' : 's'}
      </Badge>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground hover:text-foreground"
        onClick={onRefresh}
        disabled={groupLoading}
      >
        <IconRefresh size={14} className={groupLoading ? 'animate-spin' : undefined} aria-hidden />
        {groupLoading ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  );
}

function RunChips({
  runs,
  currentRunId,
  onSelect,
  selectedGame,
  onViewLatest,
}: {
  runs: store.Run[];
  currentRunId: string;
  onSelect: (runId: string) => void;
  selectedGame?: string;
  onViewLatest?: () => void;
}) {
  if (runs.length === 0) {
    return (
      <Badge className="border border-border/70 bg-muted/40 text-muted-foreground">No previous runs yet</Badge>
    );
  }

  const sortedRuns = sortRuns(runs);
  const latestForSelectedGame = selectedGame
    ? sortedRuns.find((run) => run.game === selectedGame)
    : undefined;

  return (
    <div className="flex w-full items-center gap-2 overflow-x-auto pb-2">
      {sortedRuns.map((run) => {
        const isActive = run.id === currentRunId;
        return (
          <Button
            key={run.id}
            type="button"
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'flex-shrink-0 gap-2 whitespace-nowrap px-3 text-xs',
              isActive ? 'shadow-sm' : 'bg-card/60',
            )}
            onClick={() => onSelect(run.id)}
          >
            <Badge className="border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))] uppercase">
              {run.game}
            </Badge>
            <span>{new Date(run.created_at).toLocaleDateString()}</span>
            {isActive ? <IconChecks size={14} aria-hidden /> : <IconArrowRight size={14} aria-hidden />}
          </Button>
        );
      })}
      {latestForSelectedGame && onViewLatest && latestForSelectedGame.id !== currentRunId && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex-shrink-0 gap-1 text-xs text-[hsl(var(--primary))]"
          onClick={onViewLatest}
        >
          <IconPlayerPlay size={14} aria-hidden /> View latest
        </Button>
      )}
    </div>
  );
}

function WheelParams() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.segments"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormLabel>Segments</FormLabel>
            <FormDescription>Number of wheel segments.</FormDescription>
            <ToggleGroup
              type="single"
              value={String(field.value ?? 10)}
              onValueChange={(value) => value && field.onChange(Number(value))}
              className="w-full"
            >
              {[10, 20, 30, 40, 50].map((seg) => (
                <ToggleGroupItem key={seg} value={String(seg)} className="flex-1 text-xs">
                  {seg}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.risk"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormLabel>Risk</FormLabel>
            <FormDescription>Higher risk increases volatility.</FormDescription>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'low'}
              onValueChange={(value) => value && field.onChange(value)}
              className="w-full"
            >
              <ToggleGroupItem value="low" className="flex-1">Low</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="flex-1">Medium</ToggleGroupItem>
              <ToggleGroupItem value="high" className="flex-1">High</ToggleGroupItem>
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
        <FormItem className="space-y-3">
          <FormLabel>
            Mine Count <span className="text-primary">{field.value ?? 3}</span>
          </FormLabel>
          <FormDescription>Number of mines on a 5x5 grid (1-24).</FormDescription>
          <Slider
            min={1}
            max={24}
            step={1}
            value={[field.value ?? 3]}
            onValueChange={(value) => field.onChange(value[0])}
          />
          <div className="flex flex-wrap gap-2">
            {[1, 3, 5, 10, 24].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant={field.value === count ? 'default' : 'outline'}
                onClick={() => field.onChange(count)}
                className="h-8 px-3 text-xs"
              >
                {count}
              </Button>
            ))}
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
        <FormItem className="space-y-3">
          <FormLabel>
            Bones <span className="text-primary">{field.value ?? 1}</span>
          </FormLabel>
          <FormDescription>Number of death tokens per round (1-20).</FormDescription>
          <Slider
            min={1}
            max={20}
            step={1}
            value={[field.value ?? 1]}
            onValueChange={(value) => field.onChange(value[0])}
          />
          <div className="flex flex-wrap gap-2">
            {[1, 3, 5, 10, 19].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant={field.value === count ? 'default' : 'outline'}
                onClick={() => field.onChange(count)}
                className="h-8 px-3 text-xs"
              >
                {count}
              </Button>
            ))}
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
          <FormItem className="space-y-3">
            <FormLabel>Risk</FormLabel>
            <FormDescription>Choose keno risk profile for scanning.</FormDescription>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'classic'}
              onValueChange={(value) => value && field.onChange(value)}
              className="w-full"
            >
              <ToggleGroupItem value="classic" className="flex-1 text-xs">Classic</ToggleGroupItem>
              <ToggleGroupItem value="low" className="flex-1 text-xs">Low</ToggleGroupItem>
              <ToggleGroupItem value="medium" className="flex-1 text-xs">Medium</ToggleGroupItem>
              <ToggleGroupItem value="high" className="flex-1 text-xs">High</ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.picks"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormLabel>Picks (0-39)</FormLabel>
            <FormDescription>Comma-separated unique picks, up to 10 numbers.</FormDescription>
            <FormControl>
              <Input
                className="font-mono"
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

function GameParams({ gameId, games, group, onRunSelected }: {
  gameId?: string;
  games: GameInfo[];
  group: bindings.SeedRunGroup;
  onRunSelected: (runId: string) => void;
}) {
  const metricLabel = useMetricLabel(gameId, games);
  const runs = group.runs ?? [];
  const runsByGame = useMemo(() => {
    const map = new Map<string, store.Run[]>();
    runs.forEach((run) => {
      const existing = map.get(run.game) ?? [];
      existing.push(run);
      map.set(run.game, existing);
    });
    return map;
  }, [runs]);

  const matchingRuns = gameId ? sortRuns(runsByGame.get(gameId) ?? []) : [];

  if (!gameId) {
    return (
      <p className="text-sm text-muted-foreground">Select a game to configure strategy parameters.</p>
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
    case 'roulette':
      return <p className="text-sm text-muted-foreground">Roulette does not require extra parameters.</p>;
    default:
      return matchingRuns.length > 0 ? (
        <Alert
          variant="info"
          icon={<IconInfoCircle size={16} />}
          className="items-center justify-between gap-4"
        >
          <div className="text-sm">
            {matchingRuns.length} run{matchingRuns.length === 1 ? '' : 's'} already exist for this game.
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => onRunSelected(matchingRuns[0].id)}>
            <IconPlayerPlay size={14} className="mr-1" aria-hidden /> View latest
          </Button>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">No parameter requirements for this game.</p>
      );
  }
}

function DiceParams({ metricLabel }: { metricLabel: string | null }) {
  const label = metricLabel ?? 'target';
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
      <FormField
        name="params.target"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="flex items-center justify-between">
              Target
              <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                {label}
              </Badge>
            </FormLabel>
            <FormDescription>Exact value to beat — precision up to two decimals.</FormDescription>
            <div className="space-y-3">
              <Slider
                min={0}
                max={99.99}
                step={0.01}
                value={[field.value ?? 50]}
                onValueChange={(value) => field.onChange(value[0])}
              />
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={99.99}
                  step={0.01}
                  className="font-mono"
                  value={field.value ?? ''}
                  onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
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
          <FormItem className="space-y-3">
            <FormLabel>Condition</FormLabel>
            <FormDescription>Segmented control matches Over/Under gameplay.</FormDescription>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'over'}
              onValueChange={(value) => value && field.onChange(value)}
              className="w-full"
            >
              <ToggleGroupItem value="over" className="flex-1">
                Over
              </ToggleGroupItem>
              <ToggleGroupItem value="under" className="flex-1">
                Under
              </ToggleGroupItem>
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
        <FormItem className="space-y-3">
          <FormLabel>House edge</FormLabel>
          <FormDescription>Typical edge is 0.99.</FormDescription>
          <Slider
            min={0.01}
            max={1}
            step={0.01}
            value={[field.value ?? 0.99]}
            onValueChange={(value) => field.onChange(Number(value[0].toFixed(2)))}
          />
          <FormControl>
            <Input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              className="max-w-[160px] font-mono"
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PumpParams() {
  const options = [
    { value: 'easy', label: 'Easy', description: '1 POP token' },
    { value: 'medium', label: 'Medium', description: '3 POP tokens' },
    { value: 'hard', label: 'Hard', description: '5 POP tokens' },
    { value: 'expert', label: 'Expert', description: '10 POP tokens' },
  ];

  return (
    <FormField
      name="params.difficulty"
      render={({ field }) => (
        <FormItem className="space-y-3">
          <FormLabel>Difficulty</FormLabel>
          <FormDescription>Pick the required POP buy-in.</FormDescription>
          <RadioGroup
            value={(field.value as string) ?? 'expert'}
            onValueChange={field.onChange}
            className="grid gap-2 md:grid-cols-2"
          >
            {options.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-sm transition hover:border-[hsl(var(--primary))] focus-within:ring-2 focus-within:ring-[hsl(var(--primary))] focus-within:ring-offset-2',
                  field.value === option.value && 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5',
                )}
              >
                <RadioGroupItem value={option.value} className="mt-1" />
                <div>
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-muted-foreground">{option.description}</div>
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
  const presetRows = [8, 10, 12, 14, 16];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        name="params.risk"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormLabel>Risk</FormLabel>
            <FormDescription>Higher risk increases volatility.</FormDescription>
            <ToggleGroup
              type="single"
              value={(field.value as string) ?? 'medium'}
              onValueChange={(value) => value && field.onChange(value)}
              className="w-full"
            >
              <ToggleGroupItem value="low" className="flex-1">
                Low
              </ToggleGroupItem>
              <ToggleGroupItem value="medium" className="flex-1">
                Medium
              </ToggleGroupItem>
              <ToggleGroupItem value="high" className="flex-1">
                High
              </ToggleGroupItem>
            </ToggleGroup>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="params.rows"
        render={({ field }) => (
          <FormItem className="space-y-3">
            <FormLabel>Rows</FormLabel>
            <FormDescription>Choose between 8 and 16 rows.</FormDescription>
            <Slider
              min={8}
              max={16}
              step={1}
              value={[field.value ?? 16]}
              onValueChange={(value) => field.onChange(value[0])}
            />
            <div className="flex flex-wrap gap-2">
              {presetRows.map((rows) => (
                <Button
                  key={rows}
                  type="button"
                  size="sm"
                  variant={field.value === rows ? 'default' : 'outline'}
                  onClick={() => field.onChange(rows)}
                  className="h-8 px-3 text-xs"
                >
                  {rows} rows
                </Button>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function AdvancedPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/70 bg-muted/20">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            <IconGauge size={16} aria-hidden /> Advanced constraints
          </span>
          {open ? <IconChevronUp size={16} aria-hidden /> : <IconChevronDown size={16} aria-hidden />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/70 px-4 py-4">
        <div className="grid gap-4 md:grid-cols-3">
          <FormField
            name="tolerance"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tolerance</FormLabel>
                <FormDescription>Higher tolerance widens the acceptable target band.</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    step="0.0001"
                    className="font-mono"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="limit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hit limit</FormLabel>
                <FormDescription>Stops scanning after N matches. Default 1000.</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    className="font-mono"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
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
                <FormLabel className="flex items-center gap-1">
                  Timeout (ms)
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help text-muted-foreground">?</span>
                    </TooltipTrigger>
                    <TooltipContent>Controls worker patience. Lower values surface errors faster.</TooltipContent>
                  </Tooltip>
                </FormLabel>
                <FormDescription>Adjust cautiously — shorter timeouts can interrupt long scans.</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    className="font-mono"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Changing these can affect performance.</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StickyActionsBar({
  isSubmitting,
  onReset,
  onRefresh,
  groupLoading,
}: {
  isSubmitting: boolean;
  onReset: () => void;
  onRefresh: () => void;
  groupLoading: boolean;
}) {
  return (
    <div className="sticky bottom-0 left-0 right-0 -mx-6 mt-6 border-t border-border/70 bg-card/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="gap-2" aria-busy={isSubmitting} disabled={isSubmitting}>
          <IconRepeat size={16} className={isSubmitting ? 'animate-spin' : undefined} aria-hidden />
          {isSubmitting ? 'Starting scan…' : 'Start scan'}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onReset} disabled={isSubmitting}>
          <IconRefresh size={14} aria-hidden /> Reset to current run
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          disabled={groupLoading}
        >
          <IconRefresh size={14} className={groupLoading ? 'animate-spin' : undefined} aria-hidden />
          {groupLoading ? 'Refreshing…' : 'Refresh runs'}
        </Button>
      </div>
    </div>
  );
}

export function SeedRunWorkspace({
  currentRun,
  group,
  onRunCreated,
  onRunSelected,
  refreshGroup,
  groupLoading,
}: SeedRunWorkspaceProps) {
  const [availableGames, setAvailableGames] = useState<GameInfo[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const runs = group.runs ?? [];

  const form = useForm<RerunFormValues>({
    resolver: zodResolver(scanFormSchema),
    defaultValues: buildDefaults(currentRun, group.seeds),
  });

  const { watch, reset, setValue, clearErrors, setError, handleSubmit, formState } = form;

  useEffect(() => {
    reset(buildDefaults(currentRun, group.seeds));
  }, [currentRun, group.seeds, reset]);

  useEffect(() => {
    const loadGames = async () => {
      setLoadingGames(true);
      setFetchError(null);
      try {
        await waitForWailsBinding(['go', 'bindings', 'App', 'GetGames'], { timeoutMs: 10_000 });
        const gameSpecs = await callWithRetry(() => GetGames(), 4, 250);
        if (!Array.isArray(gameSpecs)) {
          throw new Error('Unexpected GetGames response');
        }
        const mapped: GameInfo[] = gameSpecs.map((spec) => ({
          id: spec.id,
          name: spec.name,
          metric_label: spec.metric_label,
        }));
        setAvailableGames(mapped);
      } catch (error) {
        console.error('Failed to load game list', error);
        setFetchError('Failed to load games');
        toast.error('Unable to load available games');
      } finally {
        setLoadingGames(false);
      }
    };

    loadGames();
  }, []);

  const watchedGame = watch('game');
  const watchedParams = watch('params');
  const nonceStart = watch('nonceStart');
  const nonceEnd = watch('nonceEnd');

  useEffect(() => {
    if (!watchedGame) {
      return;
    }
    clearErrors('params');
    switch (watchedGame) {
      case 'dice':
        if (watchedParams?.target === undefined) {
          setValue('params.target', 50, { shouldDirty: false });
        }
        if (watchedParams?.condition === undefined) {
          setValue('params.condition', 'over', { shouldDirty: false });
        }
        break;
      case 'limbo':
        if (watchedParams?.houseEdge === undefined) {
          setValue('params.houseEdge', 0.99, { shouldDirty: false });
        }
        break;
      case 'pump':
        if (watchedParams?.difficulty === undefined) {
          setValue('params.difficulty', 'expert', { shouldDirty: false });
        }
        break;
      case 'plinko':
        if (watchedParams?.risk === undefined) {
          setValue('params.risk', 'medium', { shouldDirty: false });
        }
        if (watchedParams?.rows === undefined) {
          setValue('params.rows', 16, { shouldDirty: false });
        }
        break;
      case 'wheel':
        if (watchedParams?.segments === undefined) {
          setValue('params.segments', 10, { shouldDirty: false });
        }
        if (watchedParams?.risk === undefined) {
          setValue('params.risk', 'low', { shouldDirty: false });
        }
        break;
      case 'mines':
        if (watchedParams?.mineCount === undefined) {
          setValue('params.mineCount', 3, { shouldDirty: false });
        }
        break;
      case 'chicken':
        if (watchedParams?.bones === undefined) {
          setValue('params.bones', 1, { shouldDirty: false });
        }
        break;
      case 'keno':
        if (watchedParams?.risk === undefined) {
          setValue('params.risk', 'classic', { shouldDirty: false });
        }
        if (watchedParams?.picks === undefined) {
          setValue('params.picks', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { shouldDirty: false });
        }
        break;
      default:
        break;
    }
  }, [watchedGame, watchedParams, clearErrors, setValue]);

  const runsByGame = useMemo(() => {
    const map = new Map<string, store.Run[]>();
    for (const run of runs) {
      const existing = map.get(run.game) ?? [];
      existing.push(run);
      map.set(run.game, existing);
    }
    return map;
  }, [runs]);

  const matchingRuns = watchedGame ? sortRuns(runsByGame.get(watchedGame) ?? []) : [];
  const metricLabel = useMetricLabel(watchedGame, availableGames);

  const nonceSliderValue = useMemo(() => {
    const safeStart = Number.isFinite(nonceStart) ? Number(nonceStart) : 0;
    const safeEnd = Number.isFinite(nonceEnd) ? Number(nonceEnd) : safeStart;
    const startValue = Math.min(safeStart, safeEnd);
    const endValue = Math.max(safeStart, safeEnd);
    return [startValue, endValue] as [number, number];
  }, [nonceStart, nonceEnd]);

  const nonceSliderMax = useMemo(() => {
    const [, end] = nonceSliderValue;
    return Math.max(end + 1, 1_000_000);
  }, [nonceSliderValue]);

  const nonceCount = Math.max(0, nonceSliderValue[1] - nonceSliderValue[0]);

  const handleNonceSliderChange = useCallback(
    (value: number[]) => {
      if (value.length < 2) return;
      const [startValue, endValue] = value as [number, number];
      form.setValue('nonceStart', Math.min(startValue, endValue), { shouldDirty: true });
      form.setValue('nonceEnd', Math.max(startValue, endValue), { shouldDirty: true });
    },
    [form],
  );

  const handleNoncePreset = useCallback(
    (preset: NoncePreset) => {
      const values = preset.apply(nonceEnd, currentRun);
      form.setValue('nonceStart', values.start, { shouldDirty: true });
      form.setValue('nonceEnd', values.end, { shouldDirty: true });
    },
    [form, nonceEnd, currentRun],
  );

  const onSubmit = async (values: RerunFormValues) => {
    try {
      const parsed = scanFormSchema.parse(values);
      const paramsSchema = validateGameParams(parsed.game, parsed.params);
      const validatedParams = paramsSchema.parse(parsed.params ?? {});

      const scanRequest = {
        Game: parsed.game,
        Seeds: {
          Server: parsed.serverSeed,
          Client: parsed.clientSeed,
        },
        NonceStart: parsed.nonceStart,
        NonceEnd: parsed.nonceEnd,
        Params: validatedParams,
        TargetOp: parsed.targetOp,
        TargetVal: parsed.targetVal,
        Tolerance: parsed.tolerance,
        Limit: parsed.limit,
        TimeoutMs: parsed.timeoutMs,
      };

      const result = await StartScan(bindings.ScanRequest.createFrom(scanRequest));
      toast.success(`Scan started. Run ID: ${result.RunID}`);
      refreshGroup().catch((error) => console.warn('Failed to refresh seed group', error));
      onRunCreated(result.RunID);
    } catch (error: any) {
      console.error('Seed rerun failed', error);
      if (error?.name === 'ZodError' && Array.isArray(error.errors)) {
        error.errors.forEach((issue: { path: (string | number)[]; message: string }) => {
          const joined = issue.path.join('.') as keyof RerunFormValues;
          setError(joined, { message: issue.message });
        });
      } else {
        toast.error(error?.message ?? 'Failed to start scan');
      }
    }
  };

  return (
    <TooltipProvider>
      <div className="card-terminal">
        <div className="space-y-4 border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
                <IconRepeat size={18} />
              </div>
              <h2 className="font-display text-sm uppercase tracking-wider text-foreground">
                Seed Run Workspace
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => setIsExpanded((value) => !value)}
              aria-expanded={isExpanded}
              aria-controls={contentId}
            >
              {isExpanded ? <IconChevronUp size={16} aria-hidden /> : <IconChevronDown size={16} aria-hidden />}
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          </div>

          <HeaderContextChips
            group={group}
            runsCount={runs.length}
            groupLoading={groupLoading}
            onRefresh={() => {
              refreshGroup().catch((error) => console.warn('Failed to refresh seed group', error));
            }}
          />

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconChecks size={16} className="text-cyan-300" aria-hidden />
              <span>Existing variations</span>
            </div>
            <RunChips
              runs={runs}
              currentRunId={currentRun.id}
              onSelect={onRunSelected}
              selectedGame={watchedGame}
              onViewLatest={matchingRuns.length > 0 ? () => onRunSelected(matchingRuns[0].id) : undefined}
            />
          </div>
          {!isExpanded && (
            <p className="text-xs text-muted-foreground">Expand to build scans, tweak advanced constraints, and start new runs.</p>
          )}
        </div>
        <div
          id={contentId}
          className={cn('space-y-8 p-6', !isExpanded && 'hidden')}
          aria-hidden={!isExpanded}
        >
          {fetchError && (
            <Alert variant="destructive" icon={<IconAlertCircle size={16} />}>
              {fetchError}
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
              <input type="hidden" {...form.register('serverSeed')} />
              <input type="hidden" {...form.register('clientSeed')} />

              <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)]">
                <div className="space-y-8">
                  <section className="space-y-4">
                    <SectionHeader icon={<IconDeviceGamepad size={16} />} title="Game" description="Choose the game profile" />
                    <FormField
                      name="game"
                      render={({ field }) => (
                        <GameComboboxField
                          field={field}
                          availableGames={availableGames}
                          loadingGames={loadingGames}
                        />
                      )}
                    />
                    {matchingRuns.length > 0 && (
                      <Alert
                        variant="info"
                        icon={<IconInfoCircle size={16} />}
                        className="items-center justify-between gap-4"
                      >
                        <div className="text-sm">
                          {matchingRuns.length} run{matchingRuns.length === 1 ? '' : 's'} already exist for this game.
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={() => onRunSelected(matchingRuns[0].id)}>
                          <IconPlayerPlay size={14} className="mr-1" aria-hidden /> View latest
                        </Button>
                      </Alert>
                    )}
                  </section>

                  <section className="space-y-4">
                    <SectionHeader icon={<IconNumbers size={16} />} title="Nonce range" description="Define what to scan" />
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          name="nonceStart"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Start</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  className="font-mono"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                                  }
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
                              <FormLabel>End</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  className="font-mono"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="space-y-3">
                        <Slider
                          min={0}
                          max={nonceSliderMax}
                          step={1}
                          value={nonceSliderValue}
                          onValueChange={handleNonceSliderChange}
                        />
                        <div aria-live="polite" className="text-xs text-muted-foreground">
                          Evaluating {nonceCount.toLocaleString()} nonces
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {NONCE_PRESETS.map((preset) => (
                            <Tooltip key={preset.label}>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-3 text-xs"
                                  onClick={() => handleNoncePreset(preset)}
                                >
                                  {preset.label}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Apply preset range {preset.label}.
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <SectionHeader icon={<IconTarget size={16} />} title="Target" description="Tell us what success looks like" />
                    <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                      <FormField
                        name="targetOp"
                        render={({ field }) => (
                          <FormItem className="space-y-3">
                            <FormLabel>Operator</FormLabel>
                            <FormDescription>Select the comparative operator.</FormDescription>
                            <ToggleGroup
                              type="single"
                              value={field.value}
                              onValueChange={(value) => value && field.onChange(value)}
                              className="w-full"
                            >
                              {TARGET_OPERATORS.map((option) => (
                                <ToggleGroupItem key={option.value} value={option.value} className="flex-1">
                                  {option.label}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        name="targetVal"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Value</FormLabel>
                            <FormDescription>
                              {metricLabel ? `Measured in ${metricLabel}.` : 'Provide the metric threshold.'}
                            </FormDescription>
                            <FormControl>
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  step="0.0001"
                                  className="font-mono"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
                                  }
                                />
                                {metricLabel && (
                                  <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                                    {metricLabel}
                                  </Badge>
                                )}
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </section>

                  <section className="space-y-4">
                    <SectionHeader icon={<IconSettings size={16} />} title="Game parameters" description="Adjust knobs unique to each game" />
                    <GameParams gameId={watchedGame} games={availableGames} group={group} onRunSelected={onRunSelected} />
                  </section>

                  <section className="space-y-4">
                    <SectionHeader icon={<IconGauge size={16} />} title="Constraints" description="Optional limits" />
                    <AdvancedPanel />
                  </section>
                </div>
              </div>

              <StickyActionsBar
                isSubmitting={formState.isSubmitting}
                onReset={() => reset(buildDefaults(currentRun, group.seeds))}
                onRefresh={() => {
                  refreshGroup().catch((error) => console.warn('Failed to refresh seed group', error));
                }}
                groupLoading={groupLoading}
              />
            </form>
          </Form>
        </div>
      </div>
    </TooltipProvider>
  );
}
