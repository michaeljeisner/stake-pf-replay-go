// Package stakeclient provides the productization-facing Stake API facade.
//
// It deliberately sits above the lower-level stake.Client so betting features
// have one place to enforce account connection, browser/session transport
// policy, and per-account request serialization.
package stakeclient

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/MJE43/stake-pf-replay-go/internal/stake"
)

// Config describes a connected account facade.
type Config struct {
	AccountID string
	Domain    string
	APIKey    string
	Currency  string

	// Transport should be backed by the connected browser profile once that
	// bridge is available. Direct HTTP is only allowed when AllowDirectFallback
	// is true, after the account connector has proven the current profile.
	Transport           stake.RequestTransport
	AllowDirectFallback bool
	HTTPClient          *http.Client

	UserAgent string
	Clearance string
}

// Facade serializes all account-bound Stake calls.
type Facade struct {
	accountID string
	client    *stake.Client
	mu        sync.Mutex
}

// New creates a connected Stake facade.
func New(cfg Config) (*Facade, error) {
	accountID := strings.TrimSpace(cfg.AccountID)
	if accountID == "" {
		return nil, fmt.Errorf("stakeclient: account id is required")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("stakeclient: api key is required")
	}
	if cfg.Transport == nil && !cfg.AllowDirectFallback {
		return nil, fmt.Errorf("stakeclient: browser-backed transport is required unless direct fallback is explicitly allowed")
	}

	client := stake.NewClient(stake.Config{
		Domain:       cfg.Domain,
		SessionToken: cfg.APIKey,
		Currency:     cfg.Currency,
		Transport:    cfg.Transport,
		HTTPClient:   cfg.HTTPClient,
		UserAgent:    cfg.UserAgent,
		Clearance:    cfg.Clearance,
	})
	return &Facade{accountID: accountID, client: client}, nil
}

func (f *Facade) AccountID() string {
	return f.accountID
}

func (f *Facade) UserBalances(ctx context.Context) ([]stake.Balance, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.client.GetBalances(ctx)
}

func (f *Facade) DiceBet(ctx context.Context, req stake.DiceBetRequest) (*stake.DiceBetResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.client.DiceBet(ctx, req)
}

func (f *Facade) LimboBet(ctx context.Context, req stake.LimboBetRequest) (*stake.LimboBetResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.client.LimboBet(ctx, req)
}

// StartupRecovery checks the active-state games that must be recovered before
// any automated session can begin.
func (f *Facade) StartupRecovery(ctx context.Context) (map[string]*stake.BetResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	out := make(map[string]*stake.BetResult, 3)
	for _, game := range []string{"hilo", "mines", "blackjack"} {
		active, err := f.client.GetActiveBet(ctx, game)
		if err != nil {
			return nil, fmt.Errorf("stakeclient: recover active %s bet: %w", game, err)
		}
		out[game] = active
	}
	return out, nil
}
