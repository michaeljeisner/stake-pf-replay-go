/**
 * useExplorerData - Unified data hook for Live Explorer table
 *
 * Manages both Rounds (heartbeat) and Bets (tape) mode with:
 * - Initial load from Wails bindings
 * - Live tail updates via Wails events
 * - Client-side filtering/sorting
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EventsOn } from "@/lib/wails-events";
import {
  GetRecentRounds,
  TailRounds,
  GetBetsPage,
  Tail,
} from "@desktop-bindings/internal/livehttp/livemodule";
import type * as livestore from '@desktop-bindings/internal/livestore';

// ============ Types ============

export type ExplorerMode = "rounds" | "bets";

export interface ExplorerRow {
  id: number;
  nonce: number;
  round_result: number;
  received_at?: string;
  // Bet-specific fields (optional)
  amount?: number;
  payout?: number;
  difficulty?: string;
  round_target?: number | null;
  date_time?: string;
}

export interface DerivedRow extends ExplorerRow {
  deltaPrev: number | null;
  tierGap: number | null;
  /** Gap from this row to the previous reference tier hit (for cross-tier analysis) */
  crossTierGap: number | null;
  /** Nonce of the reference tier hit that crossTierGap is measured from */
  crossTierRefNonce: number | null;
}

/** Tier bucket filter options */
export type TierBucket = 'all' | '<34' | '34+' | '164+' | '400+' | '1066+' | '3200+' | '11200+';

/** Gap deviation filter - how far from expected cadence */
export type GapDeviationBand = 'any' | 'tight' | 'normal' | 'loose' | 'outlier';

export interface ExplorerFilters {
  // === Basic Filters ===
  minMultiplier: number | null;
  maxMultiplier: number | null;
  minNonce: number | null;
  maxNonce: number | null;

  // === Tier Filters ===
  /** Only show rows matching this tier bucket */
  tierBucket: TierBucket;
  /** Exclude specific tiers (e.g., show 1066+ but not 3200+) */
  excludeTiers: TierBucket[];
  /** Only show exact tier matches (not higher) */
  exactTierMatch: boolean;

  // === Gap Filters ===
  minTierGap: number | null;
  maxTierGap: number | null;
  /** Filter by deviation from expected gap */
  gapDeviation: GapDeviationBand;
  /** Min delta from previous row */
  minDeltaPrev: number | null;
  /** Max delta from previous row */
  maxDeltaPrev: number | null;

  // === Time Filters ===
  /** Show only recent data (minutes) */
  lastNMinutes: number | null;
  /** Start date filter */
  startDate: string | null;
  /** End date filter */
  endDate: string | null;

  // === Pattern Filters ===
  /** Only show first hit in a sequence (gap reset) */
  firstHitOnly: boolean;
  /** Show only consecutive quick hits (gap < expected/2) */
  quickHitsOnly: boolean;
  /** Show only overdue hits (gap > expected * 1.5) */
  overdueHitsOnly: boolean;

  // === Cross-Tier Analysis ===
  /** Reference tier for cross-tier gap analysis (e.g., measure gap from 1066+ to previous 164+) */
  crossTierRef: TierBucket | null;
  /** Min cross-tier gap filter */
  minCrossTierGap: number | null;
  /** Max cross-tier gap filter */
  maxCrossTierGap: number | null;
}

export interface UseExplorerDataOptions {
  streamId: string;
  mode: ExplorerMode;
  initialLimit?: number;
}

export interface UseExplorerDataResult {
  rows: ExplorerRow[];
  isLoading: boolean;
  error: Error | null;
  isConnected: boolean;
  totalCount: number;
  refresh: () => void;
}

// ============ Helpers ============

function mapRound(r: livestore.LiveRound): ExplorerRow {
  return {
    id: r.id,
    nonce: r.nonce,
    round_result: r.round_result,
    received_at: typeof r.received_at === "string" ? r.received_at : undefined,
  };
}

function mapBet(b: livestore.LiveBet): ExplorerRow {
  return {
    id: b.id,
    nonce: b.nonce,
    round_result: b.round_result,
    amount: b.amount,
    payout: b.payout,
    difficulty: b.difficulty,
    round_target: b.round_target ?? null,
    date_time: typeof b.date_time === "string" ? b.date_time : undefined,
    received_at: typeof b.received_at === "string" ? b.received_at : undefined,
  };
}

// ============ Hook ============

export function useExplorerData({
  streamId,
  mode,
  initialLimit = 10000,
}: UseExplorerDataOptions): UseExplorerDataResult {
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const lastNonceRef = useRef(0);
  const lastIdRef = useRef(0);
  const lastUpdateRef = useRef(Date.now());

  // Initial data fetch
  const {
    data: initialData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["explorer-data", streamId, mode, initialLimit],
    queryFn: async () => {
      if (mode === "rounds") {
        const rounds = await GetRecentRounds(streamId, initialLimit);
        return rounds.map(mapRound);
      } else {
        // GetBetsPage(streamId, minMultiplier, order, limit, offset)
        const page = await GetBetsPage(streamId, 0, "desc", initialLimit, 0);
        return page.rows.map(mapBet);
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Set initial data
  useEffect(() => {
    if (initialData) {
      setRows(initialData);
      if (initialData.length > 0) {
        // Find max nonce and max id for tailing
        const maxNonce = Math.max(...initialData.map((r) => r.nonce));
        const maxId = Math.max(...initialData.map((r) => r.id));
        lastNonceRef.current = maxNonce;
        lastIdRef.current = maxId;
      }
      lastUpdateRef.current = Date.now();
      setIsConnected(true);
    }
  }, [initialData]);

  // Handle live updates for rounds
  const handleTick = useCallback(
    async (_event: { nonce: number; roundResult: number }) => {
      if (mode !== "rounds") return;

      lastUpdateRef.current = Date.now();
      setIsConnected(true);

      // Fetch new rounds since last known nonce
      try {
        const result = await TailRounds(streamId, lastNonceRef.current, 100);
        if (result.rows && result.rows.length > 0) {
          const mapped = result.rows.map(mapRound);
          setRows((prev) => {
            const existingIds = new Set(prev.map((r) => r.id));
            const uniqueNew = mapped.filter((r) => !existingIds.has(r.id));
            if (uniqueNew.length === 0) return prev;
            lastNonceRef.current = Math.max(
              lastNonceRef.current,
              ...uniqueNew.map((r) => r.nonce)
            );
            return [...uniqueNew, ...prev];
          });
        }
      } catch (err) {
        console.error("Failed to tail rounds:", err);
      }
    },
    [streamId, mode]
  );

  // Handle live updates for bets
  const handleNewRows = useCallback(
    async (_event: { nonce?: number }) => {
      if (mode !== "bets") return;

      lastUpdateRef.current = Date.now();
      setIsConnected(true);

      // Fetch new bets since last known id
      try {
        const result = await Tail(streamId, lastIdRef.current, 100);
        if (result.rows && result.rows.length > 0) {
          const mapped = result.rows.map(mapBet);
          setRows((prev) => {
            const existingIds = new Set(prev.map((r) => r.id));
            const uniqueNew = mapped.filter((r) => !existingIds.has(r.id));
            if (uniqueNew.length === 0) return prev;
            lastIdRef.current = Math.max(
              lastIdRef.current,
              ...uniqueNew.map((r) => r.id)
            );
            lastNonceRef.current = Math.max(
              lastNonceRef.current,
              ...uniqueNew.map((r) => r.nonce)
            );
            return [...uniqueNew, ...prev];
          });
        }
      } catch (err) {
        console.error("Failed to tail bets:", err);
      }
    },
    [streamId, mode]
  );

  // Subscribe to Wails events
  useEffect(() => {
    const offTick = EventsOn(`live:tick:${streamId}`, handleTick);
    const offNewRows = EventsOn(`live:newrows:${streamId}`, handleNewRows);

    // Connection timeout check
    const checkInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateRef.current;
      if (timeSinceLastUpdate > 30_000) {
        setIsConnected(false);
      }
    }, 10_000);

    return () => {
      offTick();
      offNewRows();
      clearInterval(checkInterval);
    };
  }, [streamId, handleTick, handleNewRows]);

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    rows,
    isLoading,
    error: error as Error | null,
    isConnected,
    totalCount: rows.length,
    refresh,
  };
}

// ============ Derived Column Computation ============

interface ComputeDerivedOptions {
  tierThreshold: number;
  /** Reference tier threshold for cross-tier gap analysis */
  crossTierRefThreshold?: number | null;
}

/**
 * Compute derived columns (Δprev, tierGap, and crossTierGap) for explorer rows.
 *
 * @param rows - Raw rows (nonce DESC by default)
 * @param options - Tier thresholds for gap calculations
 */
export function computeDerivedColumns(
  rows: ExplorerRow[],
  options: ComputeDerivedOptions | number
): DerivedRow[] {
  // Support legacy signature (just tierThreshold number)
  const opts: ComputeDerivedOptions = typeof options === 'number' 
    ? { tierThreshold: options } 
    : options;
  
  const { tierThreshold, crossTierRefThreshold } = opts;

  if (rows.length === 0) return [];

  // Sort by nonce ASC for computing tier gaps
  const sortedAsc = [...rows].sort((a, b) => a.nonce - b.nonce);

  // Build tier gap map: for each row, find distance to previous tier hit
  const tierGapMap = new Map<number, number | null>();
  let lastTierHitNonce: number | null = null;

  for (const row of sortedAsc) {
    if (row.round_result >= tierThreshold) {
      if (lastTierHitNonce !== null) {
        tierGapMap.set(row.id, row.nonce - lastTierHitNonce);
      } else {
        tierGapMap.set(row.id, null); // First hit in window
      }
      lastTierHitNonce = row.nonce;
    } else {
      tierGapMap.set(row.id, null);
    }
  }

  // Build cross-tier gap map: for each primary tier hit, find distance to previous reference tier hit
  const crossTierGapMap = new Map<number, { gap: number | null; refNonce: number | null }>();
  
  if (crossTierRefThreshold !== undefined && crossTierRefThreshold !== null) {
    let lastRefTierHitNonce: number | null = null;

    for (const row of sortedAsc) {
      // Track reference tier hits (>= ref threshold)
      if (row.round_result >= crossTierRefThreshold) {
        // For primary tier hits, record the gap to previous ref hit
        if (row.round_result >= tierThreshold) {
          // Only count if the ref hit is BEFORE this hit (not the same hit)
          // If this hit qualifies for both tiers, we want gap to the PREVIOUS ref hit
          crossTierGapMap.set(row.id, {
            gap: lastRefTierHitNonce !== null ? row.nonce - lastRefTierHitNonce : null,
            refNonce: lastRefTierHitNonce,
          });
        }
        // Update last ref tier hit after processing (so current hit can reference previous)
        lastRefTierHitNonce = row.nonce;
      } else if (row.round_result >= tierThreshold) {
        // Primary tier hit but not ref tier - record gap to last ref hit
        crossTierGapMap.set(row.id, {
          gap: lastRefTierHitNonce !== null ? row.nonce - lastRefTierHitNonce : null,
          refNonce: lastRefTierHitNonce,
        });
      }
    }
  }

  // Compute deltaPrev based on display order (DESC by default)
  const result: DerivedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prevRow = rows[i + 1]; // Next in DESC order = previous in time
    const deltaPrev = prevRow ? row.nonce - prevRow.nonce : null;
    const crossTierData = crossTierGapMap.get(row.id);

    result.push({
      ...row,
      deltaPrev,
      tierGap: tierGapMap.get(row.id) ?? null,
      crossTierGap: crossTierData?.gap ?? null,
      crossTierRefNonce: crossTierData?.refNonce ?? null,
    });
  }

  return result;
}

/** Tier bucket thresholds for filtering */
export const TIER_BUCKET_THRESHOLDS: Record<TierBucket, { min: number; max: number | null }> = {
  'all': { min: 0, max: null },
  '<34': { min: 0, max: 33.99 },
  '34+': { min: 34, max: 164.71 },
  '164+': { min: 164.72, max: 400.01 },
  '400+': { min: 400.02, max: 1066.72 },
  '1066+': { min: 1066.73, max: 3200.17 },
  '3200+': { min: 3200.18, max: 11200.64 },
  '11200+': { min: 11200.65, max: null },
};

/** Gap deviation bands (relative to expected gap) */
export const GAP_DEVIATION_BANDS: Record<GapDeviationBand, { min: number; max: number }> = {
  'any': { min: 0, max: Infinity },
  'tight': { min: 0, max: 0.2 },    // ±20% of expected
  'normal': { min: 0, max: 0.4 },   // ±40% of expected
  'loose': { min: 0, max: 0.6 },    // ±60% of expected
  'outlier': { min: 0.6, max: Infinity }, // >60% deviation
};

/** Default/empty filter state */
export const DEFAULT_FILTERS: ExplorerFilters = {
  minMultiplier: null,
  maxMultiplier: null,
  minNonce: null,
  maxNonce: null,
  tierBucket: 'all',
  excludeTiers: [],
  exactTierMatch: false,
  minTierGap: null,
  maxTierGap: null,
  gapDeviation: 'any',
  minDeltaPrev: null,
  maxDeltaPrev: null,
  lastNMinutes: null,
  startDate: null,
  endDate: null,
  firstHitOnly: false,
  quickHitsOnly: false,
  overdueHitsOnly: false,
  crossTierRef: null,
  minCrossTierGap: null,
  maxCrossTierGap: null,
};

/** Check if any filters are active */
export function hasActiveFilters(filters: ExplorerFilters): boolean {
  return (
    filters.minMultiplier !== null ||
    filters.maxMultiplier !== null ||
    filters.minNonce !== null ||
    filters.maxNonce !== null ||
    filters.tierBucket !== 'all' ||
    filters.excludeTiers.length > 0 ||
    filters.exactTierMatch ||
    filters.minTierGap !== null ||
    filters.maxTierGap !== null ||
    filters.gapDeviation !== 'any' ||
    filters.minDeltaPrev !== null ||
    filters.maxDeltaPrev !== null ||
    filters.lastNMinutes !== null ||
    filters.startDate !== null ||
    filters.endDate !== null ||
    filters.firstHitOnly ||
    filters.quickHitsOnly ||
    filters.overdueHitsOnly ||
    filters.crossTierRef !== null ||
    filters.minCrossTierGap !== null ||
    filters.maxCrossTierGap !== null
  );
}

/** Count active filters */
export function countActiveFilters(filters: ExplorerFilters): number {
  let count = 0;
  if (filters.minMultiplier !== null) count++;
  if (filters.maxMultiplier !== null) count++;
  if (filters.minNonce !== null) count++;
  if (filters.maxNonce !== null) count++;
  if (filters.tierBucket !== 'all') count++;
  if (filters.excludeTiers.length > 0) count++;
  if (filters.exactTierMatch) count++;
  if (filters.minTierGap !== null) count++;
  if (filters.maxTierGap !== null) count++;
  if (filters.gapDeviation !== 'any') count++;
  if (filters.minDeltaPrev !== null) count++;
  if (filters.maxDeltaPrev !== null) count++;
  if (filters.lastNMinutes !== null) count++;
  if (filters.startDate !== null || filters.endDate !== null) count++;
  if (filters.firstHitOnly) count++;
  if (filters.quickHitsOnly) count++;
  if (filters.overdueHitsOnly) count++;
  if (filters.crossTierRef !== null) count++;
  if (filters.minCrossTierGap !== null || filters.maxCrossTierGap !== null) count++;
  return count;
}

/** Get tier bucket for a multiplier value */
function getTierBucketForValue(value: number): TierBucket {
  if (value >= 11200.65) return '11200+';
  if (value >= 3200.18) return '3200+';
  if (value >= 1066.73) return '1066+';
  if (value >= 400.02) return '400+';
  if (value >= 164.72) return '164+';
  if (value >= 34) return '34+';
  return '<34';
}

interface ApplyFiltersOptions {
  tierThreshold: number;
  expectedGap: number;
}

/**
 * Apply filters to explorer rows.
 */
export function applyFilters(
  rows: ExplorerRow[],
  filters: ExplorerFilters,
  options?: ApplyFiltersOptions
): ExplorerRow[] {
  const { tierThreshold = 1066.73, expectedGap = 1088 } = options || {};

  return rows.filter((row) => {
    // === Basic Filters ===
    if (
      filters.minMultiplier !== null &&
      row.round_result < filters.minMultiplier
    ) {
      return false;
    }
    if (
      filters.maxMultiplier !== null &&
      row.round_result > filters.maxMultiplier
    ) {
      return false;
    }
    if (filters.minNonce !== null && row.nonce < filters.minNonce) {
      return false;
    }
    if (filters.maxNonce !== null && row.nonce > filters.maxNonce) {
      return false;
    }

    // === Tier Bucket Filter ===
    if (filters.tierBucket !== 'all') {
      const bucket = TIER_BUCKET_THRESHOLDS[filters.tierBucket];
      if (row.round_result < bucket.min) return false;
      if (bucket.max !== null && row.round_result > bucket.max) return false;
    }

    // === Exact Tier Match ===
    if (filters.exactTierMatch && filters.tierBucket !== 'all') {
      const rowBucket = getTierBucketForValue(row.round_result);
      if (rowBucket !== filters.tierBucket) return false;
    }

    // === Exclude Tiers ===
    if (filters.excludeTiers.length > 0) {
      const rowBucket = getTierBucketForValue(row.round_result);
      if (filters.excludeTiers.includes(rowBucket)) return false;
    }

    // === Time Filters ===
    if (filters.lastNMinutes !== null) {
      const cutoff = new Date(Date.now() - filters.lastNMinutes * 60 * 1000);
      const rowTime = row.received_at ? new Date(row.received_at) : null;
      if (!rowTime || rowTime < cutoff) return false;
    }

    if (filters.startDate) {
      const start = new Date(filters.startDate);
      const rowTime = row.received_at ? new Date(row.received_at) : null;
      if (!rowTime || rowTime < start) return false;
    }

    if (filters.endDate) {
      const end = new Date(filters.endDate);
      const rowTime = row.received_at ? new Date(row.received_at) : null;
      if (!rowTime || rowTime > end) return false;
    }

    return true;
  });
}

/**
 * Apply derived-column filters (must be called after computeDerivedColumns).
 */
export function applyDerivedFilters(
  rows: DerivedRow[],
  filters: ExplorerFilters,
  options: ApplyFiltersOptions
): DerivedRow[] {
  const { tierThreshold, expectedGap } = options;

  return rows.filter((row) => {
    // === Gap Filters ===
    const isTierHit = row.round_result >= tierThreshold;

    if (filters.minTierGap !== null && isTierHit) {
      if (row.tierGap === null || row.tierGap < filters.minTierGap) return false;
    }

    if (filters.maxTierGap !== null && isTierHit) {
      if (row.tierGap === null || row.tierGap > filters.maxTierGap) return false;
    }

    // === Gap Deviation Filter ===
    if (filters.gapDeviation !== 'any' && isTierHit && row.tierGap !== null) {
      const deviation = Math.abs(row.tierGap - expectedGap) / expectedGap;
      const band = GAP_DEVIATION_BANDS[filters.gapDeviation];
      if (deviation < band.min || deviation > band.max) return false;
    }

    // === Delta Prev Filters ===
    if (filters.minDeltaPrev !== null) {
      if (row.deltaPrev === null || row.deltaPrev < filters.minDeltaPrev) return false;
    }

    if (filters.maxDeltaPrev !== null) {
      if (row.deltaPrev === null || row.deltaPrev > filters.maxDeltaPrev) return false;
    }

    // === Pattern Filters ===
    if (filters.firstHitOnly && isTierHit) {
      // Only show rows where tierGap is null (first hit in sequence)
      if (row.tierGap !== null) return false;
    }

    if (filters.quickHitsOnly && isTierHit) {
      // Quick hit: gap < expected/2
      if (row.tierGap === null || row.tierGap >= expectedGap / 2) return false;
    }

    if (filters.overdueHitsOnly && isTierHit) {
      // Overdue: gap > expected * 1.5
      if (row.tierGap === null || row.tierGap <= expectedGap * 1.5) return false;
    }

    // === Cross-Tier Gap Filters ===
    if (filters.crossTierRef !== null && isTierHit) {
      // When cross-tier analysis is active, only show primary tier hits with valid cross-tier gaps
      if (row.crossTierGap === null) return false;
      
      if (filters.minCrossTierGap !== null && row.crossTierGap < filters.minCrossTierGap) {
        return false;
      }
      if (filters.maxCrossTierGap !== null && row.crossTierGap > filters.maxCrossTierGap) {
        return false;
      }
    }

    return true;
  });
}

// ============ Cross-Tier Statistics ============

export interface CrossTierStats {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  median: number | null;
  stdDev: number | null;
  gaps: number[];
}

/**
 * Compute statistics for cross-tier gaps from filtered rows.
 */
export function computeCrossTierStats(rows: DerivedRow[], tierThreshold: number): CrossTierStats {
  const gaps: number[] = [];
  
  for (const row of rows) {
    if (row.round_result >= tierThreshold && row.crossTierGap !== null) {
      gaps.push(row.crossTierGap);
    }
  }

  if (gaps.length === 0) {
    return { count: 0, min: null, max: null, avg: null, median: null, stdDev: null, gaps: [] };
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const sum = gaps.reduce((a, b) => a + b, 0);
  const avg = sum / gaps.length;
  
  // Median
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];

  // Standard deviation
  const squaredDiffs = gaps.map(g => Math.pow(g - avg, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / gaps.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    count: gaps.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median,
    stdDev,
    gaps: sorted,
  };
}

/**
 * Sort rows by a given key.
 */
export type SortKey = "nonce" | "round_result" | "deltaPrev" | "tierGap";
export type SortDir = "asc" | "desc";

export function sortRows(
  rows: DerivedRow[],
  sortKey: SortKey,
  sortDir: SortDir
): DerivedRow[] {
  return [...rows].sort((a, b) => {
    let aVal: number | null = null;
    let bVal: number | null = null;

    switch (sortKey) {
      case "nonce":
        aVal = a.nonce;
        bVal = b.nonce;
        break;
      case "round_result":
        aVal = a.round_result;
        bVal = b.round_result;
        break;
      case "deltaPrev":
        aVal = a.deltaPrev;
        bVal = b.deltaPrev;
        break;
      case "tierGap":
        aVal = a.tierGap;
        bVal = b.tierGap;
        break;
    }

    // Handle nulls - push to end
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    const diff = aVal - bVal;
    return sortDir === "asc" ? diff : -diff;
  });
}
