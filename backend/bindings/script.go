package bindings

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/MJE43/stake-pf-replay-go/internal/scripting"
	"github.com/MJE43/stake-pf-replay-go/internal/scriptstore"
	"github.com/MJE43/stake-pf-replay-go/internal/stake"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ScriptModule is the Wails-bound struct for scripting engine management.
type ScriptModule struct {
	ctx     context.Context
	mu      sync.RWMutex
	engine  *scripting.Engine
	session SessionProvider
	store   *scriptstore.Store
	ledger  LedgerRecorder

	// Current session tracking
	currentSessionID string
	currentMode      string

	// Event emitter for pushing state to the frontend.
	emitter *wailsScriptEmitter
}

// ScriptState is the frontend-facing snapshot of engine state.
type ScriptState struct {
	State         string                 `json:"state"`
	Error         string                 `json:"error,omitempty"`
	Mode          string                 `json:"mode"`
	SessionID     string                 `json:"sessionId,omitempty"`
	Bets          int                    `json:"bets"`
	Wins          int                    `json:"wins"`
	Losses        int                    `json:"losses"`
	Profit        float64                `json:"profit"`
	Balance       float64                `json:"balance"`
	Wagered       float64                `json:"wagered"`
	WinStreak     int                    `json:"winStreak"`
	LoseStreak    int                    `json:"loseStreak"`
	CurrentGame   string                 `json:"currentGame"`
	BetsPerSecond float64                `json:"betsPerSecond"`
	Chart         []scripting.ChartPoint `json:"chart"`
}

// wailsScriptEmitter bridges scripting events to Wails runtime events.
type wailsScriptEmitter struct {
	ctx context.Context
}

// SessionProvider is the minimal auth/session surface ScriptModule depends on.
type SessionProvider interface {
	Client() *stake.Client
	IsConnected() bool
	ActiveConnectionState() string
	ActiveAccountID() string
}

func (e *wailsScriptEmitter) EmitScriptState(state scripting.EngineSnapshot) {
	if e.ctx == nil {
		return
	}
	// Placeholder for future Wails event integration.
}

func (e *wailsScriptEmitter) EmitScriptLog(entries []scripting.LogEntry) {
	// Placeholder for future Wails event integration.
}

// NewScriptModule creates a new ScriptModule ready to be bound.
func NewScriptModule(session SessionProvider) *ScriptModule {
	return NewScriptModuleWithLedger(session, nil)
}

// NewScriptModuleWithLedger creates a ScriptModule that records app-placed live bets.
func NewScriptModuleWithLedger(session SessionProvider, ledger LedgerRecorder) *ScriptModule {
	emitter := &wailsScriptEmitter{}
	return &ScriptModule{
		session: session,
		ledger:  ledger,
		emitter: emitter,
	}
}

// InitStore initializes the script session store at the given path.
// Should be called during application startup.
func (sm *ScriptModule) InitStore(dbPath string) error {
	store, err := scriptstore.New(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open script store: %w", err)
	}
	if err := store.Migrate(); err != nil {
		store.Close()
		return fmt.Errorf("failed to migrate script store: %w", err)
	}
	sm.store = store
	return nil
}

// Startup is called by Wails on application startup.
func (sm *ScriptModule) Startup(ctx context.Context) {
	sm.ctx = ctx
	sm.emitter.ctx = ctx
}

func (sm *ScriptModule) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	sm.Startup(ctx)
	return nil
}

// StartScript starts the scripting engine with the given script.
// mode: "simulated" (default) or "live" (uses real Stake API).
func (sm *ScriptModule) StartScript(script string, game string, currency string, startBalance float64, mode string) error {
	return sm.StartScriptWithSafety(script, game, currency, startBalance, mode, scripting.SafetyLimits{})
}

// StartScriptWithSafety starts a script with explicit backend-enforced limits.
func (sm *ScriptModule) StartScriptWithSafety(script string, game string, currency string, startBalance float64, mode string, safety scripting.SafetyLimits) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if sm.engine != nil {
		if snap := sm.engine.GetState(); snap.State == scripting.StateRunning {
			if err := sm.engine.Stop(); err != nil {
				return fmt.Errorf("failed to stop running script: %w", err)
			}
		}
	}

	if startBalance <= 0 {
		startBalance = 1.0
	}
	if strings.TrimSpace(game) == "" {
		game = "dice"
	}
	game = strings.ToLower(strings.TrimSpace(game))
	if strings.TrimSpace(currency) == "" {
		currency = "trx"
	}
	if mode == "" {
		mode = "simulated"
	}
	if mode == "live" && safety.IsZero() {
		safety = scripting.DefaultLiveSafetyLimits()
	}
	if err := safety.Validate(); err != nil {
		return fmt.Errorf("invalid safety limits: %w", err)
	}

	// Choose the bet placer based on mode
	var placer scripting.BetPlacer
	switch mode {
	case "live":
		if game != "dice" && game != "limbo" && game != "hilo" && game != "mines" && game != "blackjack" {
			return fmt.Errorf("unsupported live game %q; live mode currently supports dice, limbo, hilo, mines, and blackjack", game)
		}
		if sm.session == nil || !sm.session.IsConnected() || sm.session.ActiveConnectionState() != "connected" {
			return fmt.Errorf("cannot start in live mode: account connection state must be connected")
		}
		client := sm.session.Client()
		if client == nil {
			return fmt.Errorf("cannot start in live mode: session client is nil")
		}
		if err := sm.assertNoActiveStateGames(client); err != nil {
			return err
		}
		// Ensure the client uses the script's currency
		client.SetCurrency(currency)
		placer = NewApiBetPlacerWithLedger(client, sm.session.ActiveAccountID(), sm.ledger)
	default:
		placer = &SimulatedBetPlacer{}
	}

	// Create a fresh engine each time
	sm.engine = scripting.NewEngine(placer, sm.emitter)
	if err := sm.engine.SetSafetyLimits(safety); err != nil {
		return fmt.Errorf("invalid safety limits: %w", err)
	}
	sm.currentMode = mode

	// Create a persistent session if the store is initialized
	if sm.store != nil {
		sess := &scriptstore.ScriptSession{
			Game:         game,
			Currency:     currency,
			Mode:         mode,
			ScriptSource: script,
			StartBalance: startBalance,
		}
		id, err := sm.store.CreateSession(sess)
		if err != nil {
			log.Printf("scriptstore: failed to create session: %v", err)
		} else {
			sm.currentSessionID = id
			recorder := scriptstore.NewSessionRecorder(sm.store, id, 50)
			sm.engine.SetRecorder(recorder)
		}
	}

	bootstrap := fmt.Sprintf("game = %q\ncurrency = %q\n%s", game, currency, script)
	if err := sm.engine.Start(bootstrap, startBalance); err != nil {
		return fmt.Errorf("failed to start script: %w", err)
	}

	return nil
}

func (sm *ScriptModule) assertNoActiveStateGames(client *stake.Client) error {
	ctx := sm.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	for _, game := range []string{"hilo", "mines", "blackjack"} {
		active, err := client.GetActiveBet(ctx, game)
		if err != nil {
			return fmt.Errorf("startup recovery failed for %s: %w", game, err)
		}
		if active != nil {
			id := strings.TrimSpace(active.ID)
			if id == "" {
				id = "unknown"
			}
			return fmt.Errorf("cannot start automated live session: active %s bet %s requires recovery or cashout first", game, id)
		}
	}
	return nil
}

// StopScript stops the currently running script.
func (sm *ScriptModule) StopScript() error {
	sm.mu.RLock()
	eng := sm.engine
	sessionID := sm.currentSessionID
	sm.mu.RUnlock()

	if eng == nil {
		return fmt.Errorf("no script is running")
	}

	err := eng.Stop()

	// End the persistent session
	if sessionID != "" && sm.store != nil {
		snap := eng.GetState()
		finalState := "stopped"
		if snap.Error != "" {
			finalState = "error"
		}
		stats := scriptstore.SessionStats{
			TotalBets:    snap.Stats.Bets,
			TotalWins:    snap.Stats.Wins,
			TotalLosses:  snap.Stats.Losses,
			TotalProfit:  snap.Stats.Profit,
			TotalWagered: snap.Stats.Wagered,
			FinalBalance: snap.Stats.Balance,
		}
		if snap.Stats != nil {
			stats.HighestStreak = snap.Stats.HighestStreak
			stats.LowestStreak = snap.Stats.LowestStreak
		}
		if storeErr := sm.store.EndSession(sessionID, finalState, stats); storeErr != nil {
			log.Printf("scriptstore: failed to end session: %v", storeErr)
		}
	}

	return err
}

// GetScriptState returns the current scripting engine state.
func (sm *ScriptModule) GetScriptState() ScriptState {
	sm.mu.RLock()
	eng := sm.engine
	sessionID := sm.currentSessionID
	mode := sm.currentMode
	sm.mu.RUnlock()

	if eng == nil {
		return ScriptState{State: string(scripting.StateIdle), Mode: "simulated"}
	}

	if mode == "" {
		mode = "simulated"
	}

	snap := eng.GetState()
	state := ScriptState{
		State:         string(snap.State),
		Error:         snap.Error,
		Mode:          mode,
		SessionID:     sessionID,
		CurrentGame:   snap.CurrentGame,
		BetsPerSecond: snap.BetsPerSecond,
	}

	if snap.Stats != nil {
		state.Bets = snap.Stats.Bets
		state.Wins = snap.Stats.Wins
		state.Losses = snap.Stats.Losses
		state.Profit = snap.Stats.Profit
		state.Balance = snap.Stats.Balance
		state.Wagered = snap.Stats.Wagered
		state.WinStreak = snap.Stats.WinStreak
		state.LoseStreak = snap.Stats.LoseStreak
	}

	if snap.Chart != nil {
		state.Chart = snap.Chart
	}

	return state
}

// GetScriptLog returns the script log buffer.
func (sm *ScriptModule) GetScriptLog() []scripting.LogEntry {
	sm.mu.RLock()
	eng := sm.engine
	sm.mu.RUnlock()

	if eng == nil {
		return nil
	}

	return eng.GetLogs()
}

// --- Session persistence bindings ---

// ScriptSessionSummary is a lightweight session entry for listing.
type ScriptSessionSummary struct {
	ID           string   `json:"id"`
	Game         string   `json:"game"`
	Currency     string   `json:"currency"`
	Mode         string   `json:"mode"`
	FinalState   string   `json:"finalState"`
	TotalBets    int      `json:"totalBets"`
	TotalProfit  float64  `json:"totalProfit"`
	StartBalance float64  `json:"startBalance"`
	FinalBalance *float64 `json:"finalBalance,omitempty"`
	CreatedAt    string   `json:"createdAt"`
	EndedAt      *string  `json:"endedAt,omitempty"`
}

// ScriptSessionsPage is a paginated sessions response.
type ScriptSessionsPage struct {
	Sessions   []ScriptSessionSummary `json:"sessions"`
	TotalCount int                    `json:"totalCount"`
}

// ListScriptSessions returns paginated script sessions.
func (sm *ScriptModule) ListScriptSessions(limit int, offset int) ScriptSessionsPage {
	if sm.store == nil {
		return ScriptSessionsPage{}
	}

	sessions, total, err := sm.store.ListSessions(limit, offset)
	if err != nil {
		log.Printf("scriptstore: list sessions error: %v", err)
		return ScriptSessionsPage{}
	}

	summaries := make([]ScriptSessionSummary, len(sessions))
	for i, s := range sessions {
		summary := ScriptSessionSummary{
			ID:           s.ID,
			Game:         s.Game,
			Currency:     s.Currency,
			Mode:         s.Mode,
			FinalState:   s.FinalState,
			TotalBets:    s.TotalBets,
			TotalProfit:  s.TotalProfit,
			StartBalance: s.StartBalance,
			FinalBalance: s.FinalBalance,
			CreatedAt:    s.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}
		if s.EndedAt != nil {
			t := s.EndedAt.Format("2006-01-02T15:04:05Z")
			summary.EndedAt = &t
		}
		summaries[i] = summary
	}

	return ScriptSessionsPage{
		Sessions:   summaries,
		TotalCount: total,
	}
}

// GetScriptSession returns the full details of a session by ID.
func (sm *ScriptModule) GetScriptSession(id string) (*scriptstore.ScriptSession, error) {
	if sm.store == nil {
		return nil, fmt.Errorf("script store not initialized")
	}
	return sm.store.GetSession(id)
}

// GetScriptSessionBets returns paginated bets for a session.
func (sm *ScriptModule) GetScriptSessionBets(id string, page int, perPage int) (*scriptstore.ScriptBetsPage, error) {
	if sm.store == nil {
		return nil, fmt.Errorf("script store not initialized")
	}
	return sm.store.GetSessionBets(id, page, perPage)
}

// DeleteScriptSession removes a session and all associated data.
func (sm *ScriptModule) DeleteScriptSession(id string) error {
	if sm.store == nil {
		return fmt.Errorf("script store not initialized")
	}
	return sm.store.DeleteSession(id)
}

// SimulatedBetPlacer is a placeholder that simulates bet results.
type SimulatedBetPlacer struct{}

func (s *SimulatedBetPlacer) PlaceBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	switch vars.Game {
	case "dice":
		return simulateDiceBet(vars), nil
	case "limbo":
		return simulateLimboBet(vars), nil
	default:
		return simulateGenericBet(vars), nil
	}
}

func simulateDiceBet(vars *scripting.Variables) *scripting.BetResult {
	win := vars.Chance >= 50
	multi := 0.0
	if win {
		multi = 99.0 / vars.Chance
	}
	payout := 0.0
	if win {
		payout = vars.NextBet * multi
	}

	return &scripting.BetResult{
		Amount:      vars.NextBet,
		Payout:      payout,
		PayoutMulti: multi,
		Win:         win,
		Roll:        25.0,
		Chance:      vars.Chance,
		Target:      50.0,
	}
}

func simulateLimboBet(vars *scripting.Variables) *scripting.BetResult {
	return &scripting.BetResult{
		Amount:      vars.NextBet,
		Payout:      0,
		PayoutMulti: 0,
		Win:         false,
		Roll:        1.0,
		Target:      vars.Target,
	}
}

func simulateGenericBet(vars *scripting.Variables) *scripting.BetResult {
	return &scripting.BetResult{
		Amount:      vars.NextBet,
		Payout:      0,
		PayoutMulti: 0,
		Win:         false,
		Roll:        0,
	}
}
