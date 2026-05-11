// Package accountconnect is the roadmap-facing account connector boundary.
//
// The first implementation delegates to stakeauth, which owns local account
// records, OS secret storage, persistent browser windows, and connection-state
// checks. Keeping this package lets productization work depend on the planned
// module name while the existing Wails bindings continue to use stakeauth.
package accountconnect

import "github.com/MJE43/stake-pf-replay-go/internal/stakeauth"

const (
	StateNotConfigured      = stakeauth.StateNotConfigured
	StateNeedsLogin         = stakeauth.StateNeedsLogin
	StateChecking           = stakeauth.StateChecking
	StateConnected          = stakeauth.StateConnected
	StateNeedsBrowserRepair = stakeauth.StateNeedsBrowserRepair
	StateCredentialFailed   = stakeauth.StateCredentialFailed
	StateDisconnected       = stakeauth.StateDisconnected
)

type (
	Account               = stakeauth.Account
	ActiveStatus          = stakeauth.ActiveStatus
	ConnectionCheckResult = stakeauth.ConnectionCheckResult
	ConnectionStep        = stakeauth.ConnectionStep
	KeyringStore          = stakeauth.KeyringStore
	Module                = stakeauth.Module
	SecretsMasked         = stakeauth.SecretsMasked
	SessionBalance        = stakeauth.SessionBalance
	StateReason           = stakeauth.StateReason
	Store                 = stakeauth.Store
)

func NewStore(dbPath string) (*Store, error) {
	return stakeauth.NewStore(dbPath)
}

func NewKeyringStore(serviceName, fallbackPath string) *KeyringStore {
	return stakeauth.NewKeyringStore(serviceName, fallbackPath)
}

func NewModule(store *Store, keyringStore *KeyringStore) *Module {
	return stakeauth.NewModule(store, keyringStore)
}
