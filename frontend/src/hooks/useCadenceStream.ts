/**
 * useCadenceStream Hook
 *
 * Subscribes to live stream events and computes real-time tier statistics
 * for the Pump cadence strategy dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EventsOn } from '@/lib/wails-events';
import { GetStreamWithRounds, GetRecentRounds, GetBetsPage, TailRounds } from '@desktop-bindings/internal/livehttp/livemodule';
import { callWithRetry, waitForWailsBinding } from '@/lib/wails';
import {
  computeAllTierStats,
  evaluateSeedQuality,
  generateDecisionSignals,
  TierStats,
  SeedQuality,
  DecisionSignal,
} from '@/lib/cadence-analytics';
import { TierId, TIER_ORDER, PUMP_EXPERT_TIERS } from '@/lib/pump-tiers';
import type { LiveBet } from '@/types/live';

// ============ Types ============

interface Round {
  nonce: number;
  round_result: number;
  received_at?: string;
}

interface TickEvent {
  nonce: number;
  roundResult: number;
}

interface NewRowsEvent {
  nonce?: number;
  roundResult?: number;
}

export interface UseCadenceStreamOptions {
  streamId: string;
  /** Number of rounds to fetch initially */
  initialRoundsLimit?: number;
  /** Minimum multiplier for bet table display */
  betThreshold?: number;
}

export interface UseCadenceStreamResult {
  /** Current nonce (from heartbeat) */
  currentNonce: number;
  /** Alias for current nonce for dashboard status bars */
  latestNonce: number;
  /** Timestamp of last heartbeat/tick event */
  lastHeartbeatAt: string | null;
  /** Per-tier statistics */
  tierStats: Map<TierId, TierStats>;
  /** Overall seed quality assessment */
  seedQuality: SeedQuality | null;
  /** Active decision signals */
  signals: DecisionSignal[];
  /** Recent rounds for pattern visualization */
  recentRounds: Round[];
  /** High-multiplier bets for stream tape */
  bets: LiveBet[];
  /** Total bets count */
  totalBets: number;
  /** Is the stream connected? */
  isConnected: boolean;
  /** Is initial data loading? */
  isLoading: boolean;
  /** Error if any */
  error: Error | null;
  /** Stream metadata */
  stream: {
    id: string;
    serverSeedHashed: string;
    clientSeed: string;
    createdAt: string;
    lastSeenAt: string;
  } | null;
  /** Manually refresh data */
  refresh: () => void;
}

// ============ Hook Implementation ============

export function useCadenceStream({
  streamId,
  initialRoundsLimit = 5000,
  betThreshold = 34,
}: UseCadenceStreamOptions): UseCadenceStreamResult {
  const queryClient = useQueryClient();

  // State
  const [currentNonce, setCurrentNonce] = useState(0);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [bets, setBets] = useState<LiveBet[]>([]);
  const [totalBets, setTotalBets] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Refs for avoiding stale closures
  const lastKnownNonceRef = useRef(0);
  const lastUpdateAtRef = useRef<number>(0);
  const roundsRef = useRef<Round[]>([]);
  const DISCONNECT_AFTER_MS = 30_000;

  // Initial data fetch
  const { data: initialData, isLoading, refetch } = useQuery({
    queryKey: ['cadence-stream', streamId],
    queryFn: async () => {
      await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'GetStreamWithRounds'], { timeoutMs: 10_000 });

      const streamWithRounds = await callWithRetry(
        () => GetStreamWithRounds(streamId, initialRoundsLimit),
        3,
        300
      );

      // Also fetch bets for the stream tape
      await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'GetBetsPage'], { timeoutMs: 10_000 });
      const betsPage = await callWithRetry(
        () => GetBetsPage(streamId, betThreshold, 'desc', 500, 0),
        3,
        300
      );

      return {
        stream: streamWithRounds.stream,
        rounds: streamWithRounds.rounds || [],
        bets: betsPage.rows || [],
        totalBets: betsPage.total || 0,
      };
    },
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // Initialize state from query data
  useEffect(() => {
    if (initialData) {
      const normalizedRounds: Round[] = (initialData.rounds || []).map((r: any) => ({
        nonce: Number(r.nonce),
        round_result: Number(r.round_result),
        received_at: r.received_at,
      }));

      setRounds(normalizedRounds);
      roundsRef.current = normalizedRounds;

      // Set current nonce from stream metadata
      const streamNonce = Number(initialData.stream?.last_observed_nonce || 0);
      const maxRoundNonce = normalizedRounds.length > 0
        ? Math.max(...normalizedRounds.map(r => r.nonce))
        : 0;
      const nonce = Math.max(streamNonce, maxRoundNonce);
      setCurrentNonce(nonce);
      lastKnownNonceRef.current = nonce;
      lastUpdateAtRef.current = Date.now();

      // Set bets
      const normalizedBets: LiveBet[] = (initialData.bets || []).map((b: any) => ({
        id: Number(b.id),
        nonce: Number(b.nonce),
        date_time: b.date_time,
        amount: Number(b.amount),
        payout: Number(b.payout),
        difficulty: b.difficulty || 'expert',
        round_target: b.round_target,
        round_result: Number(b.round_result),
      }));
      setBets(normalizedBets);
      setTotalBets(initialData.totalBets);

      setIsConnected(true);
      setLastHeartbeatAt(new Date().toISOString());
      setError(null);
    }
  }, [initialData]);

  // Handle tick events (heartbeats)
  const handleTick = useCallback((event: TickEvent) => {
    const nonce = Number(event.nonce);
    const roundResult = Number(event.roundResult);

    if (nonce > lastKnownNonceRef.current) {
      lastKnownNonceRef.current = nonce;
      setCurrentNonce(nonce);
      lastUpdateAtRef.current = Date.now();
      setLastHeartbeatAt(new Date().toISOString());

      // Add to rounds buffer
      const newRound: Round = {
        nonce,
        round_result: roundResult,
        received_at: new Date().toISOString(),
      };

      setRounds(prev => {
        // Avoid duplicates and keep sorted
        if (prev.some(r => r.nonce === nonce)) return prev;
        const updated = [...prev, newRound].sort((a, b) => a.nonce - b.nonce);
        // Keep last N rounds to prevent memory bloat
        const trimmed = updated.slice(-10000);
        roundsRef.current = trimmed;
        return trimmed;
      });
    }

    setIsConnected(true);
    setLastHeartbeatAt(new Date().toISOString());
  }, []);

  // Handle new bet rows
  const handleNewRows = useCallback((event: NewRowsEvent) => {
    // Fetch new bets
    (async () => {
      try {
        await waitForWailsBinding(['go', 'livehttp', 'LiveModule', 'GetBetsPage'], { timeoutMs: 5_000 });
        const betsPage = await callWithRetry(
          () => GetBetsPage(streamId, betThreshold, 'desc', 500, 0),
          2,
          200
        );

        const normalizedBets: LiveBet[] = (betsPage.rows || []).map((b: any) => ({
          id: Number(b.id),
          nonce: Number(b.nonce),
          date_time: b.date_time,
          amount: Number(b.amount),
          payout: Number(b.payout),
          difficulty: b.difficulty || 'expert',
          round_target: b.round_target,
          round_result: Number(b.round_result),
        }));

        setBets(normalizedBets);
        setTotalBets(betsPage.total || 0);
      } catch (err) {
        console.warn('Failed to fetch new bets:', err);
      }
    })();

    // Update nonce if provided
    if (event.nonce && event.nonce > lastKnownNonceRef.current) {
      lastKnownNonceRef.current = event.nonce;
      setCurrentNonce(event.nonce);
      lastUpdateAtRef.current = Date.now();
      setLastHeartbeatAt(new Date().toISOString());
    }

    setIsConnected(true);
    setLastHeartbeatAt(new Date().toISOString());
  }, [streamId, betThreshold]);

  // Subscribe to events
  useEffect(() => {
    const offTick = EventsOn(`live:tick:${streamId}`, handleTick);
    const offNewRows = EventsOn(`live:newrows:${streamId}`, handleNewRows);

    // Periodic reconnection check
    const checkInterval = setInterval(() => {
      if (lastUpdateAtRef.current === 0) {
        return;
      }
      const timeSinceLastUpdate = Date.now() - lastUpdateAtRef.current;
      if (timeSinceLastUpdate > DISCONNECT_AFTER_MS) {
        setIsConnected(false);
      }
    }, 10_000);

    return () => {
      offTick();
      offNewRows();
      clearInterval(checkInterval);
    };
  }, [streamId, handleTick, handleNewRows]);

  // Compute tier stats
  const tierStats = useMemo(() => {
    if (rounds.length === 0 || currentNonce === 0) {
      return new Map<TierId, TierStats>();
    }
    return computeAllTierStats(rounds, currentNonce);
  }, [rounds, currentNonce]);

  // Compute seed quality
  const seedQuality = useMemo(() => {
    if (rounds.length === 0 || currentNonce === 0) {
      return null;
    }
    return evaluateSeedQuality(rounds, currentNonce);
  }, [rounds, currentNonce]);

  // Generate decision signals
  const signals = useMemo(() => {
    if (tierStats.size === 0) return [];
    return generateDecisionSignals(tierStats);
  }, [tierStats]);

  // Recent rounds for visualization (last 200)
  const recentRounds = useMemo(() => {
    return rounds.slice(-200);
  }, [rounds]);

  // Stream metadata
  const stream = useMemo(() => {
    if (!initialData?.stream) return null;
    const s = initialData.stream;
    return {
      id: String(s.id),
      serverSeedHashed: s.server_seed_hashed || '',
      clientSeed: s.client_seed || '',
      createdAt: s.created_at ? new Date(s.created_at).toISOString() : '',
      lastSeenAt: s.last_seen_at ? new Date(s.last_seen_at).toISOString() : '',
    };
  }, [initialData]);

  // Refresh function
  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    currentNonce,
    latestNonce: currentNonce,
    lastHeartbeatAt,
    tierStats,
    seedQuality,
    signals,
    recentRounds,
    bets,
    totalBets,
    isConnected,
    isLoading,
    error,
    stream,
    refresh,
  };
}

