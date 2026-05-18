package livestore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type HistorySyncResult struct {
	Inserted   int           `json:"inserted"`
	Duplicates int           `json:"duplicates"`
	Entries    []LedgerEntry `json:"entries"`
}

// RecordLedgerEntry inserts a ledger row idempotently. If the idempotency key
// already exists, the existing row is returned unchanged.
func (s *Store) RecordLedgerEntry(ctx context.Context, entry LedgerEntry) (LedgerEntry, error) {
	recorded, _, err := s.recordLedgerEntry(ctx, entry)
	return recorded, err
}

// SyncHistoryEntries records historical Stake bets into the unified ledger.
// The caller supplies already-normalized entries; this method owns account,
// source, and idempotency normalization so future Stake history transports can
// reuse the same import path.
func (s *Store) SyncHistoryEntries(ctx context.Context, accountID string, entries []LedgerEntry) (HistorySyncResult, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return HistorySyncResult{}, fmt.Errorf("livestore: account id is required")
	}
	if len(entries) > 10000 {
		return HistorySyncResult{}, fmt.Errorf("livestore: history sync batch too large")
	}

	out := HistorySyncResult{
		Entries: make([]LedgerEntry, 0, len(entries)),
	}
	for i, entry := range entries {
		entry.AccountID = accountID
		entry.Source = "history"
		entry.IdempotencyKey = historyIdempotencyKey(entry)

		recorded, inserted, err := s.recordLedgerEntry(ctx, entry)
		if err != nil {
			return out, fmt.Errorf("livestore: sync history entry %d: %w", i, err)
		}
		if inserted {
			out.Inserted++
		} else {
			out.Duplicates++
		}
		out.Entries = append(out.Entries, recorded)
	}
	return out, nil
}

func (s *Store) recordLedgerEntry(ctx context.Context, entry LedgerEntry) (LedgerEntry, bool, error) {
	entry.AccountID = strings.TrimSpace(entry.AccountID)
	entry.Source = strings.TrimSpace(entry.Source)
	entry.Game = strings.ToLower(strings.TrimSpace(entry.Game))
	entry.IdempotencyKey = strings.TrimSpace(entry.IdempotencyKey)
	entry.Currency = strings.ToLower(strings.TrimSpace(entry.Currency))

	if entry.AccountID == "" {
		return LedgerEntry{}, false, fmt.Errorf("livestore: account id is required")
	}
	if entry.Source == "" {
		return LedgerEntry{}, false, fmt.Errorf("livestore: source is required")
	}
	if entry.Game == "" {
		return LedgerEntry{}, false, fmt.Errorf("livestore: game is required")
	}
	if entry.IdempotencyKey == "" {
		return LedgerEntry{}, false, fmt.Errorf("livestore: idempotency key is required")
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO ledger_entries (
			account_id, source, game, external_bet_id, idempotency_key, currency,
			nonce, amount, payout, payout_multiplier, request_json, response_json, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(idempotency_key) DO NOTHING`,
		entry.AccountID, entry.Source, entry.Game, entry.ExternalBetID, entry.IdempotencyKey, entry.Currency,
		entry.Nonce, entry.Amount, entry.Payout, entry.PayoutMultiplier, entry.RequestJSON, entry.ResponseJSON, entry.CreatedAt.UTC(),
	)
	if err != nil {
		return LedgerEntry{}, false, fmt.Errorf("livestore: record ledger entry: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	recorded, err := s.GetLedgerEntryByIdempotencyKey(ctx, entry.IdempotencyKey)
	return recorded, rowsAffected > 0, err
}

func (s *Store) GetLedgerEntryByIdempotencyKey(ctx context.Context, key string) (LedgerEntry, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return LedgerEntry{}, fmt.Errorf("livestore: idempotency key is required")
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT id, account_id, source, game, external_bet_id, idempotency_key, currency,
		       nonce, amount, payout, payout_multiplier, request_json, response_json, created_at
		FROM ledger_entries
		WHERE idempotency_key = ?`, key)
	return scanLedgerEntry(row)
}

func (s *Store) ListLedgerEntries(ctx context.Context, accountID string, limit, offset int) ([]LedgerEntry, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return nil, fmt.Errorf("livestore: account id is required")
	}
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, account_id, source, game, external_bet_id, idempotency_key, currency,
		       nonce, amount, payout, payout_multiplier, request_json, response_json, created_at
		FROM ledger_entries
		WHERE account_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?`, accountID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("livestore: list ledger entries: %w", err)
	}
	defer rows.Close()

	var out []LedgerEntry
	for rows.Next() {
		entry, err := scanLedgerEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (s *Store) GetLedgerSummary(ctx context.Context, accountID string) (LedgerSummary, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return LedgerSummary{}, fmt.Errorf("livestore: account id is required")
	}

	summary := LedgerSummary{AccountID: accountID}
	row := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(amount), 0), COALESCE(SUM(payout), 0),
		       COALESCE(SUM(payout - amount), 0),
		       COALESCE(SUM(CASE WHEN payout > amount THEN 1 ELSE 0 END), 0)
		FROM ledger_entries
		WHERE account_id = ?`, accountID)
	if err := row.Scan(&summary.Count, &summary.Wagered, &summary.Payout, &summary.Profit, &summary.WinCount); err != nil {
		return LedgerSummary{}, fmt.Errorf("livestore: ledger summary: %w", err)
	}
	if summary.Wagered > 0 {
		summary.ROI = summary.Profit / summary.Wagered
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT game, source, COUNT(*), COALESCE(SUM(amount), 0), COALESCE(SUM(payout), 0),
		       COALESCE(SUM(payout - amount), 0),
		       COALESCE(SUM(CASE WHEN payout > amount THEN 1 ELSE 0 END), 0),
		       COALESCE(MAX(nonce), 0)
		FROM ledger_entries
		WHERE account_id = ?
		GROUP BY game, source
		ORDER BY COUNT(*) DESC, game ASC, source ASC`, accountID)
	if err != nil {
		return LedgerSummary{}, fmt.Errorf("livestore: ledger summary groups: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var group LedgerGameSummary
		if err := rows.Scan(
			&group.Game, &group.Source, &group.Count, &group.Wagered, &group.Payout,
			&group.Profit, &group.WinCount, &group.LastNonce,
		); err != nil {
			return LedgerSummary{}, fmt.Errorf("livestore: scan ledger summary group: %w", err)
		}
		summary.ByGame = append(summary.ByGame, group)
	}
	if err := rows.Err(); err != nil {
		return LedgerSummary{}, err
	}
	return summary, nil
}

type ledgerScanner interface {
	Scan(dest ...any) error
}

func scanLedgerEntry(row ledgerScanner) (LedgerEntry, error) {
	var entry LedgerEntry
	if err := row.Scan(
		&entry.ID, &entry.AccountID, &entry.Source, &entry.Game, &entry.ExternalBetID,
		&entry.IdempotencyKey, &entry.Currency, &entry.Nonce, &entry.Amount, &entry.Payout,
		&entry.PayoutMultiplier, &entry.RequestJSON, &entry.ResponseJSON, &entry.CreatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return LedgerEntry{}, fmt.Errorf("livestore: ledger entry not found")
		}
		return LedgerEntry{}, fmt.Errorf("livestore: scan ledger entry: %w", err)
	}
	return entry, nil
}

func historyIdempotencyKey(entry LedgerEntry) string {
	if key := strings.TrimSpace(entry.IdempotencyKey); key != "" {
		return key
	}
	accountID := strings.TrimSpace(entry.AccountID)
	game := strings.ToLower(strings.TrimSpace(entry.Game))
	externalID := strings.TrimSpace(entry.ExternalBetID)
	if externalID != "" {
		return fmt.Sprintf("history:%s:%s:%s", accountID, game, externalID)
	}
	if entry.Nonce <= 0 || entry.CreatedAt.IsZero() {
		return ""
	}
	return fmt.Sprintf("history:%s:%s:%d:%s", accountID, game, entry.Nonce, entry.CreatedAt.UTC().Format(time.RFC3339Nano))
}
