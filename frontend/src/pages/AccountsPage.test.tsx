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
});
