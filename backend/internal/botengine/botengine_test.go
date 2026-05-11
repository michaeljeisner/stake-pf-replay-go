package botengine

import (
	"context"
	"testing"
)

type testPlacer struct{}

func (testPlacer) PlaceBet(context.Context, *Variables) (*BetResult, error) {
	return &BetResult{Win: true, Amount: 0.001, Payout: 0.002, PayoutMulti: 2}, nil
}

type testEmitter struct{}

func (testEmitter) EmitScriptState(EngineSnapshot) {}
func (testEmitter) EmitScriptLog([]LogEntry)       {}

func TestBotEngineFacadeCreatesSafeEngine(t *testing.T) {
	eng := NewEngine(testPlacer{}, testEmitter{})
	if eng == nil {
		t.Fatal("NewEngine returned nil")
	}
	if err := eng.SetSafetyLimits(DefaultLiveSafetyLimits()); err != nil {
		t.Fatalf("SetSafetyLimits: %v", err)
	}
	if got := eng.GetState().State; got != StateIdle {
		t.Fatalf("initial state = %q, want %q", got, StateIdle)
	}
}
