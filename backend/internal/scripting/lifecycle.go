package scripting

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// State represents the scripting engine's lifecycle state.
type State string

const (
	StateIdle    State = "idle"
	StateRunning State = "running"
	StateStopped State = "stopped"
	StateError   State = "error"
)

// BetPlacer is the interface the engine uses to place bets.
// Implementations bridge to the Stake API client.
type BetPlacer interface {
	// PlaceBet places a bet using the current variable state and returns the result.
	PlaceBet(ctx context.Context, vars *Variables) (*BetResult, error)
}

// BalanceSyncer is an optional interface that bet placers can implement
// to support periodic balance re-synchronization with the API.
type BalanceSyncer interface {
	// GetBalance fetches the real account balance for the given currency.
	GetBalance(ctx context.Context, currency string) (float64, error)
}

// MultiRoundPlacer extends BetPlacer with multi-round game support
// (HiLo, Mines, Blackjack). Implementations handle the action loop.
type MultiRoundPlacer interface {
	// PlaceNextAction sends the next action for an active game.
	// action is the user's decision: HiLo guess, Mines field index, Blackjack action.
	PlaceNextAction(ctx context.Context, game string, action interface{}) (*BetResult, bool, error)

	// Cashout cashes out the current active game.
	Cashout(ctx context.Context, game string) (*BetResult, error)
}

// multiRoundGames lists games that require the inner round() loop.
var multiRoundGames = map[string]bool{
	"hilo":      true,
	"mines":     true,
	"blackjack": true,
}

// balanceSyncInterval is the number of bets between periodic balance re-syncs.
// Only applies when the placer implements BalanceSyncer.
const balanceSyncInterval = 50

// EventEmitter allows the engine to push state updates to the frontend.
type EventEmitter interface {
	// EmitScriptState sends the current engine state to the frontend.
	EmitScriptState(state EngineSnapshot)
	// EmitScriptLog sends log entries to the frontend.
	EmitScriptLog(entries []LogEntry)
}

// BetRecorder receives bet results for external persistence (e.g. SQLite).
// Optional — when nil, no recording occurs.
type BetRecorder interface {
	RecordBet(amount, payout, payoutMulti float64, win bool, roll *float64)
	Flush()
}

// EngineSnapshot is a serializable snapshot of the engine state.
type EngineSnapshot struct {
	State         State        `json:"state"`
	Error         string       `json:"error,omitempty"`
	Stats         *Statistics  `json:"stats"`
	Chart         []ChartPoint `json:"chart"`
	CurrentGame   string       `json:"currentGame"`
	CurrentNonce  int          `json:"currentNonce"`
	BetsPerSecond float64      `json:"betsPerSecond"`
}

// Engine is the main scripting engine that orchestrates the bet lifecycle.
type Engine struct {
	mu     sync.RWMutex
	state  State
	err    error
	cancel context.CancelFunc

	vm    *VM
	vars  *Variables
	stats *Statistics
	chart *ChartBuffer

	betPlacer BetPlacer
	emitter   EventEmitter
	recorder  BetRecorder
	safety    SafetyLimits

	startTime time.Time
	lastEmit  time.Time
}

// NewEngine creates a new scripting engine.
func NewEngine(placer BetPlacer, emitter EventEmitter) *Engine {
	return &Engine{
		state:     StateIdle,
		betPlacer: placer,
		emitter:   emitter,
	}
}

// SetRecorder attaches a bet recorder for session persistence.
// Must be called before Start().
func (e *Engine) SetRecorder(rec BetRecorder) {
	e.recorder = rec
}

// SetSafetyLimits attaches hard stop/error rails for this engine run.
func (e *Engine) SetSafetyLimits(limits SafetyLimits) error {
	if err := limits.Validate(); err != nil {
		return err
	}
	e.safety = limits
	return nil
}

// Start begins script execution. The script source is executed once to
// register dobet() (and optionally round()), then the bet loop begins.
func (e *Engine) Start(script string, startBalance float64) error {
	e.mu.Lock()
	if e.state == StateRunning {
		e.mu.Unlock()
		return fmt.Errorf("engine is already running")
	}

	// Initialize fresh state
	e.stats = NewStatistics(startBalance)
	e.chart = NewChartBuffer(500)
	e.vars = NewVariables(e.stats)
	e.vm = NewVM()
	e.state = StateRunning
	e.err = nil
	e.startTime = time.Now()

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()

	// Push initial variables into VM
	e.vm.SetVariables(e.vars)

	// Execute user script to register dobet() and round()
	if err := e.vm.Execute(script); err != nil {
		e.setError(err)
		cancel()
		return err
	}

	// Sync back any variables the script set during initialization
	e.vm.SyncVariables(e.vars)

	// Ensure dobet() is defined
	dobetVal := e.vm.runtime.Get("dobet")
	if dobetVal == nil || isUndefinedOrNull(dobetVal) {
		err := fmt.Errorf("script must define a dobet() function")
		e.setError(err)
		cancel()
		return err
	}
	if multiRoundGames[e.vars.Game] && !e.vm.HasRoundFunc() {
		err := fmt.Errorf("%s scripts must define a round() function", e.vars.Game)
		e.setError(err)
		cancel()
		return err
	}

	// Set running state
	e.vars.Running = true
	e.vm.SetVariables(e.vars)

	// Emit initial state
	e.emitState()

	// Start bet loop in background
	go e.betLoop(ctx)

	return nil
}

// Stop gracefully stops the scripting engine.
func (e *Engine) Stop() error {
	e.mu.Lock()
	if e.state != StateRunning {
		e.mu.Unlock()
		return fmt.Errorf("engine is not running")
	}

	if e.cancel != nil {
		e.cancel()
	}
	e.state = StateStopped
	e.vars.Running = false
	recorder := e.recorder
	e.mu.Unlock()

	// Flush any remaining buffered bets
	if recorder != nil {
		recorder.Flush()
	}

	e.emitState()
	return nil
}

// GetState returns the current engine snapshot.
func (e *Engine) GetState() EngineSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.snapshot()
}

// GetLogs returns the script log buffer.
func (e *Engine) GetLogs() []LogEntry {
	if e.vm == nil {
		return nil
	}
	return e.vm.GetLogs()
}

// betLoop is the main betting loop that runs in a goroutine.
func (e *Engine) betLoop(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			e.setError(fmt.Errorf("script panic: %v", r))
		}
	}()

	for {
		select {
		case <-ctx.Done():
			e.mu.Lock()
			if e.state == StateRunning {
				e.state = StateStopped
			}
			e.vars.Running = false
			e.mu.Unlock()
			e.emitState()
			return
		default:
		}

		// Check if stop was requested
		if e.vm.IsStopRequested() {
			e.mu.Lock()
			e.state = StateStopped
			e.vars.Running = false
			e.mu.Unlock()
			e.emitState()
			return
		}

		// Validate bet amount with lock-protected read.
		e.mu.RLock()
		nextBet := e.vars.NextBet
		vars := e.vars
		stats := e.stats
		safety := e.safety
		e.mu.RUnlock()

		if stop, _ := shouldStopForSafety(stats, safety); stop {
			e.mu.Lock()
			e.state = StateStopped
			e.vars.Running = false
			e.mu.Unlock()
			e.emitState()
			return
		}
		if nextBet <= 0 {
			e.setError(fmt.Errorf("nextbet must be > 0, got %f", nextBet))
			return
		}
		if safety.MaxBetAmount > 0 && nextBet > safety.MaxBetAmount {
			e.setError(fmt.Errorf("safety limit exceeded: nextbet %.8f is greater than maxBetAmount %.8f", nextBet, safety.MaxBetAmount))
			return
		}

		// 1. Place bet (initial round)
		result, err := e.betPlacer.PlaceBet(ctx, vars)
		if err != nil {
			// Check if context was cancelled (graceful stop)
			if ctx.Err() != nil {
				e.mu.Lock()
				if e.state == StateRunning {
					e.state = StateStopped
				}
				e.vars.Running = false
				e.mu.Unlock()
				e.emitState()
				return
			}
			e.setError(fmt.Errorf("bet placement failed: %w", err))
			return
		}

		// 1b. Multi-round game loop (HiLo, Mines, Blackjack).
		// If the game is multi-round AND the placer supports it AND the user
		// defined a round() callback, we enter the inner action loop.
		e.mu.RLock()
		gameName := e.vars.Game
		e.mu.RUnlock()

		if multiRoundGames[gameName] {
			if mrPlacer, ok := e.betPlacer.(MultiRoundPlacer); ok && e.vm.HasRoundFunc() {
				roundResult, roundErr := e.runMultiRoundLoop(ctx, mrPlacer, gameName, result)
				if roundErr != nil {
					if ctx.Err() != nil {
						e.mu.Lock()
						if e.state == StateRunning {
							e.state = StateStopped
						}
						e.vars.Running = false
						e.mu.Unlock()
						e.emitState()
						return
					}
					e.setError(fmt.Errorf("multi-round error: %w", roundErr))
					return
				}
				if roundResult != nil {
					result = roundResult
				}
			}
		}

		// 2. Update statistics and engine state under write lock.
		e.mu.Lock()
		e.stats.RecordBet(*result)

		// 3. Update variables from result
		e.vars.Win = result.Win
		e.vars.PreviousBet = result.Amount
		e.vars.Balance = e.stats.Balance
		e.vars.CashoutDone = true

		// 3b. Periodic balance re-sync for live mode.
		// Every N bets, if the placer supports it, re-fetch the real
		// account balance to detect external deposits/withdrawals.
		if syncer, ok := e.betPlacer.(BalanceSyncer); ok && e.stats.Bets%balanceSyncInterval == 0 {
			if realBal, err := syncer.GetBalance(ctx, e.vars.Currency); err == nil && realBal > 0 {
				drift := realBal - e.stats.Balance
				if drift > 0.000001 || drift < -0.000001 {
					e.stats.Balance = realBal
					e.vars.Balance = realBal
				}
			}
		}

		// 4. Update lastBet object
		e.vars.LastBet = map[string]interface{}{
			"amount":           result.Amount,
			"win":              result.Win,
			"Roll":             result.Roll,
			"payoutMultiplier": result.PayoutMulti,
			"chance":           result.Chance,
			"target":           result.Target,
			"payout":           result.Payout,
			"percent":          0.0,
			"targetNumber":     result.TargetNumber,
			"name":             nil,
		}

		// 5. Push updated state into VM
		e.vm.SetVariables(e.vars)

		// 6. Add chart data point
		e.chart.Push(ChartPoint{
			BetNumber: e.stats.Bets,
			Profit:    e.stats.Profit,
			Win:       result.Win,
		})

		// 6b. Record bet for persistence (if recorder is attached)
		recorder := e.recorder
		e.mu.Unlock()

		if recorder != nil {
			var roll *float64
			if result.Roll != 0 {
				r := result.Roll
				roll = &r
			}
			recorder.RecordBet(result.Amount, result.Payout, result.PayoutMulti, result.Win, roll)
		}

		// 7. Call dobet()
		if err := e.vm.CallDobet(); err != nil {
			e.setError(fmt.Errorf("dobet() error: %w", err))
			return
		}

		// 8. Sync variables back from VM
		e.vm.SyncVariables(e.vars)

		// 9. Check resetstats
		if e.vm.IsResetStatsRequested() {
			e.stats.Reset()
			e.chart.Reset()
			e.vm.SetVariables(e.vars)
		}

		// 10. Check stop conditions
		if e.vm.IsStopRequested() {
			e.mu.Lock()
			e.state = StateStopped
			e.vars.Running = false
			e.mu.Unlock()
			e.emitState()
			return
		}

		e.mu.RLock()
		stopOnWin := e.vars.StopOnWin
		e.mu.RUnlock()
		if stopOnWin && result.Win {
			e.mu.Lock()
			e.state = StateStopped
			e.vars.Running = false
			e.mu.Unlock()
			e.emitState()
			return
		}

		// 11. Emit state update (throttled: every 100ms or every bet if slower)
		e.throttledEmitState()

		// 12. Apply sleep delay
		sleepMs := e.vm.GetSleepTime()
		e.vm.ResetSleepTime()
		if sleepMs > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(sleepMs) * time.Millisecond):
			}
		}
	}
}

func shouldStopForSafety(stats *Statistics, limits SafetyLimits) (bool, string) {
	if stats == nil {
		return false, ""
	}
	if limits.MaxBets > 0 && stats.Bets >= limits.MaxBets {
		return true, "maxBets reached"
	}
	if limits.StopLoss > 0 && stats.Profit <= -limits.StopLoss {
		return true, "stopLoss reached"
	}
	if limits.TakeProfit > 0 && stats.Profit >= limits.TakeProfit {
		return true, "takeProfit reached"
	}
	return false, ""
}

// runMultiRoundLoop executes the inner action loop for multi-round games.
// It repeatedly calls round() to get the user's action, sends it to the API
// via PlaceNextAction, and continues until the game ends (bet.active == false)
// or the user cashes out.
func (e *Engine) runMultiRoundLoop(ctx context.Context, mrPlacer MultiRoundPlacer, game string, initialResult *BetResult) (*BetResult, error) {
	const maxRounds = 100 // Safety limit to prevent infinite loops

	for round := 0; round < maxRounds; round++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		if e.vm.IsStopRequested() {
			// User called stop() inside round() — try to cashout
			cashResult, err := mrPlacer.Cashout(ctx, game)
			if err == nil && cashResult != nil {
				return cashResult, nil
			}
			return initialResult, nil
		}

		// Inject current game state into VM so round() can inspect it
		e.mu.Lock()
		e.vars.CurrentBet = map[string]interface{}{
			"active":     true,
			"round":      round,
			"game":       game,
			"multiplier": initialResult.PayoutMulti,
		}
		e.vm.SetVariables(e.vars)
		e.mu.Unlock()

		// Call round() to get the user's action
		actionVal, err := e.vm.CallRound()
		if err != nil {
			return nil, fmt.Errorf("round() error: %w", err)
		}

		// Sync back any variable changes from round()
		e.vm.SyncVariables(e.vars)

		// Read the action from the return value or from the variables
		var action interface{}
		if actionVal != nil && !isUndefinedOrNull(actionVal) {
			action = actionVal.Export()
		} else {
			// Read from variables depending on game
			e.mu.RLock()
			switch game {
			case "hilo":
				if e.vars.HiLoGuess != nil {
					action = *e.vars.HiLoGuess
				}
			case "mines":
				if len(e.vars.Fields) > 0 {
					action = e.vars.Fields[0]
				}
			case "blackjack":
				action = e.vars.Action
			}
			e.mu.RUnlock()
		}

		// Check for cashout signals
		e.mu.RLock()
		cashoutDone := e.vars.CashoutDone
		e.mu.RUnlock()

		if cashoutDone {
			cashResult, err := mrPlacer.Cashout(ctx, game)
			if err != nil {
				return nil, fmt.Errorf("cashout failed: %w", err)
			}
			return cashResult, nil
		}

		if action == nil {
			return nil, fmt.Errorf("round() must return an action or set the appropriate action variable")
		}

		// Send the action to the API
		nextResult, stillActive, err := mrPlacer.PlaceNextAction(ctx, game, action)
		if err != nil {
			return nil, fmt.Errorf("next action failed: %w", err)
		}

		// Update initialResult with the latest state
		if nextResult != nil {
			initialResult = nextResult
		}

		// If the game is no longer active (player lost or game ended), exit loop
		if !stillActive {
			return initialResult, nil
		}
	}

	// Safety: hit max rounds — attempt cashout
	cashResult, err := mrPlacer.Cashout(ctx, game)
	if err != nil {
		return initialResult, nil
	}
	return cashResult, nil
}

func (e *Engine) setError(err error) {
	e.mu.Lock()
	e.state = StateError
	e.err = err
	if e.vars != nil {
		e.vars.Running = false
	}
	e.mu.Unlock()
	e.emitState()
}

func (e *Engine) snapshot() EngineSnapshot {
	snap := EngineSnapshot{
		State: e.state,
	}
	if e.err != nil {
		snap.Error = e.err.Error()
	}
	if e.stats != nil {
		statsCopy := *e.stats
		snap.Stats = &statsCopy
	}
	if e.chart != nil {
		snap.Chart = append([]ChartPoint(nil), e.chart.Points...)
	}
	if e.vars != nil {
		snap.CurrentGame = e.vars.Game
	}
	if e.state == StateRunning && e.stats != nil && e.stats.Bets > 0 {
		elapsed := time.Since(e.startTime).Seconds()
		if elapsed > 0 {
			snap.BetsPerSecond = float64(e.stats.Bets) / elapsed
		}
	}
	return snap
}

func (e *Engine) emitState() {
	if e.emitter == nil {
		return
	}
	e.mu.RLock()
	snap := e.snapshot()
	e.mu.RUnlock()
	e.emitter.EmitScriptState(snap)
	e.lastEmit = time.Now()
}

// throttledEmitState only emits if at least 100ms have passed since the last emission.
func (e *Engine) throttledEmitState() {
	if time.Since(e.lastEmit) < 100*time.Millisecond {
		return
	}
	e.emitState()
}

func isUndefinedOrNull(v interface{}) bool {
	if v == nil {
		return true
	}
	if gv, ok := v.(goja.Value); ok {
		return goja.IsUndefined(gv) || goja.IsNull(gv)
	}
	return false
}
