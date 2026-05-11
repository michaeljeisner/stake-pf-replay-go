package stakeauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func testModule(t *testing.T) *Module {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	if err := store.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	keyringStore := NewKeyringStore("wen-desktop-test-module", filepath.Join(t.TempDir(), "fallback.json"))
	mod := NewModule(store, keyringStore)
	mod.Startup(context.Background())
	return mod
}

func TestModuleConnectionCheckAndConnect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.WriteHeader(200)
			_, _ = w.Write([]byte("ok"))
			return
		case "/_api/graphql":
			// Step 3 checks x-access-token and should hit this path.
			if r.Header.Get("x-access-token") != "" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"data": map[string]any{
						"user": map[string]any{
							"balances": []map[string]any{
								{
									"available": map[string]any{"amount": "1.23", "currency": "btc"},
									"vault":     map[string]any{"amount": "0", "currency": "btc"},
								},
							},
						},
					},
				})
				return
			}

			// Step 2 CF check.
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"__typename": "Query",
				},
			})
			return
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	mod := testModule(t)
	acct, err := mod.SaveAccount(Account{
		Label:    "Primary",
		Mirror:   server.URL,
		Currency: "btc",
	})
	if err != nil {
		t.Fatalf("save account: %v", err)
	}
	if err := mod.SetSecrets(acct.ID, "api-key", "cf-token", "UA"); err != nil {
		t.Fatalf("set secrets: %v", err)
	}

	check, err := mod.ConnectionCheck(acct.ID)
	if err != nil {
		t.Fatalf("connection check err: %v", err)
	}
	if !check.OK {
		t.Fatalf("expected check OK, got %#v", check)
	}
	if got := check.State; got != StateConnected {
		t.Fatalf("expected check state %q, got %q", StateConnected, got)
	}

	if err := mod.Connect(acct.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	status := mod.GetActiveStatus()
	if !status.Connected {
		t.Fatalf("expected connected status, got %#v", status)
	}
	if status.State != StateConnected {
		t.Fatalf("expected active state %q, got %q", StateConnected, status.State)
	}
	if mod.Client() == nil || !mod.IsConnected() {
		t.Fatal("expected active client")
	}
}

func TestModuleConnectionCheckCloudflareFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.WriteHeader(200)
			return
		case "/_api/graphql":
			w.WriteHeader(503)
			_, _ = w.Write([]byte("<html>cf challenge</html>"))
			return
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	mod := testModule(t)
	acct, err := mod.SaveAccount(Account{
		Label:    "Blocked",
		Mirror:   server.URL,
		Currency: "btc",
	})
	if err != nil {
		t.Fatalf("save account: %v", err)
	}
	if err := mod.SetSecrets(acct.ID, "api-key", "", ""); err != nil {
		t.Fatalf("set secrets: %v", err)
	}

	check, err := mod.ConnectionCheck(acct.ID)
	if err != nil {
		t.Fatalf("connection check err: %v", err)
	}
	if check.OK {
		t.Fatalf("expected failed check, got %#v", check)
	}
	if len(check.Steps) < 2 || check.Steps[1].Success {
		t.Fatalf("expected cloudflare step failure, got %#v", check.Steps)
	}
	if check.Steps[1].Name != "browser_session" {
		t.Fatalf("expected browser_session step, got %#v", check.Steps[1])
	}
	if check.State != StateNeedsBrowserRepair {
		t.Fatalf("expected state %q, got %q", StateNeedsBrowserRepair, check.State)
	}
	status := mod.GetActiveStatus()
	if status.State != StateNeedsBrowserRepair {
		t.Fatalf("expected active status state %q, got %#v", StateNeedsBrowserRepair, status)
	}
}

func TestModuleConnectionCheckCredentialFail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.WriteHeader(200)
			return
		case "/_api/graphql":
			if r.Header.Get("x-access-token") != "" {
				w.WriteHeader(401)
				_, _ = w.Write([]byte("unauthorized"))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"__typename": "Query"}})
			return
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()

	mod := testModule(t)
	acct, err := mod.SaveAccount(Account{Label: "Bad key", Mirror: server.URL, Currency: "btc"})
	if err != nil {
		t.Fatalf("save account: %v", err)
	}
	if err := mod.SetSecrets(acct.ID, "bad-api-key", "", ""); err != nil {
		t.Fatalf("set secrets: %v", err)
	}

	check, err := mod.ConnectionCheck(acct.ID)
	if err != nil {
		t.Fatalf("connection check err: %v", err)
	}
	if check.OK {
		t.Fatalf("expected failed check, got %#v", check)
	}
	if check.State != StateCredentialFailed {
		t.Fatalf("expected state %q, got %q", StateCredentialFailed, check.State)
	}
}
