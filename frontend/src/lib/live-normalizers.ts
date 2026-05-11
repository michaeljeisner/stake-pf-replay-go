import * as livestore from '@desktop-bindings/internal/livestore';
import type { LiveBet, LiveBetPage } from '@/types/live';

export type RawLiveBet = livestore.LiveBet | Record<string, unknown>;

export type WailsGetBetsShape =
  | livestore.LiveBet[]
  | {
      rows?: livestore.LiveBet[];
      total?: number;
    }
  | [livestore.LiveBet[], number];

export function normalizeLiveBet(raw: RawLiveBet): LiveBet {
  const bet = raw as Record<string, unknown>;
  const amount = Number(bet.amount ?? 0);
  const payout = Number(bet.payout ?? 0);
  const roundResult = Number(bet.round_result ?? bet.roundResult ?? 0);
  const roundTarget = bet.round_target ?? bet.roundTarget;
  const difficulty = (bet.difficulty as LiveBet['difficulty']) ?? 'easy';
  const isoDate = bet.date_time ?? bet.dateTime;

  return {
    id: Number(bet.id ?? 0),
    nonce: Number(bet.nonce ?? 0),
    date_time: typeof isoDate === 'string' && isoDate ? new Date(isoDate).toISOString() : undefined,
    amount: Number.isFinite(amount) ? amount : 0,
    payout: Number.isFinite(payout) ? payout : 0,
    difficulty,
    round_target: roundTarget != null ? Number(roundTarget) : undefined,
    round_result: Number.isFinite(roundResult) ? roundResult : 0,
  };
}

export function mergeRows(existing: LiveBet[], incoming: LiveBet[], order: 'asc' | 'desc'): LiveBet[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((bet) => bet.id));
  const fresh = incoming.filter((bet) => !seen.has(bet.id));
  if (!fresh.length) return existing;
  const sortedFresh = [...fresh].sort((a, b) => {
    if (order === 'desc') {
      if (b.nonce !== a.nonce) return b.nonce - a.nonce;
      return b.id - a.id;
    }
    if (a.nonce !== b.nonce) return a.nonce - b.nonce;
    return a.id - b.id;
  });
  return order === 'desc' ? [...sortedFresh, ...existing] : [...existing, ...sortedFresh];
}

export function unpackGetBets(result: WailsGetBetsShape): LiveBetPage {
  if (!result) {
    return { rows: [], total: null };
  }

  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      const [rows, total] = result as [livestore.LiveBet[], number];
      return { rows: rows.map(normalizeLiveBet), total: total ?? null };
    }
    if (result.length === 0 || typeof result[0] === 'object') {
      const rows = result as livestore.LiveBet[];
      return { rows: rows.map(normalizeLiveBet), total: null };
    }
  }

  if (typeof result === 'object') {
    const obj = result as { rows?: livestore.LiveBet[]; total?: number };
    if (Array.isArray(obj.rows)) {
      return {
        rows: obj.rows.map(normalizeLiveBet),
        total: typeof obj.total === 'number' ? obj.total : null,
      };
    }
  }

  return { rows: [], total: null };
}
