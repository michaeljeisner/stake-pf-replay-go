package stakeauth

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MJE43/stake-pf-replay-go/internal/stake"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/zalando/go-keyring"
)

// SecretsMasked returns only availability flags to avoid exposing secrets in UI/API.
type SecretsMasked struct {
	HasAPIKey    bool `json:"hasApiKey"`
	HasClearance bool `json:"hasClearance"`
	HasUserAgent bool `json:"hasUserAgent"`
}

// ConnectionStep reports a single step in connection checks.
type ConnectionStep struct {
	Name    string `json:"name"`
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// ConnectionCheckResult contains outcomes for all connection check steps.
type ConnectionCheckResult struct {
	OK          bool             `json:"ok"`
	State       string           `json:"state"`
	Reason      StateReason      `json:"reason,omitempty"`
	LastCheckAt string           `json:"lastCheckAt,omitempty"`
	Steps       []ConnectionStep `json:"steps"`
}

// SessionBalance is a simplified balance entry for frontend rendering.
type SessionBalance struct {
	Currency  string  `json:"currency"`
	Available float64 `json:"available"`
	Vault     float64 `json:"vault"`
}

// ActiveStatus is the frontend-facing connected session state.
type ActiveStatus struct {
	Connected   bool             `json:"connected"`
	State       string           `json:"state"`
	Reason      StateReason      `json:"reason,omitempty"`
	LastCheckAt string           `json:"lastCheckAt,omitempty"`
	AccountID   string           `json:"accountId,omitempty"`
	Account     *Account         `json:"account,omitempty"`
	Error       string           `json:"error,omitempty"`
	Balances    []SessionBalance `json:"balances,omitempty"`
}

// Module provides Wails-bound auth/account/session functionality.
type Module struct {
	ctx     context.Context
	app     *application.App
	store   *Store
	keyring *KeyringStore

	mu          sync.RWMutex
	activeID    string
	active      *stake.Client
	activeState ActiveStatus
}

// NewModule creates a stake auth module.
func NewModule(store *Store, keyringStore *KeyringStore) *Module {
	return &Module{
		store:   store,
		keyring: keyringStore,
		activeState: ActiveStatus{
			Connected: false,
			State:     StateDisconnected,
		},
	}
}

// Startup captures wails context.
func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

// SetApplication injects the Wails v3 application for native integrations.
func (m *Module) SetApplication(app *application.App) {
	m.app = app
}

func (m *Module) context() context.Context {
	if m.ctx != nil {
		return m.ctx
	}
	return context.Background()
}

func (m *Module) ListAccounts() ([]Account, error) {
	return m.store.List()
}

func (m *Module) SaveAccount(acct Account) (Account, error) {
	return m.store.Save(acct)
}

func (m *Module) DeleteAccount(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("account id is required")
	}
	if err := m.keyring.DeleteAll(id); err != nil && !strings.Contains(strings.ToLower(err.Error()), "not found") {
		return err
	}
	if err := m.store.Delete(id); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.activeID == id {
		m.active = nil
		m.activeID = ""
		m.activeState = ActiveStatus{Connected: false, State: StateDisconnected}
	}
	return nil
}

func (m *Module) SetSecrets(id, apiKey, clearance, userAgent string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("account id is required")
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey != "" {
		if err := m.keyring.SetAPIKey(id, apiKey); err != nil {
			return err
		}
	} else if _, err := m.keyring.GetAPIKey(id); err != nil {
		return fmt.Errorf("api key is required")
	}
	if err := m.keyring.SetClearance(id, strings.TrimSpace(clearance)); err != nil {
		return err
	}
	if err := m.keyring.SetUserAgent(id, strings.TrimSpace(userAgent)); err != nil {
		return err
	}
	return nil
}

func (m *Module) GetSecretsMasked(id string) (SecretsMasked, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return SecretsMasked{}, fmt.Errorf("account id is required")
	}
	var out SecretsMasked

	if _, err := m.keyring.GetAPIKey(id); err == nil {
		out.HasAPIKey = true
	} else if !strings.Contains(strings.ToLower(err.Error()), "not found") && !isKeyringNotFound(err) {
		return out, err
	}
	if v, err := m.keyring.GetClearance(id); err == nil && strings.TrimSpace(v) != "" {
		out.HasClearance = true
	}
	if v, err := m.keyring.GetUserAgent(id); err == nil && strings.TrimSpace(v) != "" {
		out.HasUserAgent = true
	}
	return out, nil
}

func isKeyringNotFound(err error) bool {
	return err != nil && (errors.Is(err, keyring.ErrNotFound) || strings.Contains(strings.ToLower(err.Error()), "not found"))
}

func (m *Module) ConnectionCheck(id string) (ConnectionCheckResult, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return ConnectionCheckResult{}, fmt.Errorf("account id is required")
	}
	acct, err := m.store.Get(id)
	if err != nil {
		return ConnectionCheckResult{}, err
	}
	checkedAt := time.Now().UTC()
	m.setActiveState(ActiveStatus{
		Connected: false,
		State:     StateChecking,
		AccountID: id,
		Account:   acct,
	})

	apiKey, err := m.keyring.GetAPIKey(id)
	if err != nil {
		result := m.finishConnectionCheck(id, acct, checkedAt, ConnectionCheckResult{
			OK:    false,
			State: StateNotConfigured,
			Reason: StateReason{
				Code:    "missing_api_key",
				Message: "Stake API key is required before connecting.",
			},
			Steps: []ConnectionStep{{Name: "credentials", Success: false, Message: "missing api key"}},
		})
		return result, nil
	}
	clearance, _ := m.keyring.GetClearance(id)
	userAgent, _ := m.keyring.GetUserAgent(id)

	result := ConnectionCheckResult{
		OK:    false,
		State: StateChecking,
		Steps: []ConnectionStep{},
	}

	httpClient := &http.Client{Timeout: 8 * time.Second}
	base := strings.TrimSpace(acct.Mirror)
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		base = "https://" + base
	}

	// 1) Mirror reachability
	step1 := ConnectionStep{Name: "mirror"}
	req1, _ := http.NewRequestWithContext(m.context(), http.MethodHead, base+"/", nil)
	resp1, err := httpClient.Do(req1)
	if resp1 != nil {
		defer resp1.Body.Close()
	}
	if err != nil || resp1 == nil || resp1.StatusCode >= 400 {
		step1.Success = false
		if err != nil {
			step1.Message = err.Error()
		} else {
			step1.Message = fmt.Sprintf("status %d", resp1.StatusCode)
		}
		result.Steps = append(result.Steps, step1)
		result.State = StateNeedsLogin
		result.Reason = StateReason{Code: "mirror_unreachable", Message: step1.Message}
		return m.finishConnectionCheck(id, acct, checkedAt, result), nil
	}
	step1.Success = true
	result.Steps = append(result.Steps, step1)

	// 2) Cloudflare/session check
	step2 := ConnectionStep{Name: "browser_session"}
	req2, _ := http.NewRequestWithContext(
		m.context(),
		http.MethodPost,
		base+"/_api/graphql",
		strings.NewReader(`{"query":"{__typename}"}`),
	)
	req2.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(clearance) != "" {
		req2.Header.Set("Cookie", "cf_clearance="+strings.TrimSpace(clearance))
	}
	if strings.TrimSpace(userAgent) != "" {
		req2.Header.Set("User-Agent", strings.TrimSpace(userAgent))
	}
	resp2, err := httpClient.Do(req2)
	var resp2Body []byte
	if resp2 != nil {
		resp2Body, _ = io.ReadAll(resp2.Body)
		_ = resp2.Body.Close()
	}
	if err != nil || resp2 == nil || isCloudflareChallenge(resp2.StatusCode, resp2Body) || resp2.StatusCode >= 500 {
		step2.Success = false
		if err != nil {
			step2.Message = err.Error()
		} else {
			step2.Message = fmt.Sprintf("status %d", resp2.StatusCode)
		}
		result.Steps = append(result.Steps, step2)
		result.State = StateNeedsBrowserRepair
		result.Reason = StateReason{Code: "browser_session_failed", Message: step2.Message}
		return m.finishConnectionCheck(id, acct, checkedAt, result), nil
	}
	step2.Success = true
	result.Steps = append(result.Steps, step2)

	// 3) Credentials check via balances query
	step3 := ConnectionStep{Name: "credentials"}
	client := stake.NewClient(stake.Config{
		Domain:       acct.Mirror,
		SessionToken: apiKey,
		Currency:     acct.Currency,
		UserAgent:    strings.TrimSpace(userAgent),
		Clearance:    strings.TrimSpace(clearance),
		HTTPClient:   httpClient,
	})
	if _, err := client.GetBalances(m.context()); err != nil {
		step3.Success = false
		step3.Message = err.Error()
		result.Steps = append(result.Steps, step3)
		result.State, result.Reason = stateForStakeError(err)
		return m.finishConnectionCheck(id, acct, checkedAt, result), nil
	}
	step3.Success = true
	result.Steps = append(result.Steps, step3)
	result.OK = true
	result.State = StateConnected
	result.Reason = StateReason{Code: "ok", Message: "Connected"}
	return m.finishConnectionCheck(id, acct, checkedAt, result), nil
}

func (m *Module) Connect(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("account id is required")
	}
	check, err := m.ConnectionCheck(id)
	if err != nil {
		return err
	}
	if !check.OK {
		return fmt.Errorf("connection check failed: %s", check.Reason.Message)
	}
	acct, err := m.store.Get(id)
	if err != nil {
		return err
	}
	apiKey, err := m.keyring.GetAPIKey(id)
	if err != nil {
		return fmt.Errorf("missing api key: %w", err)
	}
	clearance, _ := m.keyring.GetClearance(id)
	userAgent, _ := m.keyring.GetUserAgent(id)

	client := stake.NewClient(stake.Config{
		Domain:       acct.Mirror,
		SessionToken: apiKey,
		Currency:     acct.Currency,
		UserAgent:    strings.TrimSpace(userAgent),
		Clearance:    strings.TrimSpace(clearance),
	})
	balances, err := client.GetBalances(m.context())
	if err != nil {
		state, reason := stateForStakeError(err)
		m.mu.Lock()
		m.active = nil
		m.activeID = ""
		m.activeState = ActiveStatus{
			Connected: false,
			State:     state,
			Reason:    reason,
			Error:     err.Error(),
		}
		m.mu.Unlock()
		return err
	}

	viewBalances := make([]SessionBalance, 0, len(balances))
	for _, b := range balances {
		avail, _ := b.Available.Amount.Float64()
		vault, _ := b.Vault.Amount.Float64()
		viewBalances = append(viewBalances, SessionBalance{
			Currency:  b.Available.Currency,
			Available: avail,
			Vault:     vault,
		})
	}

	m.mu.Lock()
	m.active = client
	m.activeID = id
	m.activeState = ActiveStatus{
		Connected:   true,
		State:       StateConnected,
		Reason:      StateReason{Code: "ok", Message: "Connected"},
		LastCheckAt: acct.LastCheckAt,
		AccountID:   id,
		Account:     acct,
		Balances:    viewBalances,
	}
	m.mu.Unlock()

	return nil
}

func (m *Module) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active = nil
	m.activeID = ""
	m.activeState = ActiveStatus{Connected: false, State: StateDisconnected}
}

func (m *Module) GetActiveStatus() ActiveStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeState
}

// Client returns active stake client for internal consumers (e.g. scripting).
func (m *Module) Client() *stake.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.active
}

func (m *Module) IsConnected() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.active != nil && m.activeState.Connected && m.activeState.State == StateConnected
}

func (m *Module) ActiveConnectionState() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if strings.TrimSpace(m.activeState.State) == "" {
		return StateDisconnected
	}
	return m.activeState.State
}

func (m *Module) ActiveAccountID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeID
}

func (m *Module) OpenCasinoInBrowser(id string) error {
	acct, err := m.store.Get(strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if m.app == nil {
		return fmt.Errorf("wails application not initialized")
	}
	url := strings.TrimSpace(acct.Mirror)
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "https://" + url
	}
	windowName := "stake-session-" + safeWindowName(acct.ProfileID)
	if existing, ok := m.app.Window.GetByName(windowName); ok {
		existing.SetURL(url)
		existing.Show()
		existing.Focus()
		return nil
	}
	m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       windowName,
		Title:                      "Stake Session - " + displayAccountLabel(acct),
		URL:                        url,
		Width:                      1180,
		Height:                     820,
		MinWidth:                   960,
		MinHeight:                  700,
		BackgroundColour:           application.NewRGBA(10, 10, 10, 255),
		Zoom:                       1.0,
		ZoomControlEnabled:         false,
		EnableFileDrop:             false,
		DefaultContextMenuDisabled: false,
		UseApplicationMenu:         true,
		Windows: application.WindowsWindow{
			BackdropType: application.Mica,
			Theme:        application.SystemDefault,
		},
	})
	return nil
}

func (m *Module) RepairSession(id string) error {
	if err := m.OpenCasinoInBrowser(id); err != nil {
		return err
	}
	acct, err := m.store.Get(strings.TrimSpace(id))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_ = m.store.UpdateConnectionState(acct.ID, StateNeedsBrowserRepair, now)
	acct.ConnectionState = StateNeedsBrowserRepair
	acct.LastCheckAt = now.Format(time.RFC3339)
	m.setActiveState(ActiveStatus{
		Connected:   false,
		State:       StateNeedsBrowserRepair,
		Reason:      StateReason{Code: "repair_opened", Message: "Complete login or Cloudflare checks in the browser, then test the connection again."},
		LastCheckAt: acct.LastCheckAt,
		AccountID:   acct.ID,
		Account:     acct,
	})
	return nil
}

func (m *Module) finishConnectionCheck(id string, acct *Account, checkedAt time.Time, result ConnectionCheckResult) ConnectionCheckResult {
	if result.State == "" {
		result.State = StateDisconnected
	}
	result.LastCheckAt = checkedAt.Format(time.RFC3339)
	_ = m.store.UpdateConnectionState(id, result.State, checkedAt)
	if acct != nil {
		acct.ConnectionState = result.State
		acct.LastCheckAt = result.LastCheckAt
	}
	m.setActiveState(ActiveStatus{
		Connected:   result.OK,
		State:       result.State,
		Reason:      result.Reason,
		LastCheckAt: result.LastCheckAt,
		AccountID:   id,
		Account:     acct,
		Error:       result.Reason.Message,
	})
	return result
}

func (m *Module) setActiveState(status ActiveStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.activeState = status
	if !status.Connected {
		m.active = nil
		m.activeID = ""
	}
}

func isCloudflareChallenge(status int, body []byte) bool {
	if status != http.StatusForbidden && status != http.StatusServiceUnavailable {
		return false
	}
	trimmed := strings.TrimSpace(string(body))
	return strings.HasPrefix(trimmed, "<!DOCTYPE html") ||
		strings.HasPrefix(trimmed, "<html") ||
		strings.HasPrefix(trimmed, "<")
}

func stateForStakeError(err error) (string, StateReason) {
	var authErr *stake.AuthError
	if errors.As(err, &authErr) {
		return StateCredentialFailed, StateReason{Code: "credential_failed", Message: authErr.Error()}
	}
	var cfErr *stake.CloudflareError
	if errors.As(err, &cfErr) {
		return StateNeedsBrowserRepair, StateReason{Code: "browser_session_failed", Message: cfErr.Error()}
	}
	return StateNeedsLogin, StateReason{Code: "connection_failed", Message: err.Error()}
}

func safeWindowName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "default"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return b.String()
}

func displayAccountLabel(acct *Account) string {
	if acct == nil {
		return "Account"
	}
	if label := strings.TrimSpace(acct.Label); label != "" {
		return label
	}
	if mirror := strings.TrimSpace(acct.Mirror); mirror != "" {
		return mirror
	}
	return "Account"
}
