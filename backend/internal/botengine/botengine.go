// Package botengine is the roadmap-facing strategy runtime boundary.
//
// The current implementation reuses the internal scripting engine, which
// compiles scripts once, executes callbacks repeatedly, restricts host globals,
// and enforces backend safety limits. This facade gives betting/productization
// code a stable module name without creating a second runtime.
package botengine

import "github.com/MJE43/stake-pf-replay-go/internal/scripting"

type (
	BalanceSyncer    = scripting.BalanceSyncer
	BetPlacer        = scripting.BetPlacer
	BetRecorder      = scripting.BetRecorder
	BetResult        = scripting.BetResult
	ChartPoint       = scripting.ChartPoint
	Engine           = scripting.Engine
	EngineSnapshot   = scripting.EngineSnapshot
	EventEmitter     = scripting.EventEmitter
	LogEntry         = scripting.LogEntry
	MultiRoundPlacer = scripting.MultiRoundPlacer
	SafetyLimits     = scripting.SafetyLimits
	State            = scripting.State
	Statistics       = scripting.Statistics
	Variables        = scripting.Variables
)

const (
	StateIdle    = scripting.StateIdle
	StateRunning = scripting.StateRunning
	StateStopped = scripting.StateStopped
	StateError   = scripting.StateError
)

func NewEngine(placer BetPlacer, emitter EventEmitter) *Engine {
	return scripting.NewEngine(placer, emitter)
}

func DefaultLiveSafetyLimits() SafetyLimits {
	return scripting.DefaultLiveSafetyLimits()
}
