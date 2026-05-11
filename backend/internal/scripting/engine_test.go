package scripting

import (
	"context"
	"testing"
	"time"
)

// testBetPlacer simulates dice bets for testing.
// Alternates between wins and losses for predictable behavior.
type testBetPlacer struct {
	callCount int
}

func (p *testBetPlacer) PlaceBet(ctx context.Context, vars *Variables) (*BetResult, error) {
	p.callCount++
	// Win every 3rd bet
	win := p.callCount%3 == 0
	multi := 0.0
	payout := 0.0
	if win {
		multi = 2.0
		payout = vars.NextBet * multi
	}
	return &BetResult{
		Amount:      vars.NextBet,
		Payout:      payout,
		PayoutMulti: multi,
		Win:         win,
		Roll:        float64(p.callCount),
		Chance:      49.5,
		Target:      50.0,
	}, nil
}

type noopEmitter struct{}

func (e *noopEmitter) EmitScriptState(state EngineSnapshot) {}
func (e *noopEmitter) EmitScriptLog(entries []LogEntry)     {}

func TestEngineStartStop(t *testing.T) {
	placer := &testBetPlacer{}
	eng := NewEngine(placer, &noopEmitter{})

	script := `
		chance = 49.5
		basebet = 0.001
		nextbet = basebet

		dobet = function() {
			if (win) {
				nextbet = basebet
			} else {
				nextbet = previousbet * 2
			}
		}
	`

	if err := eng.Start(script, 1.0); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	snap := eng.GetState()
	if snap.State != StateRunning {
		t.Errorf("expected running, got %s", snap.State)
	}

	// Let it run for a bit
	time.Sleep(200 * time.Millisecond)

	if err := eng.Stop(); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	snap = eng.GetState()
	if snap.State != StateStopped {
		t.Errorf("expected stopped, got %s", snap.State)
	}

	if snap.Stats == nil {
		t.Fatal("stats should not be nil")
	}
	if snap.Stats.Bets == 0 {
		t.Error("expected some bets to have been placed")
	}
	t.Logf("Engine placed %d bets (%.1f bps)", snap.Stats.Bets, snap.BetsPerSecond)
}

func TestEngineMartingale100Bets(t *testing.T) {
	placer := &testBetPlacer{}
	eng := NewEngine(placer, &noopEmitter{})

	// Script that stops after 100 bets
	script := `
		chance = 49.5
		basebet = 0.001
		nextbet = basebet

		dobet = function() {
			if (bets >= 100) {
				stop()
				return
			}
			if (win) {
				nextbet = basebet
			} else {
				nextbet = previousbet * 2
			}
		}
	`

	if err := eng.Start(script, 1.0); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Wait for it to complete (stop after 100 bets)
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			eng.Stop()
			t.Fatal("engine did not stop within timeout")
		default:
		}
		snap := eng.GetState()
		if snap.State != StateRunning {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	snap := eng.GetState()
	if snap.State != StateStopped && snap.State != StateError {
		t.Errorf("expected stopped or error, got %s", snap.State)
	}
	if snap.Stats.Bets < 100 {
		t.Errorf("expected at least 100 bets, got %d", snap.Stats.Bets)
	}
	if snap.Stats.Wins == 0 {
		t.Error("expected some wins")
	}
	if snap.Stats.Losses == 0 {
		t.Error("expected some losses")
	}

	t.Logf("Martingale 100 bets: W=%d L=%d Profit=%.8f Balance=%.8f",
		snap.Stats.Wins, snap.Stats.Losses, snap.Stats.Profit, snap.Stats.Balance)
}

func TestEngineNoDobetErrors(t *testing.T) {
	eng := NewEngine(&testBetPlacer{}, &noopEmitter{})

	// Script without dobet()
	err := eng.Start("var x = 1;", 1.0)
	if err == nil {
		t.Fatal("expected error for missing dobet()")
	}
}

func TestEngineMultiRoundRequiresRoundCallback(t *testing.T) {
	eng := NewEngine(&testBetPlacer{}, &noopEmitter{})

	err := eng.Start(`
		game = "mines"
		nextbet = 0.001
		dobet = function() {}
	`, 1.0)
	if err == nil {
		t.Fatal("expected missing round() error")
	}
	if err.Error() != "mines scripts must define a round() function" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestEngineChartBuffer(t *testing.T) {
	cb := NewChartBuffer(10)
	for i := 0; i < 25; i++ {
		cb.Push(ChartPoint{BetNumber: i, Profit: float64(i), Win: i%2 == 0})
	}

	// After 25 pushes with max 10, decimation should have kicked in
	if len(cb.Points) > 20 {
		t.Errorf("expected decimation to keep points <= 20, got %d", len(cb.Points))
	}

	// First and last should be preserved
	if cb.Points[0].BetNumber != 0 {
		t.Errorf("first point should be preserved, got %d", cb.Points[0].BetNumber)
	}
	if cb.Points[len(cb.Points)-1].BetNumber != 24 {
		t.Errorf("last point should be preserved, got %d", cb.Points[len(cb.Points)-1].BetNumber)
	}
}

func TestEngineGetLogs(t *testing.T) {
	eng := NewEngine(&testBetPlacer{}, &noopEmitter{})

	script := `
		nextbet = 0.001
		log("hello from script")

		dobet = function() {
			stop()
		}
	`

	if err := eng.Start(script, 1.0); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Wait for it to stop
	time.Sleep(200 * time.Millisecond)

	logs := eng.GetLogs()
	found := false
	for _, l := range logs {
		if l.Message == "hello from script" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected log message 'hello from script' in logs")
	}
}

func TestEngineSafetyStopsAtMaxBets(t *testing.T) {
	eng := NewEngine(&testBetPlacer{}, &noopEmitter{})
	if err := eng.SetSafetyLimits(SafetyLimits{MaxBets: 3}); err != nil {
		t.Fatalf("SetSafetyLimits: %v", err)
	}

	script := `
		nextbet = 0.001
		dobet = function() {
			nextbet = 0.001
		}
	`
	if err := eng.Start(script, 1.0); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	snap := waitForEngineState(t, eng, StateStopped, 2*time.Second)
	if snap.Stats.Bets != 3 {
		t.Fatalf("bets = %d, want 3", snap.Stats.Bets)
	}
}

func TestEngineSafetyErrorsWhenNextBetExceedsMax(t *testing.T) {
	eng := NewEngine(&testBetPlacer{}, &noopEmitter{})
	if err := eng.SetSafetyLimits(SafetyLimits{MaxBetAmount: 0.001}); err != nil {
		t.Fatalf("SetSafetyLimits: %v", err)
	}

	script := `
		nextbet = 0.002
		dobet = function() {}
	`
	if err := eng.Start(script, 1.0); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	snap := waitForEngineState(t, eng, StateError, 2*time.Second)
	if snap.Error == "" {
		t.Fatal("expected safety error message")
	}
}

func waitForEngineState(t *testing.T, eng *Engine, want State, timeout time.Duration) EngineSnapshot {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		snap := eng.GetState()
		if snap.State == want {
			return snap
		}
		time.Sleep(20 * time.Millisecond)
	}
	snap := eng.GetState()
	t.Fatalf("state = %s, want %s; snapshot = %#v", snap.State, want, snap)
	return snap
}
