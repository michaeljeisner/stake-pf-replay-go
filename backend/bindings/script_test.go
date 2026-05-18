package bindings

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MJE43/stake-pf-replay-go/internal/scripting"
	"github.com/MJE43/stake-pf-replay-go/internal/stake"
)

type testSessionProvider struct {
	client *stake.Client
}

func (s testSessionProvider) Client() *stake.Client {
	return s.client
}

func (testSessionProvider) IsConnected() bool {
	return true
}

func (testSessionProvider) ActiveConnectionState() string {
	return "connected"
}

func (testSessionProvider) ActiveAccountID() string {
	return "acct-1"
}

func TestStartScriptLiveBlocksWhenActiveStateGameExists(t *testing.T) {
	var checked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/_api/casino/active-bet/") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		game := strings.TrimPrefix(r.URL.Path, "/_api/casino/active-bet/")
		checked = append(checked, game)
		w.Header().Set("Content-Type", "application/json")
		if game == "hilo" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{
					"activeCasinoBet": map[string]any{
						"id":               "active-hilo-1",
						"active":           true,
						"amount":           "0.001",
						"currency":         "btc",
						"payout":           "0",
						"payoutMultiplier": 0,
						"nonce":            42,
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"activeCasinoBet": nil}})
	}))
	defer server.Close()

	client := stake.NewClient(stake.Config{
		Domain:       server.URL,
		SessionToken: "token",
		Currency:     "btc",
	})
	sm := NewScriptModule(testSessionProvider{client: client})
	sm.Startup(context.Background())

	err := sm.StartScriptWithSafety(
		"dobet = function() { stop() }",
		"dice",
		"btc",
		1,
		"live",
		scripting.SafetyLimits{MaxBets: 1, MaxBetAmount: 0.001},
	)
	if err == nil {
		t.Fatal("expected active-state recovery error")
	}
	if !strings.Contains(err.Error(), "active hilo bet active-hilo-1") {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(checked) != 1 || checked[0] != "hilo" {
		t.Fatalf("checked games = %#v, want only hilo before blocking", checked)
	}
	if state := sm.GetScriptState(); state.State != string(scripting.StateIdle) {
		t.Fatalf("engine state = %q, want idle", state.State)
	}
}

func TestStartScriptLiveFailsClosedWhenRecoveryCheckErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("<html>challenge</html>"))
	}))
	defer server.Close()

	client := stake.NewClient(stake.Config{
		Domain:       server.URL,
		SessionToken: "token",
		Currency:     "btc",
		MaxRetries:   0,
	})
	sm := NewScriptModule(testSessionProvider{client: client})
	sm.Startup(context.Background())

	err := sm.StartScriptWithSafety(
		"dobet = function() { stop() }",
		"dice",
		"btc",
		1,
		"live",
		scripting.SafetyLimits{MaxBets: 1, MaxBetAmount: 0.001},
	)
	if err == nil {
		t.Fatal("expected recovery check error")
	}
	if !strings.Contains(err.Error(), "startup recovery failed for hilo") {
		t.Fatalf("unexpected error: %v", err)
	}
}
