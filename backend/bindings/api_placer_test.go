package bindings

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MJE43/stake-pf-replay-go/internal/scripting"
	"github.com/MJE43/stake-pf-replay-go/internal/stake"
)

func TestApiBetPlacerRestrictsLiveGamesToDiceAndLimbo(t *testing.T) {
	placer := NewApiBetPlacer(stake.NewClient(stake.Config{SessionToken: "token", Currency: "btc"}))

	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:    "mines",
		NextBet: 0.001,
	})
	if err == nil {
		t.Fatal("expected unsupported live game error")
	}
	want := `unsupported live game "mines"; live mode currently supports dice and limbo`
	if err.Error() != want {
		t.Fatalf("expected %q, got %q", want, err.Error())
	}
}

func TestApiBetPlacerDiceHighUsesComplementTarget(t *testing.T) {
	var captured map[string]any
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_api/casino/dice/roll" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"diceRoll": map[string]any{
				"id":               "bet123",
				"active":           false,
				"amount":           0.001,
				"currency":         "btc",
				"payout":           0,
				"payoutMultiplier": 0,
				"nonce":            1,
				"state": map[string]any{
					"result": 25,
					"target": 51.5,
				},
			},
		})
	}))
	defer server.Close()

	client := stake.NewClient(stake.Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "token",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	})
	placer := NewApiBetPlacer(client)

	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:    "dice",
		NextBet: 0.001,
		Chance:  48.5,
		BetHigh: true,
	})
	if err != nil {
		t.Fatalf("place bet: %v", err)
	}
	if captured["condition"] != "above" {
		t.Fatalf("expected above condition, got %#v", captured["condition"])
	}
	if captured["target"] != 51.5 {
		t.Fatalf("expected target 51.5, got %#v", captured["target"])
	}
}
