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

type testLedgerRecorder struct {
	entries []LedgerEntry
	err     error
}

func (r *testLedgerRecorder) RecordLedgerEntry(_ context.Context, entry LedgerEntry) error {
	if r.err != nil {
		return r.err
	}
	r.entries = append(r.entries, entry)
	return nil
}

func TestApiBetPlacerRejectsUnsupportedLiveGames(t *testing.T) {
	placer := NewApiBetPlacer(stake.NewClient(stake.Config{SessionToken: "token", Currency: "btc"}))

	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:    "keno",
		NextBet: 0.001,
	})
	if err == nil {
		t.Fatal("expected unsupported live game error")
	}
	want := `unsupported live game "keno"; live mode currently supports dice, limbo, hilo, mines, and blackjack`
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
	ledger := &testLedgerRecorder{}
	placer := NewApiBetPlacerWithLedger(client, "acct-1", ledger)

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
	if len(ledger.entries) != 1 {
		t.Fatalf("ledger entries = %d, want 1", len(ledger.entries))
	}
	entry := ledger.entries[0]
	if entry.AccountID != "acct-1" || entry.Source != "app" || entry.Game != "dice" {
		t.Fatalf("unexpected ledger entry identity: %#v", entry)
	}
	if entry.ExternalBetID != "bet123" || !strings.HasPrefix(entry.IdempotencyKey, "stake:acct-1:dice:bet123:") {
		t.Fatalf("unexpected ledger keys: %#v", entry)
	}
	if entry.Amount != 0.001 || entry.Payout != 0 || entry.PayoutMultiplier != 0 || entry.Nonce != 1 {
		t.Fatalf("unexpected ledger amounts: %#v", entry)
	}
	if !strings.Contains(entry.RequestJSON, `"condition":"above"`) || !strings.Contains(entry.ResponseJSON, `"id":"bet123"`) {
		t.Fatalf("ledger JSON missing request/response details: %#v", entry)
	}
}

func TestApiBetPlacerMinesInitialBetRecordsLedger(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/_api/casino/mines/bet" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"minesBet": map[string]any{
				"id":               "mines123",
				"active":           true,
				"amount":           0.001,
				"currency":         "btc",
				"payout":           0,
				"payoutMultiplier": 1,
				"nonce":            2,
				"state":            map[string]any{"rounds": []any{}},
			},
		})
	}))
	defer server.Close()

	client := stake.NewClient(stake.Config{
		Domain:       server.URL,
		SessionToken: "token",
		Currency:     "btc",
	})
	ledger := &testLedgerRecorder{}
	placer := NewApiBetPlacerWithLedger(client, "acct-1", ledger)

	result, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:    "mines",
		NextBet: 0.001,
		Mines:   5,
		Fields:  []int{1, 2},
	})
	if err != nil {
		t.Fatalf("place mines: %v", err)
	}
	if result.Amount != 0.001 || result.PayoutMulti != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if captured["minesCount"] != float64(5) {
		t.Fatalf("minesCount = %#v, want 5", captured["minesCount"])
	}
	if len(ledger.entries) != 1 {
		t.Fatalf("ledger entries = %d, want 1", len(ledger.entries))
	}
	if entry := ledger.entries[0]; entry.Game != "mines" || entry.ExternalBetID != "mines123" || !strings.HasPrefix(entry.IdempotencyKey, "stake:acct-1:mines:mines123:") {
		t.Fatalf("unexpected ledger entry: %#v", entry)
	}
}

func TestApiBetPlacerBlackjackValidatesServerActionsAndRecordsNext(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/_api/casino/blackjack/bet":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"blackjackBet": map[string]any{
					"id":               "bj-start",
					"active":           true,
					"amount":           0.001,
					"currency":         "btc",
					"payout":           0,
					"payoutMultiplier": 1,
					"nonce":            3,
					"state":            map[string]any{"actions": []string{"BLACKJACK_HIT", "BLACKJACK_STAND"}},
				},
			})
		case "/_api/casino/blackjack/next":
			var captured map[string]any
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Fatalf("decode next: %v", err)
			}
			if captured["action"] != "hit" {
				t.Fatalf("action = %#v, want hit", captured["action"])
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"blackjackNext": map[string]any{
					"id":               "bj-next",
					"active":           false,
					"amount":           0.001,
					"currency":         "btc",
					"payout":           0.002,
					"payoutMultiplier": 2,
					"nonce":            3,
					"state":            map[string]any{"actions": []string{}},
				},
			})
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := stake.NewClient(stake.Config{
		Domain:       server.URL,
		SessionToken: "token",
		Currency:     "btc",
	})
	ledger := &testLedgerRecorder{}
	placer := NewApiBetPlacerWithLedger(client, "acct-1", ledger)

	if _, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:    "blackjack",
		NextBet: 0.001,
	}); err != nil {
		t.Fatalf("place blackjack: %v", err)
	}
	if _, _, err := placer.PlaceNextAction(context.Background(), "blackjack", "double"); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("expected unavailable action error, got %v", err)
	}
	next, active, err := placer.PlaceNextAction(context.Background(), "blackjack", "hit")
	if err != nil {
		t.Fatalf("blackjack next: %v", err)
	}
	if active {
		t.Fatal("expected inactive blackjack result")
	}
	if next.PayoutMulti != 2 || !next.Win {
		t.Fatalf("unexpected next result: %#v", next)
	}
	if len(paths) != 2 {
		t.Fatalf("paths = %#v, want start and one next", paths)
	}
	if len(ledger.entries) != 2 {
		t.Fatalf("ledger entries = %d, want 2", len(ledger.entries))
	}
	if ledger.entries[1].Game != "blackjack" || ledger.entries[1].ExternalBetID != "bj-next" || !strings.Contains(ledger.entries[1].RequestJSON, `"action":"hit"`) {
		t.Fatalf("unexpected next ledger entry: %#v", ledger.entries[1])
	}
}
