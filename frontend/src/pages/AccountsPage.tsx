import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconLock,
  IconPlug,
  IconPlugOff,
  IconPlus,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  Connect,
  ConnectionCheck,
  DeleteAccount,
  Disconnect,
  GetActiveStatus,
  GetSecretsMasked,
  ListAccounts,
  OpenCasinoInBrowser,
  RepairSession,
  SaveAccount,
  SetSecrets,
} from '@bindings/bindings/authmodule';
import { GetLedgerSummary, ListLedgerEntries, SyncHistoryEntries } from '@desktop-bindings/internal/livehttp/livemodule';

type Account = {
  id: string;
  label: string;
  mirror: string;
  currency: string;
  profileId: string;
  connectionState: string;
  lastCheckAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ActiveStatus = {
  connected: boolean;
  state: string;
  reason?: { code?: string; message?: string };
  lastCheckAt?: string;
  accountId?: string;
  error?: string;
  balances?: { currency: string; available: number; vault: number }[];
};

type StepResult = { name: string; success: boolean; message?: string };
type ConnectionCheckResult = { ok: boolean; state: string; reason?: { code?: string; message?: string }; lastCheckAt?: string; steps: StepResult[] };
type SecretsMasked = { hasApiKey: boolean; hasClearance: boolean; hasUserAgent: boolean };
type LedgerEntry = {
  id: number;
  account_id: string;
  source: string;
  game: string;
  external_bet_id?: string;
  idempotency_key: string;
  currency: string;
  nonce: number;
  amount: number;
  payout: number;
  payout_multiplier: number;
  response_json?: string;
  created_at: string;
};
type LedgerGameSummary = {
  game: string;
  source: string;
  count: number;
  wagered: number;
  payout: number;
  profit: number;
  win_count: number;
  last_nonce: number;
};
type LedgerSummary = {
  account_id: string;
  count: number;
  wagered: number;
  payout: number;
  profit: number;
  roi: number;
  win_count: number;
  by_game: LedgerGameSummary[];
};

const DOMAIN_OPTIONS = ['stake.com', 'stake.us', 'stake.bet'];
const CURRENCY_OPTIONS = ['btc', 'eth', 'ltc', 'trx', 'usdc', 'doge', 'xrp'];
const STATE_LABELS: Record<string, string> = {
  not_configured: 'Not Configured',
  needs_login: 'Needs Login',
  checking: 'Checking',
  connected: 'Connected',
  needs_browser_repair: 'Repair Session',
  credential_failed: 'Credential Failed',
  disconnected: 'Disconnected',
};

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedID, setSelectedID] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [activeStatus, setActiveStatus] = useState<ActiveStatus>({ connected: false, state: 'disconnected' });
  const [checkResult, setCheckResult] = useState<ConnectionCheckResult | null>(null);
  const [masked, setMasked] = useState<SecretsMasked>({ hasApiKey: false, hasClearance: false, hasUserAgent: false });
  const [ledgerRows, setLedgerRows] = useState<LedgerEntry[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [historyJSON, setHistoryJSON] = useState('');
  const [syncingHistory, setSyncingHistory] = useState(false);

  const [label, setLabel] = useState('');
  const [mirror, setMirror] = useState('stake.com');
  const [currency, setCurrency] = useState('btc');
  const [apiKey, setApiKey] = useState('');
  const [clearance, setClearance] = useState('');
  const [userAgent, setUserAgent] = useState('');

  const selected = useMemo(() => accounts.find((a) => a.id === selectedID) ?? null, [accounts, selectedID]);

  const refresh = useCallback(async () => {
    const [list, status] = await Promise.all([ListAccounts(), GetActiveStatus()]);
    setAccounts((list ?? []) as Account[]);
    setActiveStatus((status ?? { connected: false, state: 'disconnected' }) as ActiveStatus);
    if (!selectedID && Array.isArray(list) && list.length > 0) {
      setSelectedID(list[0].id);
    }
    setLoading(false);
  }, [selectedID]);

  useEffect(() => {
    refresh().catch((err) => {
      toast.error(err?.message ?? 'Failed to load accounts');
      setLoading(false);
    });
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setLabel('');
      setMirror('stake.com');
      setCurrency('btc');
      return;
    }
    setLabel(selected.label ?? '');
    setMirror(selected.mirror || 'stake.com');
    setCurrency(selected.currency || 'btc');
    setCheckResult(null);
    setLedgerRows([]);
    setLedgerSummary(null);
    GetSecretsMasked(selected.id)
      .then((res: SecretsMasked) => setMasked(res ?? { hasApiKey: false, hasClearance: false, hasUserAgent: false }))
      .catch(() => setMasked({ hasApiKey: false, hasClearance: false, hasUserAgent: false }));
    Promise.all([ListLedgerEntries(selected.id, 8, 0), GetLedgerSummary(selected.id)])
      .then(([rows, summary]) => {
        setLedgerRows((rows ?? []) as LedgerEntry[]);
        setLedgerSummary((summary ?? null) as LedgerSummary | null);
      })
      .catch(() => {
        setLedgerRows([]);
        setLedgerSummary(null);
      });
  }, [selected]);

  const handleAddAccount = useCallback(async () => {
    const created = await SaveAccount({
      id: '',
      label: `Account ${accounts.length + 1}`,
      mirror: 'stake.com',
      currency: 'btc',
      profileId: '',
      connectionState: 'not_configured',
      createdAt: '',
      updatedAt: '',
    });
    setAccounts((prev) => [created as Account, ...prev]);
    setSelectedID((created as Account).id);
    toast.success('Account created');
  }, [accounts.length]);

  const handleSaveMeta = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await SaveAccount({
        id: selected.id,
        label,
        mirror,
        currency,
        profileId: selected.profileId,
        connectionState: selected.connectionState,
        createdAt: selected.createdAt,
        updatedAt: selected.updatedAt,
      });
      setAccounts((prev) => prev.map((a) => (a.id === selected.id ? (saved as Account) : a)));
      toast.success('Account updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save account');
    } finally {
      setSaving(false);
    }
  }, [selected, label, mirror, currency]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    try {
      await DeleteAccount(selected.id);
      setAccounts((prev) => prev.filter((a) => a.id !== selected.id));
      setSelectedID('');
      toast.success('Account deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete account');
    }
  }, [selected]);

  const handleSaveSecrets = useCallback(async () => {
    if (!selected) return;
    if (!apiKey.trim() && !masked.hasApiKey) {
      toast.error('API key is required');
      return;
    }
    try {
      await SetSecrets(selected.id, apiKey.trim() || ' ', clearance.trim(), userAgent.trim());
      setApiKey('');
      setClearance('');
      setUserAgent('');
      const updated = await GetSecretsMasked(selected.id);
      setMasked(updated as SecretsMasked);
      toast.success('Secrets saved');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save secrets');
    }
  }, [selected, apiKey, clearance, userAgent, masked.hasApiKey]);

  const handleCheck = useCallback(async () => {
    if (!selected) return;
    setChecking(true);
    try {
      const result = await ConnectionCheck(selected.id);
      setCheckResult(result as ConnectionCheckResult);
      if ((result as ConnectionCheckResult).ok) {
        toast.success('Connection check passed');
      } else {
        toast.error('Connection check failed');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Connection check failed');
    } finally {
      setChecking(false);
    }
  }, [selected]);

  const handleConnect = useCallback(async () => {
    if (!selected) return;
    setConnecting(true);
    try {
      await Connect(selected.id);
      const status = await GetActiveStatus();
      setActiveStatus(status as ActiveStatus);
      toast.success('Connected');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [selected]);

  const handleDisconnect = useCallback(async () => {
    await Disconnect();
    const status = await GetActiveStatus();
    setActiveStatus(status as ActiveStatus);
    toast.success('Disconnected');
  }, []);

  const handleRepairSession = useCallback(async () => {
    if (!selected) return;
    try {
      if (typeof RepairSession === 'function') {
        await RepairSession(selected.id);
      } else {
        await OpenCasinoInBrowser(selected.id);
      }
      const status = await GetActiveStatus();
      setActiveStatus(status as ActiveStatus);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to open session repair');
    }
  }, [selected]);

  const handleSyncHistory = useCallback(async () => {
    if (!selected) return;
    let parsed: any;
    try {
      parsed = JSON.parse(historyJSON);
    } catch {
      toast.error('History JSON is invalid');
      return;
    }

    const sourceRows = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      toast.error('History JSON must contain at least one entry');
      return;
    }

    const entries = sourceRows.map((row: any) => {
      const createdAt = row.created_at ?? row.createdAt ?? row.dateTime ?? row.date_time ?? row.timestamp ?? '';
      return {
        id: 0,
        account_id: selected.id,
        source: 'history',
        game: row.game ?? row.gameName ?? row.type ?? '',
        external_bet_id: row.external_bet_id ?? row.externalBetID ?? row.id ?? row.betId ?? '',
        idempotency_key: row.idempotency_key ?? row.idempotencyKey ?? '',
        currency: row.currency ?? selected.currency ?? '',
        nonce: Number(row.nonce ?? 0),
        amount: Number(row.amount ?? row.wager ?? 0),
        payout: Number(row.payout ?? 0),
        payout_multiplier: Number(row.payout_multiplier ?? row.payoutMultiplier ?? 0),
        response_json: JSON.stringify(row),
        created_at: createdAt,
      };
    });

    setSyncingHistory(true);
    try {
      const result = await SyncHistoryEntries(selected.id, entries as any);
      const [rows, summary] = await Promise.all([ListLedgerEntries(selected.id, 8, 0), GetLedgerSummary(selected.id)]);
      setLedgerRows((rows ?? []) as LedgerEntry[]);
      setLedgerSummary((summary ?? null) as LedgerSummary | null);
      toast.success(`History synced: ${result.inserted} new, ${result.duplicates} duplicate`);
      setHistoryJSON('');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to sync history');
    } finally {
      setSyncingHistory(false);
    }
  }, [historyJSON, selected]);

  const selectedState = activeStatus.accountId === selected?.id
    ? activeStatus.state
    : selected?.connectionState ?? 'disconnected';
  const selectedStateLabel = STATE_LABELS[selectedState] ?? selectedState;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px,1fr]">
      <div className="card-terminal p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xs uppercase tracking-widest text-muted-foreground">Accounts</h2>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={handleAddAccount}>
            <IconPlus size={13} />
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {loading ? (
            <div className="font-mono text-xs text-muted-foreground">Loading...</div>
          ) : accounts.length === 0 ? (
            <div className="rounded border border-border/60 bg-muted/20 p-3 font-mono text-xs text-muted-foreground">
              No accounts yet.
            </div>
          ) : (
            accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={cn(
                  'w-full border p-3 text-left transition-colors',
                  selectedID === account.id
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/60 bg-muted/20 hover:border-primary/25',
                )}
                onClick={() => setSelectedID(account.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs text-foreground">{account.label || 'Untitled account'}</div>
                  <IconChevronRight size={14} className="text-muted-foreground" />
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {account.mirror} • {account.currency}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="card-terminal p-5">
        {!selected ? (
          <div className="font-mono text-sm text-muted-foreground">Select an account to configure authentication.</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
              <div className="flex items-center gap-2">
                <IconLock size={16} className="text-primary" />
                <h1 className="font-display text-sm uppercase tracking-widest">Account Settings</h1>
              </div>
              <div className="flex items-center gap-2">
                {activeStatus.connected && activeStatus.accountId === selected.id && activeStatus.state === 'connected' ? (
                  <span className="badge-terminal text-emerald-300">Connected</span>
                ) : (
                  <span className="badge-terminal text-muted-foreground">{selectedStateLabel}</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label</label>
                <input
                  className="h-9 w-full border border-border bg-background px-2 text-sm"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Mirror</label>
                <select className="h-9 w-full border border-border bg-background px-2 text-sm" value={mirror} onChange={(e) => setMirror(e.target.value)}>
                  {DOMAIN_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Currency</label>
                <select className="h-9 w-full border border-border bg-background px-2 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveMeta} disabled={saving} className="gap-2">
                {saving ? <IconLoader2 size={14} className="animate-spin" /> : null}
                Save Account
              </Button>
              <Button size="sm" variant="outline" onClick={handleDelete} className="gap-2 border-red-500/40 text-red-300 hover:bg-red-500/10">
                <IconTrash size={14} />
                Delete
              </Button>
            </div>

            <div className="rounded border border-border/70 bg-muted/10 p-4">
              <h3 className="mb-3 font-display text-xs uppercase tracking-wider">Secrets</h3>
              <div className="space-y-3">
                <input
                  type="password"
                  className="h-9 w-full border border-border bg-background px-2 text-sm"
                  placeholder={masked.hasApiKey ? 'API Key saved (enter to replace)' : 'Stake API key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <details className="group rounded border border-border/60 bg-background/50 p-3">
                  <summary className="cursor-pointer font-mono text-xs uppercase tracking-wider text-muted-foreground">Session Repair</summary>
                  <div className="mt-3 space-y-3">
                    <input
                      className="h-9 w-full border border-border bg-background px-2 text-sm"
                      placeholder={masked.hasClearance ? 'cf_clearance saved (enter to replace)' : 'cf_clearance cookie value'}
                      value={clearance}
                      onChange={(e) => setClearance(e.target.value)}
                    />
                    <input
                      className="h-9 w-full border border-border bg-background px-2 text-sm"
                      placeholder={masked.hasUserAgent ? 'User-Agent saved (enter to replace)' : 'User-Agent (optional)'}
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                    />
                    <Button size="sm" variant="outline" className="gap-2" onClick={handleRepairSession}>
                      <IconExternalLink size={14} />
                      Repair Session
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      If the browser session check fails, open the casino site, complete login or checks normally, then test the connection again. Manual cookie fields are a fallback.
                    </p>
                  </div>
                </details>
                <Button size="sm" onClick={handleSaveSecrets}>Save Secrets</Button>
              </div>
            </div>

            <div className="rounded border border-border/70 bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-xs uppercase tracking-wider">Connection Check</h3>
                <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking} className="gap-2">
                  {checking ? <IconLoader2 size={14} className="animate-spin" /> : null}
                  Test Connection
                </Button>
              </div>

              <div className="space-y-2">
                {(checkResult?.steps ?? [
                  { name: 'mirror', success: false, message: 'Not checked yet' },
                  { name: 'browser_session', success: false, message: 'Not checked yet' },
                  { name: 'credentials', success: false, message: 'Not checked yet' },
                ]).map((step) => (
                  <div key={step.name} className="flex items-center gap-2 border border-border/50 bg-background/40 p-2 text-xs">
                    {step.success ? (
                      <IconCheck size={14} className="text-emerald-400" />
                    ) : (
                      <IconAlertTriangle size={14} className="text-amber-400" />
                    )}
                    <span className="font-mono uppercase tracking-wider text-muted-foreground">{step.name}</span>
                    <span className={cn('ml-auto truncate', step.success ? 'text-emerald-300' : 'text-amber-300')}>
                      {step.message ?? (step.success ? 'ok' : 'pending')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleConnect} disabled={connecting || checking} className="gap-2">
                {connecting ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlug size={14} />}
                Connect
              </Button>
              <Button variant="outline" onClick={handleDisconnect} className="gap-2">
                <IconPlugOff size={14} />
                Disconnect
              </Button>
            </div>

            {activeStatus.error ? (
              <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{activeStatus.error}</div>
            ) : null}

            {activeStatus.reason?.message && activeStatus.accountId === selected.id ? (
              <div className="rounded border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
                {activeStatus.reason.message}
              </div>
            ) : null}

            {activeStatus.connected && activeStatus.accountId === selected.id && activeStatus.balances?.length ? (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {activeStatus.balances.slice(0, 8).map((b) => (
                  <div key={b.currency} className="rounded border border-border/60 bg-background/40 p-2">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{b.currency}</div>
                    <div className="font-mono text-xs text-foreground">{Number(b.available).toFixed(8)}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded border border-border/70 bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-xs uppercase tracking-wider">Ledger Analysis</h3>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {ledgerSummary?.count ?? 0} bets
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  { name: 'Wagered', value: ledgerSummary?.wagered ?? 0, numeric: true },
                  { name: 'Payout', value: ledgerSummary?.payout ?? 0, numeric: true },
                  { name: 'Profit', value: ledgerSummary?.profit ?? 0, numeric: true },
                  { name: 'ROI', value: `${((ledgerSummary?.roi ?? 0) * 100).toFixed(2)}%`, numeric: false },
                ].map((metric) => (
                  <div key={metric.name} className="border border-border/50 bg-background/40 p-2">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{metric.name}</div>
                    <div className={cn('font-mono text-xs', metric.name === 'Profit' && Number(metric.value) > 0 ? 'text-emerald-300' : 'text-foreground')}>
                      {metric.numeric ? Number(metric.value).toFixed(8) : metric.value}
                    </div>
                  </div>
                ))}
              </div>
              {ledgerSummary?.by_game?.length ? (
                <div className="mt-3 space-y-2">
                  {ledgerSummary.by_game.slice(0, 4).map((group) => (
                    <div key={`${group.game}:${group.source}`} className="grid grid-cols-[1fr_auto_auto] gap-3 border border-border/50 bg-background/40 p-2 font-mono text-xs">
                      <div className="min-w-0 truncate text-foreground">{group.game || 'unknown'} / {group.source || 'unknown'}</div>
                      <div className="text-muted-foreground">{group.count} bets</div>
                      <div className={group.profit > 0 ? 'text-emerald-300' : 'text-muted-foreground'}>{group.profit.toFixed(8)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded border border-border/70 bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-xs uppercase tracking-wider">Ledger Preview</h3>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {ledgerRows.length} rows
                </span>
              </div>
              {ledgerRows.length === 0 ? (
                <div className="font-mono text-xs text-muted-foreground">No ledger records for this account yet.</div>
              ) : (
                <div className="space-y-2">
                  {ledgerRows.map((row) => (
                    <div key={row.id || row.idempotency_key} className="grid grid-cols-[1fr_auto] gap-2 border border-border/50 bg-background/40 p-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs text-foreground">
                          {row.game || 'unknown'} / {row.source || 'unknown'}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          nonce {row.nonce || 0} / {row.currency || 'n/a'}
                        </div>
                      </div>
                      <div className="text-right font-mono text-xs text-muted-foreground">
                        <div>{Number(row.amount || 0).toFixed(8)}</div>
                        <div className={Number(row.payout || 0) > 0 ? 'text-emerald-300' : 'text-muted-foreground'}>
                          {Number(row.payout || 0).toFixed(8)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded border border-border/70 bg-muted/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-xs uppercase tracking-wider">History Sync</h3>
                <Button size="sm" variant="outline" onClick={handleSyncHistory} disabled={syncingHistory || !historyJSON.trim()} className="gap-2">
                  {syncingHistory ? <IconLoader2 size={14} className="animate-spin" /> : <IconUpload size={14} />}
                  Sync
                </Button>
              </div>
              <textarea
                className="min-h-28 w-full border border-border bg-background p-2 font-mono text-xs"
                placeholder='[{"id":"stake-bet-1","game":"dice","currency":"btc","nonce":123,"amount":0.001,"payout":0,"payoutMultiplier":0,"createdAt":"2026-05-11T09:00:00Z"}]'
                value={historyJSON}
                onChange={(e) => setHistoryJSON(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AccountsPage;
