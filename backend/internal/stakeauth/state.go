package stakeauth

const (
	StateNotConfigured      = "not_configured"
	StateNeedsLogin         = "needs_login"
	StateChecking           = "checking"
	StateConnected          = "connected"
	StateNeedsBrowserRepair = "needs_browser_repair"
	StateCredentialFailed   = "credential_failed"
	StateDisconnected       = "disconnected"
)

// StateReason gives the frontend a stable machine-readable reason plus a
// user-facing message for the current account/session state.
type StateReason struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}
