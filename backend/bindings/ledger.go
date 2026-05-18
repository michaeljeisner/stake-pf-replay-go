package bindings

import (
	"context"
	"time"
)

// LedgerEntry is the minimal app-bet ledger shape shared across the backend
// module boundary. The desktop host adapts this to internal/livestore.
type LedgerEntry struct {
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

// LedgerRecorder persists app-placed bets after Stake returns a result.
type LedgerRecorder interface {
	RecordLedgerEntry(ctx context.Context, entry LedgerEntry) error
}
