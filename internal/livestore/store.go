package livestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// --------- Data models ---------

type LiveStream struct {
	ID                uuid.UUID `json:"id"`
	ServerSeedHashed  string    `json:"server_seed_hashed"`
	ClientSeed        string    `json:"client_seed"`
	CreatedAt         time.Time `json:"created_at"`
	LastSeenAt        time.Time `json:"last_seen_at"`
	Notes             string    `json:"notes"`
	TotalBets         int64     `json:"total_bets"`
	HighestResult     float64   `json:"highest_result"`
	LastObservedNonce int64     `json:"last_observed_nonce"`
	LastObservedAt    time.Time `json:"last_observed_at"`
}

// LiveRound represents a single round observation from heartbeat data.
type LiveRound struct {
	ID          int64     `json:"id"`
	StreamID    uuid.UUID `json:"stream_id"`
	Nonce       int64     `json:"nonce"`
	RoundResult float64   `json:"round_result"`
	ReceivedAt  time.Time `json:"received_at"`
}

type LiveBet struct {
	ID           int64     `json:"id"`
	StreamID     uuid.UUID `json:"stream_id"`
	AntebotBetID string    `json:"antebot_bet_id"`
	ReceivedAt   time.Time `json:"received_at"`
	DateTime     time.Time `json:"date_time"`
	Nonce        int64     `json:"nonce"`
	Amount       float64   `json:"amount"`
	Payout       float64   `json:"payout"`
	Difficulty   string    `json:"difficulty"`
	RoundTarget  float64   `json:"round_target"`
	RoundResult  float64   `json:"round_result"`
}

// LedgerEntry records any real-money Stake interaction that should be
// replayable later: external ingest, app-placed bets, history sync, and future
// strategy sessions.
type LedgerEntry struct {
	ID               int64     `json:"id"`
	AccountID        string    `json:"account_id"`
	Source           string    `json:"source"`
	Game             string    `json:"game"`
	ExternalBetID    string    `json:"external_bet_id,omitempty"`
	IdempotencyKey   string    `json:"idempotency_key"`
	Currency         string    `json:"currency"`
	Nonce            int64     `json:"nonce"`
	Amount           float64   `json:"amount"`
	Payout           float64   `json:"payout"`
	PayoutMultiplier float64   `json:"payout_multiplier"`
	RequestJSON      string    `json:"request_json,omitempty"`
	ResponseJSON     string    `json:"response_json,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

type LedgerGameSummary struct {
	Game      string  `json:"game"`
	Source    string  `json:"source"`
	Count     int64   `json:"count"`
	Wagered   float64 `json:"wagered"`
	Payout    float64 `json:"payout"`
	Profit    float64 `json:"profit"`
	WinCount  int64   `json:"win_count"`
	LastNonce int64   `json:"last_nonce"`
}

type LedgerSummary struct {
	AccountID string              `json:"account_id"`
	Count     int64               `json:"count"`
	Wagered   float64             `json:"wagered"`
	Payout    float64             `json:"payout"`
	Profit    float64             `json:"profit"`
	ROI       float64             `json:"roi"`
	WinCount  int64               `json:"win_count"`
	ByGame    []LedgerGameSummary `json:"by_game"`
}

// IngestResult indicates whether a bet was stored or ignored as duplicate.
type IngestResult struct {
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}

// --------- Store ---------

type Store struct {
	db *sql.DB
}

// New opens/creates a SQLite database at dbPath and runs migrations.
func New(dbPath string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&cache=shared", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite is not concurrent for writes
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// --------- Migrations ---------

func (s *Store) migrate(ctx context.Context) error {
	stmts := []string{
		// Streams table
		`CREATE TABLE IF NOT EXISTS live_streams (
			id TEXT PRIMARY KEY,
			server_seed_hashed TEXT NOT NULL,
			client_seed TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			last_seen_at TIMESTAMP NOT NULL,
			notes TEXT DEFAULT '',
			last_observed_nonce INTEGER DEFAULT 0,
			last_observed_at TIMESTAMP,
			UNIQUE(server_seed_hashed, client_seed)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_streams_last_seen ON live_streams(last_seen_at DESC);`,

		// Bets table
		`CREATE TABLE IF NOT EXISTS live_bets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			antebot_bet_id TEXT NOT NULL,
			received_at TIMESTAMP NOT NULL,
			date_time TIMESTAMP NOT NULL,
			nonce INTEGER NOT NULL,
			amount REAL NOT NULL,
			payout REAL NOT NULL,
			difficulty TEXT NOT NULL,
			round_target REAL NOT NULL,
			round_result REAL NOT NULL,
			UNIQUE(stream_id, antebot_bet_id),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_nonce ON live_bets(stream_id, nonce);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_datetime ON live_bets(stream_id, date_time DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_result ON live_bets(stream_id, round_result DESC);`,

		// Rounds table for heartbeat data (all round results for pattern analysis)
		`CREATE TABLE IF NOT EXISTS live_rounds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			nonce INTEGER NOT NULL,
			round_result REAL NOT NULL,
			received_at TIMESTAMP NOT NULL,
			UNIQUE(stream_id, nonce),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_nonce ON live_rounds(stream_id, nonce DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_result ON live_rounds(stream_id, round_result DESC);`,

		// Optional mapping of hashed → plain
		`CREATE TABLE IF NOT EXISTS seed_aliases (
			server_seed_hashed TEXT PRIMARY KEY,
			server_seed_plain  TEXT NOT NULL,
			first_seen TIMESTAMP NOT NULL,
			last_seen  TIMESTAMP NOT NULL
		);`,

		// Unified productization ledger. This intentionally does not require a
		// live stream because app-placed bets and synced history may exist before
		// a stream is selected.
		`CREATE TABLE IF NOT EXISTS ledger_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id TEXT NOT NULL,
			source TEXT NOT NULL,
			game TEXT NOT NULL,
			external_bet_id TEXT NOT NULL DEFAULT '',
			idempotency_key TEXT NOT NULL,
			currency TEXT NOT NULL DEFAULT '',
			nonce INTEGER NOT NULL DEFAULT 0,
			amount REAL NOT NULL DEFAULT 0,
			payout REAL NOT NULL DEFAULT 0,
			payout_multiplier REAL NOT NULL DEFAULT 0,
			request_json TEXT NOT NULL DEFAULT '',
			response_json TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL,
			UNIQUE(idempotency_key)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created ON ledger_entries(account_id, created_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_ledger_entries_game_nonce ON ledger_entries(game, nonce DESC);`,

		// Migration: add columns to existing live_streams if they don't exist
		// SQLite doesn't support IF NOT EXISTS for columns, so we use a workaround
		`CREATE TABLE IF NOT EXISTS _migration_marker (version INTEGER PRIMARY KEY);`,
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Run column migrations for existing databases
	return s.migrateColumns(ctx)
}

// migrateColumns adds new columns to existing tables (idempotent).
func (s *Store) migrateColumns(ctx context.Context) error {
	// Check if last_observed_nonce column exists
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info('live_streams') WHERE name='last_observed_nonce'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		// Add the new columns
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_nonce INTEGER DEFAULT 0`); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_at TIMESTAMP`); err != nil {
			return err
		}
	}
	return nil
}

// --------- Streams ---------

// FindOrCreateStream gets the stream id for a (hash, client) pair.
// If it does not exist, it is created.
func (s *Store) FindOrCreateStream(ctx context.Context, serverSeedHashed, clientSeed string) (uuid.UUID, error) {
	now := time.Now().UTC()

	// Try fast path: select existing
	var idStr string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM live_streams WHERE server_seed_hashed=? AND client_seed=?`,
		serverSeedHashed, clientSeed).Scan(&idStr)
	switch {
	case err == nil:
		if _, err2 := s.db.ExecContext(ctx,
			`UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, idStr); err2 != nil {
			return uuid.Nil, err2
		}
		return uuid.MustParse(idStr), nil
	case errors.Is(err, sql.ErrNoRows):
		// Create new
		id := uuid.New()
		_, err2 := s.db.ExecContext(ctx,
			`INSERT INTO live_streams(id, server_seed_hashed, client_seed, created_at, last_seen_at, notes)
			 VALUES(?, ?, ?, ?, ?, '')`,
			id.String(), serverSeedHashed, clientSeed, now, now)
		if err2 != nil {
			// Race: another writer inserted concurrently; select again.
			if isConstraintErr(err2) {
				return s.FindOrCreateStream(ctx, serverSeedHashed, clientSeed)
			}
			return uuid.Nil, err2
		}
		return id, nil
	default:
		return uuid.Nil, err
	}
}

// UpdateNotes sets or clears notes on a stream.
func (s *Store) UpdateNotes(ctx context.Context, streamID uuid.UUID, notes string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE live_streams SET notes=? WHERE id=?`, notes, streamID.String())
	return err
}

// GetStream returns stream metadata including aggregates.
func (s *Store) GetStream(ctx context.Context, streamID uuid.UUID) (LiveStream, error) {
	var ls LiveStream
	var lastObservedAt sql.NullTime
	row := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0), s.last_observed_at,
		       COALESCE(b.cnt, 0), COALESCE(b.maxres, 0)
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets WHERE stream_id=? ) b
		ON s.id = b.stream_id
		WHERE s.id=?`,
		streamID.String(), streamID.String(),
	)
	err := row.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
		&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult)
	if lastObservedAt.Valid {
		ls.LastObservedAt = lastObservedAt.Time
	}
	return ls, err
}

// ListStreams returns streams ordered by last_seen_at desc with aggregates.
func (s *Store) ListStreams(ctx context.Context, limit, offset int) ([]LiveStream, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0) AS last_observed_nonce,
		       s.last_observed_at,
		       COALESCE(b.cnt, 0) AS total_bets,
		       COALESCE(b.maxres, 0) AS highest_result
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets GROUP BY stream_id
		) b ON s.id = b.stream_id
		ORDER BY s.last_seen_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveStream
	for rows.Next() {
		var ls LiveStream
		var lastObservedAt sql.NullTime
		if err := rows.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
			&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult); err != nil {
			return nil, err
		}
		if lastObservedAt.Valid {
			ls.LastObservedAt = lastObservedAt.Time
		}
		out = append(out, ls)
	}
	return out, rows.Err()
}

// --------- Bets (ingest/query) ---------

// IngestBet stores a bet under the stream. Idempotent on (stream_id, antebot_bet_id).
func (s *Store) IngestBet(ctx context.Context, streamID uuid.UUID, bet LiveBet) (IngestResult, error) {
	// Basic validation
	if bet.AntebotBetID == "" {
		return IngestResult{Accepted: false, Reason: "missing bet id"}, errors.New("missing antebot_bet_id")
	}
	if bet.DateTime.IsZero() {
		return IngestResult{Accepted: false, Reason: "missing date_time"}, errors.New("missing date_time")
	}
	if bet.Nonce <= 0 {
		return IngestResult{Accepted: false, Reason: "invalid nonce"}, errors.New("invalid nonce")
	}
	if bet.Difficulty == "" {
		return IngestResult{Accepted: false, Reason: "missing difficulty"}, errors.New("missing difficulty")
	}

	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_bets(
			stream_id, antebot_bet_id, received_at, date_time, nonce,
			amount, payout, difficulty, round_target, round_result
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		streamID.String(), bet.AntebotBetID, now, bet.DateTime.UTC(), bet.Nonce,
		bet.Amount, bet.Payout, strings.ToLower(bet.Difficulty), bet.RoundTarget, bet.RoundResult)
	if err != nil {
		if isConstraintErr(err) {
			// Duplicate bet for this stream
			return IngestResult{Accepted: false, Reason: "duplicate"}, nil
		}
		return IngestResult{Accepted: false, Reason: "db_error"}, err
	}

	// touch last_seen_at
	_, _ = s.db.ExecContext(ctx, `UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, streamID.String())
	return IngestResult{Accepted: true}, nil
}

// ListBets returns paginated bets for a stream with optional minResult filter.
// order can be "asc" or "desc" by nonce.
func (s *Store) ListBets(ctx context.Context, streamID uuid.UUID, minResult float64, order string, limit, offset int) ([]LiveBet, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 500
	}
	if order != "asc" {
		order = "desc"
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_bets WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, antebot_bet_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE %s
		ORDER BY nonce %s
		LIMIT ? OFFSET ?`, where, strings.ToUpper(order))
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

// TailBets returns bets strictly greater than lastID for a stream, limited.
func (s *Store) TailBets(ctx context.Context, streamID uuid.UUID, lastID int64, limit int) ([]LiveBet, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, antebot_bet_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE stream_id=? AND id > ?
		ORDER BY id ASC
		LIMIT ?`, streamID.String(), lastID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteStream removes a stream and all related bets.
func (s *Store) DeleteStream(ctx context.Context, streamID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM live_streams WHERE id=?`, streamID.String())
	return err
}

// ExportCSV writes all bets for a stream to the writer as CSV (header included).
func (s *Store) ExportCSV(ctx context.Context, w io.Writer, streamID uuid.UUID) error {
	// Write header
	if _, err := io.WriteString(w, "id,nonce,date_time,amount,payout,difficulty,round_target,round_result\n"); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, nonce, date_time, amount, payout, difficulty, round_target, round_result
		FROM live_bets WHERE stream_id=? ORDER BY nonce ASC`, streamID.String())
	if err != nil {
		return err
	}
	defer rows.Close()

	var (
		id                 int64
		n                  int64
		ts                 time.Time
		amt, pay, tgt, res float64
		diff               string
	)
	for rows.Next() {
		if err := rows.Scan(&id, &n, &ts, &amt, &pay, &diff, &tgt, &res); err != nil {
			return err
		}
		line := fmt.Sprintf("%d,%d,%s,%.8f,%.8f,%s,%.2f,%.2f\n",
			id, n, ts.UTC().Format(time.RFC3339Nano), amt, pay, diff, tgt, res)
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	return rows.Err()
}

// --------- Rounds (heartbeat data) ---------

// UpdateLastObservedNonce updates the stream's last observed nonce (from heartbeats).
func (s *Store) UpdateLastObservedNonce(ctx context.Context, streamID uuid.UUID, nonce int64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE live_streams
		SET last_observed_nonce = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN COALESCE(last_observed_nonce, 0)
		        ELSE ?
		    END,
		    last_observed_at = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN last_observed_at
		        ELSE ?
		    END,
		    last_seen_at = ?
		WHERE id = ?`,
		nonce, nonce, nonce, now, now, streamID.String())
	return err
}

// InsertRound stores a round from heartbeat data. Idempotent on (stream_id, nonce).
func (s *Store) InsertRound(ctx context.Context, streamID uuid.UUID, nonce int64, roundResult float64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_rounds(stream_id, nonce, round_result, received_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(stream_id, nonce) DO UPDATE SET
			round_result = excluded.round_result,
			received_at = excluded.received_at`,
		streamID.String(), nonce, roundResult, now)
	return err
}

// ListRounds returns rounds for a stream ordered by nonce.
func (s *Store) ListRounds(ctx context.Context, streamID uuid.UUID, minResult float64, limit, offset int) ([]LiveRound, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_rounds WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE %s
		ORDER BY nonce DESC
		LIMIT ? OFFSET ?`, where)
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// TailRounds returns rounds with nonce > sinceNonce for a stream, ordered by nonce ASC.
func (s *Store) TailRounds(ctx context.Context, streamID uuid.UUID, sinceNonce int64, limit int) ([]LiveRound, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ? AND nonce > ?
		ORDER BY nonce ASC
		LIMIT ?`, streamID.String(), sinceNonce, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRecentRounds returns the most recent N rounds for a stream, ordered by nonce DESC.
func (s *Store) GetRecentRounds(ctx context.Context, streamID uuid.UUID, limit int) ([]LiveRound, error) {
	// Frontend requests thousands of rounds for analytics/patterns; keep this in sync.
	// We clamp rather than defaulting to 200 when the caller asks for more than the max.
	const defaultLimit = 200
	const maxLimit = 20000
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ?
		ORDER BY nonce DESC
		LIMIT ?`, streamID.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CleanupOldRounds removes rounds older than the specified nonce threshold for a stream.
// This helps prevent unbounded growth of the rounds table.
func (s *Store) CleanupOldRounds(ctx context.Context, streamID uuid.UUID, keepLastN int) error {
	if keepLastN <= 0 {
		keepLastN = 50000 // Default: keep last 50k rounds
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM live_rounds
		WHERE stream_id = ? AND nonce < (
			SELECT MIN(nonce) FROM (
				SELECT nonce FROM live_rounds WHERE stream_id = ?
				ORDER BY nonce DESC LIMIT ?
			)
		)`, streamID.String(), streamID.String(), keepLastN)
	return err
}

// --------- Seed aliases ---------

// UpsertSeedAlias links a hashed server seed to its plain text.
func (s *Store) UpsertSeedAlias(ctx context.Context, hashed, plain string) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO seed_aliases(server_seed_hashed, server_seed_plain, first_seen, last_seen)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(server_seed_hashed) DO UPDATE SET
			server_seed_plain=excluded.server_seed_plain,
			last_seen=excluded.last_seen
	`, hashed, plain, now, now)
	return err
}

// LookupSeedAlias returns the plain seed for a hash if it exists.
func (s *Store) LookupSeedAlias(ctx context.Context, hashed string) (string, bool, error) {
	var plain string
	err := s.db.QueryRowContext(ctx, `SELECT server_seed_plain FROM seed_aliases WHERE server_seed_hashed=?`, hashed).Scan(&plain)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return plain, err == nil, err
}

// --------- helpers ---------

func isConstraintErr(err error) bool {
	// modernc sqlite returns errors with messages containing "constraint failed"
	// or "UNIQUE constraint failed". Use substring match.
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "constraint failed") || strings.Contains(msg, "unique constraint")
}
