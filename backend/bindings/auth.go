package bindings

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/MJE43/stake-pf-replay-go/internal/stake"
	"github.com/MJE43/stake-pf-replay-go/internal/stakeauth"
)

// AuthModule exposes stakeauth.Module through the bindings package.
type AuthModule struct {
	inner *stakeauth.Module
	store *stakeauth.Store
}

func NewAuthModule(dbPath, fallbackSecretsPath string) (*AuthModule, error) {
	store, err := stakeauth.NewStore(dbPath)
	if err != nil {
		return nil, fmt.Errorf("auth store init failed: %w", err)
	}
	if err := store.Migrate(); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("auth store migrate failed: %w", err)
	}

	keyringStore := stakeauth.NewKeyringStore("wen-desktop", fallbackSecretsPath)
	mod := stakeauth.NewModule(store, keyringStore)
	return &AuthModule{
		inner: mod,
		store: store,
	}, nil
}

func (m *AuthModule) Startup(ctx context.Context) {
	m.inner.Startup(ctx)
}

func (m *AuthModule) Shutdown() error {
	if m.store != nil {
		return m.store.Close()
	}
	return nil
}

func (m *AuthModule) ListAccounts() ([]stakeauth.Account, error) {
	return m.inner.ListAccounts()
}

func (m *AuthModule) SaveAccount(acct stakeauth.Account) (stakeauth.Account, error) {
	return m.inner.SaveAccount(acct)
}

func (m *AuthModule) DeleteAccount(id string) error {
	return m.inner.DeleteAccount(id)
}

func (m *AuthModule) SetSecrets(id, apiKey, clearance, userAgent string) error {
	return m.inner.SetSecrets(id, apiKey, clearance, userAgent)
}

func (m *AuthModule) GetSecretsMasked(id string) (stakeauth.SecretsMasked, error) {
	return m.inner.GetSecretsMasked(id)
}

func (m *AuthModule) ConnectionCheck(id string) (stakeauth.ConnectionCheckResult, error) {
	return m.inner.ConnectionCheck(id)
}

func (m *AuthModule) Connect(id string) error {
	return m.inner.Connect(id)
}

func (m *AuthModule) Disconnect() {
	m.inner.Disconnect()
}

func (m *AuthModule) GetActiveStatus() stakeauth.ActiveStatus {
	return m.inner.GetActiveStatus()
}

func (m *AuthModule) OpenCasinoInBrowser(id string) error {
	return m.inner.OpenCasinoInBrowser(id)
}

func (m *AuthModule) RepairSession(id string) error {
	return m.inner.RepairSession(id)
}

// SessionProvider methods used by ScriptModule.
func (m *AuthModule) Client() *stake.Client {
	return m.inner.Client()
}

func (m *AuthModule) IsConnected() bool {
	return m.inner.IsConnected()
}

func (m *AuthModule) ActiveConnectionState() string {
	return m.inner.ActiveConnectionState()
}

func (m *AuthModule) ActiveAccountID() string {
	return m.inner.ActiveAccountID()
}

func (m *AuthModule) MarkSessionFailure(kind stake.ErrorKind, message string) {
	m.inner.MarkSessionFailure(kind, message)
}

// DefaultFallbackSecretsPath builds a fallback secret file path.
func DefaultFallbackSecretsPath(baseDir string) string {
	return filepath.Join(baseDir, "auth_secrets_fallback.json")
}
