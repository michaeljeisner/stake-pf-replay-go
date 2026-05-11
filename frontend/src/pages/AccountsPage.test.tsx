import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';

const account = {
  id: 'acct-1',
  label: 'Main',
  mirror: 'stake.com',
  currency: 'btc',
  profileId: 'profile-1',
  connectionState: 'needs_browser_repair',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function installAuthModule(overrides: Record<string, unknown> = {}) {
  const mod = {
    ListAccounts: vi.fn().mockResolvedValue([account]),
    GetActiveStatus: vi.fn().mockResolvedValue({
      connected: false,
      state: 'needs_browser_repair',
      accountId: account.id,
      reason: { code: 'browser_session_failed', message: 'Browser session needs repair' },
    }),
    GetSecretsMasked: vi.fn().mockResolvedValue({ hasApiKey: true, hasClearance: false, hasUserAgent: false }),
    SaveAccount: vi.fn().mockResolvedValue(account),
    SetSecrets: vi.fn().mockResolvedValue(undefined),
    Connect: vi.fn().mockResolvedValue(undefined),
    Disconnect: vi.fn().mockResolvedValue(undefined),
    RepairSession: vi.fn().mockResolvedValue(undefined),
    ConnectionCheck: vi.fn().mockResolvedValue({
      ok: false,
      state: 'needs_browser_repair',
      reason: { code: 'browser_session_failed', message: 'repair required' },
      steps: [
        { name: 'mirror', success: true },
        { name: 'browser_session', success: false, message: 'status 503' },
        { name: 'credentials', success: false, message: 'Not checked yet' },
      ],
    }),
    ...overrides,
  };
  (window as any).go = { bindings: { AuthModule: mod } };
  return mod;
}

async function findMirrorAndCurrencySelects() {
  await screen.findByText('Account Settings');
  const selects = screen.getAllByRole('combobox');
  return {
    mirrorSelect: selects[0],
    currencySelect: selects[1],
  };
}

describe('AccountsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as any).go;
  });

  it('renders session repair state and browser_session check step', async () => {
    installAuthModule();

    render(<AccountsPage />);

    await waitFor(() => expect(screen.getAllByText('Repair Session').length).toBeGreaterThan(0));
    expect(screen.getByText('Browser session needs repair')).toBeInTheDocument();
    expect(screen.getByText('browser_session')).toBeInTheDocument();
  });

  it('calls RepairSession from the session repair control', async () => {
    const mod = installAuthModule();
    const user = userEvent.setup();

    render(<AccountsPage />);

    const summaries = await screen.findAllByText('Session Repair');
    await user.click(summaries[0]);
    await user.click(screen.getByRole('button', { name: /repair session/i }));

    await waitFor(() => expect(mod.RepairSession).toHaveBeenCalledWith(account.id));
  });

  it('switching mirror to stake.us exposes SWEEPS and GOLD options', async () => {
    installAuthModule();
    const user = userEvent.setup();

    render(<AccountsPage />);

    const { mirrorSelect, currencySelect } = await findMirrorAndCurrencySelects();
    await user.selectOptions(mirrorSelect, 'stake.us');

    expect(currencySelect).toHaveTextContent('SWEEPS');
    expect(currencySelect).toHaveTextContent('GOLD');
  });

  it('switching away from stake.us replaces SWEEPS/GOLD with btc before save', async () => {
    const stakeUsAccount = { ...account, mirror: 'stake.us', currency: 'SWEEPS' };
    const mod = installAuthModule({
      ListAccounts: vi.fn().mockResolvedValue([stakeUsAccount]),
      GetActiveStatus: vi.fn().mockResolvedValue({ connected: false, state: 'disconnected' }),
      SaveAccount: vi.fn().mockResolvedValue({ ...stakeUsAccount, mirror: 'stake.com', currency: 'btc' }),
    });
    const user = userEvent.setup();

    render(<AccountsPage />);

    const { mirrorSelect } = await findMirrorAndCurrencySelects();
    await user.selectOptions(mirrorSelect, 'stake.com');
    await user.click(screen.getByRole('button', { name: /save account/i }));

    await waitFor(() => expect(mod.SaveAccount).toHaveBeenCalledWith(expect.objectContaining({
      id: stakeUsAccount.id,
      mirror: 'stake.com',
      currency: 'btc',
    })));
  });

  it('refreshes account list and active status after ConnectionCheck completes', async () => {
    const mod = installAuthModule();
    const user = userEvent.setup();

    render(<AccountsPage />);

    await screen.findByText('Browser session needs repair');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => expect(mod.ConnectionCheck).toHaveBeenCalledWith(account.id));
    await waitFor(() => expect(mod.ListAccounts).toHaveBeenCalledTimes(2));
    expect(mod.GetActiveStatus).toHaveBeenCalledTimes(2);
  });

  it('does not show active Connected header for persisted connected account that is not active', async () => {
    const persistedConnected = { ...account, connectionState: 'connected' };
    installAuthModule({
      ListAccounts: vi.fn().mockResolvedValue([persistedConnected]),
      GetActiveStatus: vi.fn().mockResolvedValue({
        connected: true,
        state: 'connected',
        accountId: 'acct-2',
      }),
    });

    render(<AccountsPage />);

    await screen.findByText('Main');
    expect(screen.queryByText('Browser session needs repair')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toHaveClass('text-muted-foreground');
    expect(screen.queryByText('text-emerald-300')).not.toBeInTheDocument();
  });
});
