import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';

const authMocks = vi.hoisted(() => ({
  Connect: vi.fn(),
  ConnectionCheck: vi.fn(),
  DeleteAccount: vi.fn(),
  Disconnect: vi.fn(),
  GetActiveStatus: vi.fn(),
  GetSecretsMasked: vi.fn(),
  ListAccounts: vi.fn(),
  OpenCasinoInBrowser: vi.fn(),
  RepairSession: vi.fn(),
  SaveAccount: vi.fn(),
  SetSecrets: vi.fn(),
}));

const liveMocks = vi.hoisted(() => ({
  GetLedgerSummary: vi.fn(),
  ListLedgerEntries: vi.fn(),
  SyncHistoryEntries: vi.fn(),
}));

vi.mock('@bindings/bindings/authmodule', () => authMocks);
vi.mock('@desktop-bindings/internal/livehttp/livemodule', () => liveMocks);

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
  Object.assign(authMocks, mod);
  liveMocks.GetLedgerSummary.mockResolvedValue({
    account_id: account.id,
    count: 0,
    wagered: 0,
    payout: 0,
    profit: 0,
    roi: 0,
    win_count: 0,
    by_game: [],
  });
  liveMocks.ListLedgerEntries.mockResolvedValue([]);
  liveMocks.SyncHistoryEntries.mockResolvedValue({ inserted: 1, duplicates: 0, entries: [] });
  return mod;
}

describe('AccountsPage', () => {
  beforeEach(() => {
    for (const mock of Object.values(authMocks)) {
      mock.mockReset();
    }
    for (const mock of Object.values(liveMocks)) {
      mock.mockReset();
    }
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

  it('syncs pasted history into the selected account ledger', async () => {
    installAuthModule();
    liveMocks.GetLedgerSummary
      .mockResolvedValueOnce({
        account_id: account.id,
        count: 0,
        wagered: 0,
        payout: 0,
        profit: 0,
        roi: 0,
        win_count: 0,
        by_game: [],
      })
      .mockResolvedValueOnce({
        account_id: account.id,
        count: 1,
        wagered: 0.001,
        payout: 0,
        profit: -0.001,
        roi: -1,
        win_count: 0,
        by_game: [{ game: 'dice', source: 'history', count: 1, wagered: 0.001, payout: 0, profit: -0.001, win_count: 0, last_nonce: 123 }],
      });
    const user = userEvent.setup();

    render(<AccountsPage />);

    const input = await screen.findByPlaceholderText(/\{"id":"stake-bet-1"/i);
    fireEvent.change(input, { target: { value: JSON.stringify([{
      id: 'stake-bet-1',
      game: 'dice',
      currency: 'btc',
      nonce: 123,
      amount: 0.001,
      payout: 0,
      payoutMultiplier: 0,
      createdAt: '2026-05-11T09:00:00Z',
    }]) } });
    await user.click(screen.getByRole('button', { name: /sync/i }));

    await waitFor(() => expect(liveMocks.SyncHistoryEntries).toHaveBeenCalledWith(account.id, [
      expect.objectContaining({
        account_id: account.id,
        source: 'history',
        game: 'dice',
        external_bet_id: 'stake-bet-1',
        nonce: 123,
      }),
    ]));
    await waitFor(() => expect(screen.getAllByText('1 bets').length).toBeGreaterThan(0));
  });
});
