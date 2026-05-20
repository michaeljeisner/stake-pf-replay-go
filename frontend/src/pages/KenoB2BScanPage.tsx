import { useState, useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  IconDice,
  IconFlame,
  IconHash,
  IconKey,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconTarget,
  IconTrendingUp,
  IconCopy,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Schema for the form
const kenoB2BFormSchema = z.object({
  serverSeed: z.string().min(1, "Server seed is required"),
  clientSeed: z.string().min(1, "Client seed is required"),
  nonceStart: z.number().min(0),
  nonceEnd: z.number().min(1),
  risk: z.enum(["classic", "low", "medium", "high"]),
  pickCount: z.number().min(1).max(10),
  pickerMode: z.enum(["reproducible", "entropy"]),
  b2bThreshold: z.number().min(1),
  topN: z.number().min(0),
});

type KenoB2BFormValues = z.infer<typeof kenoB2BFormSchema>;

const DEFAULT_VALUES: KenoB2BFormValues = {
  serverSeed: "",
  clientSeed: "",
  nonceStart: 0,
  nonceEnd: 100000,
  risk: "high",
  pickCount: 9,
  pickerMode: "reproducible",
  b2bThreshold: 1000,
  topN: 50,
};

const NONCE_PRESETS = [
  { label: "1M", value: 1_000_000 },
  { label: "500K", value: 500_000 },
  { label: "100K", value: 100_000 },
  { label: "10K", value: 10_000 },
];

const RISK_OPTIONS = [
  { value: "classic", label: "CLASSIC", desc: "Balanced variance" },
  { value: "low", label: "LOW", desc: "More wins, lower multi" },
  { value: "medium", label: "MEDIUM", desc: "Standard payouts" },
  { value: "high", label: "HIGH", desc: "Max multipliers" },
];

// Types matching backend
interface KenoBet {
  nonce: number;
  picks: number[];
  draws: number[];
  hits: number;
  multiplier: number;
}

interface B2BSequence {
  startNonce: number;
  endNonce: number;
  cumulativeMultiplier: number;
  streakLength: number;
  bets: KenoBet[];
}

interface KenoB2BResult {
  sequences: B2BSequence[];
  totalFound: number;
  highestMulti: number;
  totalEvaluated: number;
  antebotScript?: string;
}

// Lazy-load Wails bindings
let appBindingsPromise: Promise<
  typeof import("@bindings/bindings/app")
> | null = null;
const getAppBindings = () => {
  if (!appBindingsPromise)
    appBindingsPromise = import("@bindings/bindings/app");
  return appBindingsPromise;
};

// B2B Sequence Card Component
function SequenceCard({
  sequence,
  rank,
}: {
  sequence: B2BSequence;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const formatMultiplier = (multi: number) => {
    if (multi >= 1000000) return `${(multi / 1000000).toFixed(2)}M×`;
    if (multi >= 1000) return `${(multi / 1000).toFixed(2)}K×`;
    return `${multi.toFixed(2)}×`;
  };

  return (
    <div className="group border border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 to-background transition-all hover:border-emerald-500/40">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between p-4 text-left">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center bg-emerald-500/10 font-mono text-lg font-bold text-emerald-400">
                #{rank}
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-emerald-400">
                  {formatMultiplier(sequence.cumulativeMultiplier)}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-emerald-500">
                    {sequence.streakLength} wins
                  </span>
                  <span>•</span>
                  <span>
                    nonce {sequence.startNonce.toLocaleString()} →{" "}
                    {sequence.endNonce.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconTrendingUp className="h-5 w-5 text-emerald-500/50" />
              {expanded ? (
                <IconChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <IconChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-emerald-500/10 bg-black/20 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Bet-by-Bet Breakdown
            </div>
            <div className="space-y-2">
              {sequence.bets.map((bet, idx) => {
                const runningMulti = sequence.bets
                  .slice(0, idx + 1)
                  .reduce((acc, b) => acc * b.multiplier, 1);
                return (
                  <div
                    key={bet.nonce}
                    className="flex items-center justify-between border-l-2 border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{idx + 1}
                      </span>
                      <span className="font-mono text-sm text-foreground">
                        Nonce {bet.nonce.toLocaleString()}
                      </span>
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
                        {bet.hits}/{bet.picks.length} hits
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm text-foreground">
                        {bet.multiplier.toFixed(2)}×
                      </span>
                      <span className="font-mono text-xs text-emerald-400">
                        → {formatMultiplier(runningMulti)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// Results Component
function KenoB2BResults({
  result,
  onCopyScript,
}: {
  result: KenoB2BResult;
  onCopyScript: () => void;
}) {
  const formatMultiplier = (multi: number) => {
    if (multi >= 1000000) return `${(multi / 1000000).toFixed(2)}M×`;
    if (multi >= 1000) return `${(multi / 1000).toFixed(2)}K×`;
    return `${multi.toFixed(2)}×`;
  };

  const avgStreak = useMemo(() => {
    if (result.sequences.length === 0) return 0;
    return (
      result.sequences.reduce((acc, s) => acc + s.streakLength, 0) /
      result.sequences.length
    );
  }, [result.sequences]);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/70">
            Sequences Found
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-emerald-400">
            {result.totalFound}
          </div>
        </div>
        <div className="border border-amber-500/30 bg-gradient-to-br from-amber-950/40 to-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400/70">
            Highest B2B Multi
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-amber-400">
            {formatMultiplier(result.highestMulti)}
          </div>
        </div>
        <div className="border border-blue-500/30 bg-gradient-to-br from-blue-950/40 to-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-blue-400/70">
            Avg Streak Length
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-blue-400">
            {avgStreak.toFixed(1)}
          </div>
        </div>
        <div className="border border-purple-500/30 bg-gradient-to-br from-purple-950/40 to-background p-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-purple-400/70">
            Nonces Evaluated
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-purple-400">
            {result.totalEvaluated.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Antebot Script Export */}
      {result.antebotScript && (
        <div className="border border-cyan-500/30 bg-gradient-to-br from-cyan-950/20 to-background p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-cyan-400">
                Antebot Script
              </div>
              <div className="text-sm text-muted-foreground">
                Copy this script to use the same picker in Antebot for
                reproducible results
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onCopyScript}
              className="gap-2 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
            >
              <IconCopy className="h-4 w-4" />
              Copy Script
            </Button>
          </div>
        </div>
      )}

      {/* Sequences List */}
      <div>
        <div className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Top B2B Sequences (sorted by multiplier)
        </div>
        {result.sequences.length === 0 ? (
          <div className="border border-dashed border-muted-foreground/30 p-8 text-center text-muted-foreground">
            No sequences found meeting the threshold. Try lowering the B2B
            threshold or expanding the nonce range.
          </div>
        ) : (
          <div className="space-y-2">
            {result.sequences.map((seq, idx) => (
              <SequenceCard
                key={`${seq.startNonce}-${seq.endNonce}`}
                sequence={seq}
                rank={idx + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Main Page Component
export function KenoB2BScanPage() {
  const [result, setResult] = useState<KenoB2BResult | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);

  const form = useForm<KenoB2BFormValues>({
    resolver: zodResolver(kenoB2BFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { watch, setValue, reset, handleSubmit, formState } = form;
  const { isSubmitting } = formState;

  const nonceStart = watch("nonceStart");
  const nonceEnd = watch("nonceEnd");
  const pickCount = watch("pickCount");
  const risk = watch("risk");
  const pickerMode = watch("pickerMode");

  const nonceCount = useMemo(
    () => Math.max(0, nonceEnd - nonceStart),
    [nonceStart, nonceEnd]
  );

  const handleCopyScript = useCallback(() => {
    if (result?.antebotScript) {
      navigator.clipboard.writeText(result.antebotScript);
      setScriptCopied(true);
      toast.success("Antebot script copied to clipboard!");
      setTimeout(() => setScriptCopied(false), 2000);
    }
  }, [result]);

  const onSubmit = async (values: KenoB2BFormValues) => {
    try {
      const { StartKenoB2BScan } = await getAppBindings();
      const scanResult = await StartKenoB2BScan({
        Seeds: { Server: values.serverSeed, Client: values.clientSeed },
        NonceStart: values.nonceStart,
        NonceEnd: values.nonceEnd,
        Risk: values.risk,
        PickCount: values.pickCount,
        PickerMode: values.pickerMode,
        B2BThreshold: values.b2bThreshold,
        TopN: values.topN,
      } as any);

      setResult(scanResult as unknown as KenoB2BResult);
      toast.success(`Found ${scanResult.totalFound} B2B sequences!`);
    } catch (error: any) {
      console.error("Keno B2B scan failed:", error);
      toast.error(error?.message ?? "Scan failed");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      {/* Header */}
      <div className="relative overflow-hidden border border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 via-background to-amber-950/20 p-6">
        {/* Decorative pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="grid h-full w-full grid-cols-10 gap-1">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="aspect-square border border-current" />
            ))}
          </div>
        </div>

        <div className="relative flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center border-2 border-emerald-500/50 bg-emerald-500/10 text-emerald-400">
            <IconDice size={28} strokeWidth={1.5} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl uppercase tracking-wider text-foreground">
                Keno B2B Scanner
              </h1>
              <span className="border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                Strategy Tool
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Find high cumulative multipliers from back-to-back winning streaks
              across your seed combination.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Config Summary Bar */}
          <div className="flex flex-wrap items-center gap-3 border border-emerald-500/20 bg-emerald-950/20 px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/70">
              CONFIG
            </span>
            <span className="h-4 w-px bg-emerald-500/30" />
            <span className="font-mono text-xs text-foreground uppercase">
              {risk}
            </span>
            <span className="text-emerald-500/50">•</span>
            <span className="font-mono text-xs text-foreground">
              {pickCount} picks
            </span>
            <span className="text-emerald-500/50">•</span>
            <span className="font-mono text-xs text-emerald-400">
              {nonceCount.toLocaleString()} nonces
            </span>
            <span className="text-emerald-500/50">•</span>
            <span className="font-mono text-xs text-foreground">
              {pickerMode}
            </span>
          </div>

          {/* Seeds Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="flex h-8 w-8 items-center justify-center border border-emerald-500/30 bg-emerald-500/5 text-emerald-400">
                <IconKey size={16} />
              </span>
              <div>
                <span className="font-display text-xs uppercase tracking-wider text-foreground">
                  Seeds
                </span>
                <p className="text-xs text-muted-foreground">
                  Enter your server and client seeds
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                name="serverSeed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Server Seed
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter server seed..."
                        className="border-emerald-500/20 bg-emerald-950/10 font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="clientSeed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Client Seed
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter client seed..."
                        className="border-emerald-500/20 bg-emerald-950/10 font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          {/* Nonce Range Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="flex h-8 w-8 items-center justify-center border border-emerald-500/30 bg-emerald-500/5 text-emerald-400">
                <IconHash size={16} />
              </span>
              <div>
                <span className="font-display text-xs uppercase tracking-wider text-foreground">
                  Nonce Range
                </span>
                <p className="text-xs text-muted-foreground">
                  Define which bets to evaluate
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                name="nonceStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Start
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="border-emerald-500/20 bg-emerald-950/10 font-mono"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
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
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      End
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        className="border-emerald-500/20 bg-emerald-950/10 font-mono"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">
                Evaluating{" "}
                <span className="text-emerald-400">
                  {nonceCount.toLocaleString()}
                </span>{" "}
                nonces
              </span>
              <div className="flex gap-1">
                {NONCE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-emerald-500/20 font-mono text-[10px] uppercase hover:bg-emerald-500/10"
                    onClick={() => setValue("nonceEnd", preset.value)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          </section>

          {/* Keno Config Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="flex h-8 w-8 items-center justify-center border border-emerald-500/30 bg-emerald-500/5 text-emerald-400">
                <IconSettings size={16} />
              </span>
              <div>
                <span className="font-display text-xs uppercase tracking-wider text-foreground">
                  Keno Configuration
                </span>
                <p className="text-xs text-muted-foreground">
                  Set risk level and number of picks
                </p>
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <FormField
                name="risk"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Risk Level
                    </FormLabel>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="grid grid-cols-2 gap-2"
                    >
                      {RISK_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 border p-3 text-left transition-all",
                            field.value === opt.value
                              ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:border-emerald-500/50"
                          )}
                        >
                          <RadioGroupItem value={opt.value} />
                          <div>
                            <div className="font-mono text-sm font-semibold">
                              {opt.label}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {opt.desc}
                            </div>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="pickCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Pick Count{" "}
                      <span className="text-emerald-400">{field.value}</span>
                    </FormLabel>
                    <div className="space-y-3">
                      <Slider
                        min={1}
                        max={10}
                        step={1}
                        value={[field.value]}
                        onValueChange={(val) => field.onChange(val[0])}
                        className="py-2"
                      />
                      <div className="flex gap-1">
                        {[1, 3, 5, 7, 9, 10].map((n) => (
                          <Button
                            key={n}
                            type="button"
                            size="sm"
                            variant={field.value === n ? "default" : "outline"}
                            className="h-7 flex-1 font-mono text-xs"
                            onClick={() => field.onChange(n)}
                          >
                            {n}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          {/* Picker Mode Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="flex h-8 w-8 items-center justify-center border border-cyan-500/30 bg-cyan-500/5 text-cyan-400">
                <IconTarget size={16} />
              </span>
              <div>
                <span className="font-display text-xs uppercase tracking-wider text-foreground">
                  Picker Mode
                </span>
                <p className="text-xs text-muted-foreground">
                  How player numbers are generated
                </p>
              </div>
            </div>
            <FormField
              name="pickerMode"
              render={({ field }) => (
                <FormItem>
                  <ToggleGroup
                    type="single"
                    value={field.value}
                    onValueChange={(val) => val && field.onChange(val)}
                    className="grid grid-cols-2 gap-2"
                  >
                    <ToggleGroupItem
                      value="reproducible"
                      className={cn(
                        "flex h-auto flex-col items-start gap-1 p-4 text-left",
                        field.value === "reproducible" &&
                          "border-cyan-500 bg-cyan-500/10"
                      )}
                    >
                      <div className="font-mono text-sm font-semibold">
                        Reproducible
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Seeded by nonce • Matches Antebot script
                      </div>
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="entropy"
                      className={cn(
                        "flex h-auto flex-col items-start gap-1 p-4 text-left",
                        field.value === "entropy" &&
                          "border-purple-500 bg-purple-500/10"
                      )}
                    >
                      <div className="font-mono text-sm font-semibold">
                        Entropy
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        True random • Simulates Math.random()
                      </div>
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FormMessage />
                </FormItem>
              )}
            />
          </section>

          {/* B2B Strategy Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <span className="flex h-8 w-8 items-center justify-center border border-amber-500/30 bg-amber-500/5 text-amber-400">
                <IconFlame size={16} />
              </span>
              <div>
                <span className="font-display text-xs uppercase tracking-wider text-foreground">
                  B2B Strategy
                </span>
                <p className="text-xs text-muted-foreground">
                  Define success criteria for win streaks
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                name="b2bThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      B2B Threshold
                    </FormLabel>
                    <FormDescription>
                      Minimum cumulative multiplier to record
                    </FormDescription>
                    <FormControl>
                      <Input
                        type="number"
                        step="1"
                        className="border-amber-500/20 bg-amber-950/10 font-mono"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="topN"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Results Limit
                    </FormLabel>
                    <FormDescription>
                      0 = find all, otherwise limit to top N
                    </FormDescription>
                    <FormControl>
                      <Input
                        type="number"
                        step="1"
                        className="border-amber-500/20 bg-amber-950/10 font-mono"
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset(DEFAULT_VALUES);
                setResult(null);
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
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <IconLoader2 size={14} className="animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <IconPlayerPlay size={14} />
                  Start B2B Scan
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>

      {/* Results */}
      {result && (
        <KenoB2BResults result={result} onCopyScript={handleCopyScript} />
      )}
    </div>
  );
}

export default KenoB2BScanPage;
