package stake

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func TestNewClient(t *testing.T) {
	c := NewClient(Config{
		SessionToken: "test-token",
		Currency:     "btc",
	})

	if c.Domain() != "stake.com" {
		t.Errorf("default domain: expected stake.com, got %s", c.Domain())
	}
	if c.SessionToken() != "test-token" {
		t.Errorf("token mismatch")
	}
	if c.Currency() != "btc" {
		t.Errorf("currency mismatch")
	}
}

func TestSetSessionToken(t *testing.T) {
	c := NewClient(Config{SessionToken: "old"})
	c.SetSessionToken("new")

	if c.SessionToken() != "new" {
		t.Errorf("expected 'new', got %s", c.SessionToken())
	}
}

func TestSetCurrency(t *testing.T) {
	c := NewClient(Config{Currency: "btc"})
	c.SetCurrency("eth")

	if c.Currency() != "eth" {
		t.Errorf("expected 'eth', got %s", c.Currency())
	}
}

func TestGetBalances(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("x-access-token") != "test-token" {
			t.Errorf("missing or wrong x-access-token header")
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("missing Content-Type header")
		}

		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"user": map[string]any{
					"balances": []map[string]any{
						{
							"available": map[string]any{"amount": 1.23456789, "currency": "btc"},
							"vault":     map[string]any{"amount": 5.0, "currency": "btc"},
						},
						{
							"available": map[string]any{"amount": 100.5, "currency": "eth"},
							"vault":     map[string]any{"amount": 0.0, "currency": "eth"},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		HTTPClient:   server.Client(),
	})
	// Override domain to use HTTP (test server uses TLS)
	c.config.Domain = server.Listener.Addr().String()

	// Use the TLS test client
	ctx := context.Background()
	balances, err := c.GetBalances(ctx)
	if err != nil {
		t.Fatalf("GetBalances failed: %v", err)
	}

	if len(balances) != 2 {
		t.Fatalf("expected 2 balances, got %d", len(balances))
	}
	if balances[0].Available.Currency != "btc" {
		t.Errorf("first balance currency: expected btc, got %s", balances[0].Available.Currency)
	}
	if !balances[0].Available.Amount.Equal(decimal.RequireFromString("1.23456789")) {
		t.Errorf("first balance amount mismatch: got %s", balances[0].Available.Amount.String())
	}
}

func TestHTTP403IsNotRetried(t *testing.T) {
	attempts := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(403)
		w.Write([]byte("forbidden"))
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:         server.Listener.Addr().String(),
		SessionToken:   "test-token",
		HTTPClient:     server.Client(),
		MaxRetries:     3,
		BaseRetryDelay: 10 * time.Millisecond,
		MaxRetryDelay:  50 * time.Millisecond,
	})

	ctx := context.Background()
	_, err := c.GetBalances(ctx)
	if err == nil {
		t.Fatal("expected HTTP 403 error")
	}
	if attempts != 1 {
		t.Errorf("expected 1 attempt, got %d", attempts)
	}
}

func TestRetryOnHTTP500(t *testing.T) {
	attempts := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts <= 2 {
			w.WriteHeader(500)
			w.Write([]byte("server error"))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"user": map[string]any{
					"balances": []map[string]any{},
				},
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:         server.Listener.Addr().String(),
		SessionToken:   "test-token",
		HTTPClient:     server.Client(),
		MaxRetries:     3,
		BaseRetryDelay: 10 * time.Millisecond,
		MaxRetryDelay:  50 * time.Millisecond,
	})

	ctx := context.Background()
	_, err := c.GetBalances(ctx)
	if err != nil {
		t.Fatalf("expected success after retries, got: %v", err)
	}
	if attempts != 3 {
		t.Errorf("expected 3 attempts, got %d", attempts)
	}
}

func TestAuthError(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte("unauthorized"))
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "expired-token",
		HTTPClient:   server.Client(),
	})

	ctx := context.Background()
	_, err := c.GetBalances(ctx)
	if err == nil {
		t.Fatal("expected auth error, got nil")
	}

	authErr, ok := err.(*AuthError)
	if !ok {
		t.Fatalf("expected *AuthError, got %T: %v", err, err)
	}
	if authErr.StatusCode != 401 {
		t.Errorf("expected status 401, got %d", authErr.StatusCode)
	}
}

func TestStakeAPIError(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"errors": []map[string]any{
				{
					"errorType": "insufficientBalance",
					"message":   "Not enough funds",
				},
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		HTTPClient:   server.Client(),
	})

	ctx := context.Background()
	_, err := c.GetBalances(ctx)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	stakeErr, ok := err.(*StakeError)
	if !ok {
		t.Fatalf("expected *StakeError, got %T: %v", err, err)
	}
	if !stakeErr.IsInsufficientBalance() {
		t.Errorf("expected insufficient balance error, got: %s", stakeErr.ErrorType)
	}
	if stakeErr.IsFatal() != true {
		t.Error("insufficient balance should be fatal")
	}
}

func TestDiceBet(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)

		// Verify request fields
		if body["currency"] != "btc" {
			t.Errorf("expected currency btc, got %v", body["currency"])
		}
		if body["identifier"] == nil || len(body["identifier"].(string)) != 21 {
			t.Error("expected 21-char identifier")
		}

		json.NewEncoder(w).Encode(map[string]any{
			"diceRoll": map[string]any{
				"id":               "bet123",
				"active":           false,
				"amount":           0.001,
				"currency":         "btc",
				"payout":           0.002,
				"payoutMultiplier": 2.0,
				"nonce":            42,
				"state": map[string]any{
					"result": 75.5,
					"target": 50.0,
				},
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	})

	ctx := context.Background()
	result, err := c.DiceBet(ctx, DiceBetRequest{
		Target:    50.0,
		Condition: "above",
		Amount:    0.001,
	})
	if err != nil {
		t.Fatalf("DiceBet failed: %v", err)
	}

	if result.ID != "bet123" {
		t.Errorf("expected ID bet123, got %s", result.ID)
	}
	if result.PayoutMultiplier != 2.0 {
		t.Errorf("expected payoutMultiplier 2.0, got %f", result.PayoutMultiplier)
	}
	if !result.IsWin() {
		t.Error("expected win (payoutMultiplier >= 1.0)")
	}
	if !result.Profit().Equal(decimal.RequireFromString("0.001")) {
		t.Errorf("expected profit 0.001, got %s", result.Profit().String())
	}
}

func TestExtractGameDataMissingKeyErrors(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"wrongKey": map[string]any{
				"id": "bet123",
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	})

	ctx := context.Background()
	_, err := c.DiceBet(ctx, DiceBetRequest{
		Target:    50.0,
		Condition: "above",
		Amount:    0.001,
	})
	if err == nil {
		t.Fatal("expected error when expected game key is missing")
	}
}

func TestErrorTypes(t *testing.T) {
	tests := []struct {
		errorType string
		check     func(*StakeError) bool
		name      string
	}{
		{ErrTypeParallelBet, (*StakeError).IsParallelBet, "parallel bet"},
		{ErrTypeExistingGame, (*StakeError).IsExistingGame, "existing game"},
		{ErrTypeNotFound, (*StakeError).IsNotFound, "not found"},
		{ErrTypeInsignificantBet, (*StakeError).IsInsignificantBet, "insignificant bet"},
		{ErrTypeInsufficientBalance, (*StakeError).IsInsufficientBalance, "insufficient balance"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := &StakeError{ErrorType: tt.errorType, Message: "test"}
			if !tt.check(err) {
				t.Errorf("expected %s check to return true", tt.name)
			}
		})
	}
}

func TestDiceBetValidation(t *testing.T) {
	c := NewClient(Config{SessionToken: "test-token", Currency: "btc"})
	ctx := context.Background()

	_, err := c.DiceBet(ctx, DiceBetRequest{Target: 50, Condition: "sideways", Amount: 0.001})
	if err == nil {
		t.Fatal("expected invalid condition error")
	}

	_, err = c.DiceBet(ctx, DiceBetRequest{Target: 101, Condition: "above", Amount: 0.001})
	if err == nil {
		t.Fatal("expected invalid target error")
	}

	_, err = c.DiceBet(ctx, DiceBetRequest{Target: 50, Condition: "above", Amount: 0})
	if err == nil {
		t.Fatal("expected invalid amount error")
	}
}

func TestMinesBetOmitsFieldsWhenEmpty(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["fields"]; ok {
			t.Fatal("fields should be omitted when empty")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"minesBet": map[string]any{
				"id":               "bet1",
				"active":           true,
				"amount":           0.001,
				"currency":         "btc",
				"payout":           0.001,
				"payoutMultiplier": 1.0,
				"nonce":            1,
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	})

	_, err := c.MinesBet(context.Background(), MinesBetRequest{
		Amount:     0.001,
		MinesCount: 3,
	})
	if err != nil {
		t.Fatalf("MinesBet failed: %v", err)
	}
}

func TestHiLoAndBlackjackValidation(t *testing.T) {
	c := NewClient(Config{SessionToken: "test-token", Currency: "btc"})
	ctx := context.Background()

	_, err := c.HiLoNext(ctx, "moon")
	if err == nil {
		t.Fatal("expected invalid hilo guess error")
	}

	_, err = c.BlackjackNext(ctx, "fold")
	if err == nil {
		t.Fatal("expected invalid blackjack action error")
	}

	_, err = c.GetActiveBet(ctx, "roulette")
	if err == nil {
		t.Fatal("expected invalid active-bet game error")
	}
}

func TestRequestIncludesClearanceCookie(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Cookie"); got != "cf_clearance=cf-token" {
			t.Fatalf("expected cf_clearance cookie header, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"user": map[string]any{
					"balances": []map[string]any{},
				},
			},
		})
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		Clearance:    "cf-token",
		HTTPClient:   server.Client(),
	})

	_, err := c.GetBalances(context.Background())
	if err != nil {
		t.Fatalf("GetBalances failed: %v", err)
	}
}

func TestCloudflareHTMLResponseReturnsCloudflareError(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		_, _ = w.Write([]byte("<html><body>cloudflare challenge</body></html>"))
	}))
	defer server.Close()

	c := NewClient(Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "test-token",
		HTTPClient:   server.Client(),
	})

	_, err := c.GetBalances(context.Background())
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if _, ok := err.(*CloudflareError); !ok {
		t.Fatalf("expected *CloudflareError, got %T: %v", err, err)
	}
}
