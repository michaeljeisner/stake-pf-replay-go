package stakeauth

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// Account stores non-secret account metadata.
// Secrets (api key, cf_clearance, user-agent) are stored in OS keychain.
type Account struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Mirror          string `json:"mirror"`
	Currency        string `json:"currency"`
	ProfileID       string `json:"profileId"`
	ConnectionState string `json:"connectionState"`
	LastCheckAt     string `json:"lastCheckAt,omitempty"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

// Store persists account metadata in SQLite.
type Store struct {
	db *sql.DB
}

// NewStore opens the SQLite auth DB and enables WAL.
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("stakeauth: open db: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("stakeauth: enable WAL: %w", err)
	}
	return &Store{db: db}, nil
}

// Close closes the DB.
func (s *Store) Close() error {
	return s.db.Close()
}

// Migrate creates tables and indexes.
func (s *Store) Migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS stake_accounts (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL DEFAULT '',
			mirror TEXT NOT NULL DEFAULT 'stake.com',
			currency TEXT NOT NULL DEFAULT 'btc',
			profile_id TEXT NOT NULL DEFAULT '',
			connection_state TEXT NOT NULL DEFAULT 'not_configured',
			last_check_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`ALTER TABLE stake_accounts ADD COLUMN profile_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE stake_accounts ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'not_configured'`,
		`ALTER TABLE stake_accounts ADD COLUMN last_check_at DATETIME NULL`,
		`CREATE INDEX IF NOT EXISTS idx_stake_accounts_updated_at ON stake_accounts(updated_at DESC)`,
	}
	for _, m := range migrations {
		if _, err := s.db.Exec(m); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
				continue
			}
			return fmt.Errorf("stakeauth: migrate: %w", err)
		}
	}
	return nil
}

// List returns all accounts sorted by updated_at descending.
func (s *Store) List() ([]Account, error) {
	rows, err := s.db.Query(
		`SELECT id, label, mirror, currency, profile_id, connection_state, last_check_at, created_at, updated_at
		 FROM stake_accounts
		 ORDER BY updated_at DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("stakeauth: list: %w", err)
	}
	defer rows.Close()

	var out []Account
	for rows.Next() {
		var a Account
		var createdAt, updatedAt time.Time
		var lastCheckAt sql.NullTime
		if err := rows.Scan(&a.ID, &a.Label, &a.Mirror, &a.Currency, &a.ProfileID, &a.ConnectionState, &lastCheckAt, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("stakeauth: scan account: %w", err)
		}
		normalizeAccountState(&a)
		if lastCheckAt.Valid {
			a.LastCheckAt = lastCheckAt.Time.Format(time.RFC3339)
		}
		a.CreatedAt = createdAt.Format(time.RFC3339)
		a.UpdatedAt = updatedAt.Format(time.RFC3339)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stakeauth: iterate accounts: %w", err)
	}
	return out, nil
}

// Get returns a single account by id.
func (s *Store) Get(id string) (*Account, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("stakeauth: id is required")
	}

	var a Account
	var createdAt, updatedAt time.Time
	var lastCheckAt sql.NullTime
	err := s.db.QueryRow(
		`SELECT id, label, mirror, currency, profile_id, connection_state, last_check_at, created_at, updated_at
		 FROM stake_accounts
		 WHERE id = ?`,
		id,
	).Scan(&a.ID, &a.Label, &a.Mirror, &a.Currency, &a.ProfileID, &a.ConnectionState, &lastCheckAt, &createdAt, &updatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("stakeauth: account %q not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("stakeauth: get account: %w", err)
	}
	normalizeAccountState(&a)
	if lastCheckAt.Valid {
		a.LastCheckAt = lastCheckAt.Time.Format(time.RFC3339)
	}
	a.CreatedAt = createdAt.Format(time.RFC3339)
	a.UpdatedAt = updatedAt.Format(time.RFC3339)
	return &a, nil
}

// Save upserts account metadata and returns the stored record.
func (s *Store) Save(acct Account) (Account, error) {
	if strings.TrimSpace(acct.ID) == "" {
		acct.ID = uuid.NewString()
	} else if existing, err := s.Get(acct.ID); err == nil {
		if strings.TrimSpace(acct.ProfileID) == "" {
			acct.ProfileID = existing.ProfileID
		}
		if strings.TrimSpace(acct.ConnectionState) == "" {
			acct.ConnectionState = existing.ConnectionState
		}
	}
	if strings.TrimSpace(acct.Mirror) == "" {
		acct.Mirror = "stake.com"
	}
	if strings.TrimSpace(acct.Currency) == "" {
		acct.Currency = "btc"
	}
	if strings.TrimSpace(acct.ProfileID) == "" {
		acct.ProfileID = uuid.NewString()
	}
	if strings.TrimSpace(acct.ConnectionState) == "" {
		acct.ConnectionState = StateNotConfigured
	}
	acct.Label = strings.TrimSpace(acct.Label)

	_, err := s.db.Exec(
		`INSERT INTO stake_accounts (id, label, mirror, currency, profile_id, connection_state)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   label = excluded.label,
		   mirror = excluded.mirror,
		   currency = excluded.currency,
		   profile_id = excluded.profile_id,
		   connection_state = excluded.connection_state,
		   updated_at = CURRENT_TIMESTAMP`,
		acct.ID, acct.Label, acct.Mirror, acct.Currency, acct.ProfileID, acct.ConnectionState,
	)
	if err != nil {
		return Account{}, fmt.Errorf("stakeauth: save account: %w", err)
	}

	saved, err := s.Get(acct.ID)
	if err != nil {
		return Account{}, err
	}
	return *saved, nil
}

// UpdateConnectionState stores the latest account connection state and check time.
func (s *Store) UpdateConnectionState(id, state string, checkedAt time.Time) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("stakeauth: id is required")
	}
	if strings.TrimSpace(state) == "" {
		state = StateDisconnected
	}
	_, err := s.db.Exec(
		`UPDATE stake_accounts
		 SET connection_state = ?, last_check_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		state, checkedAt.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("stakeauth: update connection state: %w", err)
	}
	return nil
}

// Delete removes account metadata.
func (s *Store) Delete(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("stakeauth: id is required")
	}
	_, err := s.db.Exec(`DELETE FROM stake_accounts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("stakeauth: delete account: %w", err)
	}
	return nil
}

func normalizeAccountState(a *Account) {
	if strings.TrimSpace(a.ProfileID) == "" {
		a.ProfileID = a.ID
	}
	if strings.TrimSpace(a.ConnectionState) == "" {
		a.ConnectionState = StateNotConfigured
	}
}
