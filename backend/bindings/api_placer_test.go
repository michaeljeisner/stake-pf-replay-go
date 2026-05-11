package bindings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

type recordingSink struct {
	events []AppBetEvent
}

func (s *recordingSink) InsertAppBet(ctx context.Context, event AppBetEvent) error {
	s.events = append(s.events, event)
	return nil
}

func TestApiBetPlacerRecordsSuccessfulDiceBet(t *testing.T) {
	sink := &recordingSink{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"diceRoll": map[string]any{
				"id":               "bet123",
				"active":           false,
				"amount":           0.001,
				"currency":         "btc",
				"payout":           0.002,
				"payoutMultiplier": 2,
				"nonce":            1,
				"state": map[string]any{
					"result": 75,
					"target": 51.5,
				},
			},
		})
	}))
	defer server.Close()

	placer := NewApiBetPlacerWithConfig(stake.NewClient(stake.Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "token",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	}), ApiBetPlacerConfig{
		AccountID:       "acct-1",
		ScriptSessionID: "session-1",
		Sink:            sink,
	})

	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:     "dice",
		Currency: "btc",
		NextBet:  0.001,
		Chance:   48.5,
		BetHigh:  true,
	})
	if err != nil {
		t.Fatalf("place bet: %v", err)
	}
	if len(sink.events) != 1 {
		t.Fatalf("expected 1 ledger event, got %d", len(sink.events))
	}
	got := sink.events[0]
	if got.AccountID != "acct-1" || got.ScriptSessionID != "session-1" || got.Game != "dice" {
		t.Fatalf("unexpected ledger identity: %#v", got)
	}
	if got.Condition != "above" || got.Target != 51.5 || got.StakeResponseID != "bet123" {
		t.Fatalf("unexpected dice ledger fields: %#v", got)
	}
	if got.Payout != 0.002 || got.Profit != 0.001 || got.ErrorKind != "" {
		t.Fatalf("unexpected ledger outcome: %#v", got)
	}
}

func TestApiBetPlacerRecordsAuthFailureAndReturnsKind(t *testing.T) {
	sink := &recordingSink{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("unauthorized"))
	}))
	defer server.Close()

	placer := NewApiBetPlacerWithConfig(stake.NewClient(stake.Config{
		Domain:       server.Listener.Addr().String(),
		SessionToken: "bad",
		Currency:     "btc",
		HTTPClient:   server.Client(),
	}), ApiBetPlacerConfig{
		AccountID:       "acct-1",
		ScriptSessionID: "session-1",
		Sink:            sink,
	})

	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{
		Game:     "dice",
		Currency: "btc",
		NextBet:  0.001,
		Chance:   49.5,
	})
	if err == nil {
		t.Fatal("expected auth error")
	}
	var liveErr *LiveBetError
	if !errors.As(err, &liveErr) {
		t.Fatalf("expected LiveBetError, got %T %v", err, err)
	}
	if liveErr.Kind != stake.ErrorKindAuth {
		t.Fatalf("expected auth kind, got %q", liveErr.Kind)
	}
	if len(sink.events) != 1 || sink.events[0].ErrorKind != string(stake.ErrorKindAuth) {
		t.Fatalf("expected auth ledger event, got %#v", sink.events)
	}
}

func TestSafetyBetPlacerStopsOnLimits(t *testing.T) {
	inner := &sequencePlacer{
		results: []*scripting.BetResult{
			{Amount: 0.6, Payout: 0, Win: false},
			{Amount: 0.6, Payout: 0, Win: false},
		},
	}
	placer := NewSafetyBetPlacer(inner, LiveScriptOptions{MaxTotalWager: 1, MaxLoss: 2, MaxBets: 3, MaxRuntimeSeconds: 60, StopOnSessionError: true}, time.Now())

	if _, err := placer.PlaceBet(context.Background(), &scripting.Variables{NextBet: 0.6}); err != nil {
		t.Fatalf("first bet should pass: %v", err)
	}
	_, err := placer.PlaceBet(context.Background(), &scripting.Variables{NextBet: 0.6})
	if err == nil {
		t.Fatal("expected safety stop")
	}
	var safetyErr *SafetyStopError
	if !errors.As(err, &safetyErr) {
		t.Fatalf("expected SafetyStopError, got %T %v", err, err)
	}
}

type sequencePlacer struct {
	results []*scripting.BetResult
	err     error
}

func (p *sequencePlacer) PlaceBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	if p.err != nil {
		return nil, p.err
	}
	if len(p.results) == 0 {
		return &scripting.BetResult{Amount: vars.NextBet}, nil
	}
	next := p.results[0]
	p.results = p.results[1:]
	return next, nil
}
