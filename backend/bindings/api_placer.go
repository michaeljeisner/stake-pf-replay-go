package bindings

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/MJE43/stake-pf-replay-go/internal/scripting"
	"github.com/MJE43/stake-pf-replay-go/internal/stake"
)

// ApiBetPlacer implements scripting.BetPlacer using a real Stake API client.
// It maps script variables to API requests and API responses back to BetResults.
// Includes a circuit breaker that halts betting after repeated API failures.
type ApiBetPlacer struct {
	client              *stake.Client
	accountID           string
	ledger              LedgerRecorder
	mu                  sync.Mutex
	blackjackActions    map[string]bool
	consecutiveFails    int
	maxConsecutiveFails int
}

const defaultMaxConsecutiveFails = 5

// NewApiBetPlacer creates a new ApiBetPlacer wrapping the given Stake client.
func NewApiBetPlacer(client *stake.Client) *ApiBetPlacer {
	return NewApiBetPlacerWithLedger(client, "", nil)
}

// NewApiBetPlacerWithLedger records successful app-placed bets to the desktop ledger.
func NewApiBetPlacerWithLedger(client *stake.Client, accountID string, ledger LedgerRecorder) *ApiBetPlacer {
	return &ApiBetPlacer{
		client:              client,
		accountID:           accountID,
		ledger:              ledger,
		maxConsecutiveFails: defaultMaxConsecutiveFails,
	}
}

// PlaceBet dispatches a bet to the appropriate Stake API endpoint based on
// the current game variable. Returns a scripting.BetResult.
// Includes circuit breaker: halts after maxConsecutiveFails successive errors.
func (p *ApiBetPlacer) PlaceBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Circuit breaker check
	if p.consecutiveFails >= p.maxConsecutiveFails {
		return nil, fmt.Errorf("circuit breaker open: %d consecutive API failures — stopping for safety", p.consecutiveFails)
	}
	var result *scripting.BetResult
	var err error

	switch vars.Game {
	case "dice":
		result, err = p.placeDiceBet(ctx, vars)
	case "limbo":
		result, err = p.placeLimboBet(ctx, vars)
	case "hilo":
		result, err = p.placeHiloBet(ctx, vars)
	case "mines":
		result, err = p.placeMinesBet(ctx, vars)
	case "blackjack":
		result, err = p.placeBlackjackBet(ctx, vars)
	default:
		return nil, fmt.Errorf("unsupported live game %q; live mode currently supports dice, limbo, hilo, mines, and blackjack", vars.Game)
	}

	// Circuit breaker tracking
	if err != nil {
		p.consecutiveFails++
		return nil, err
	}
	p.consecutiveFails = 0
	return result, nil
}

func (p *ApiBetPlacer) placeDiceBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	condition := "above"
	target := 100 - vars.Chance
	if !vars.BetHigh {
		condition = "below"
		target = vars.Chance
	}

	req := stake.DiceBetRequest{
		Target:    target,
		Condition: condition,
		Amount:    vars.NextBet,
	}
	result, err := p.client.DiceBet(ctx, req)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "dice", result.BetResult, req, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
		Roll:        result.State.Result,
		Chance:      vars.Chance,
		Target:      result.State.Target,
	}, nil
}

func (p *ApiBetPlacer) placeLimboBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	req := stake.LimboBetRequest{
		MultiplierTarget: vars.Target,
		Amount:           vars.NextBet,
	}
	result, err := p.client.LimboBet(ctx, req)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "limbo", result.BetResult, req, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
		Roll:        result.State.Result,
		Target:      vars.Target,
	}, nil
}

func (p *ApiBetPlacer) recordLedger(ctx context.Context, game string, bet stake.BetResult, request any, response any) error {
	if p.ledger == nil || p.accountID == "" {
		return nil
	}
	amount, _ := bet.Amount.Float64()
	payout, _ := bet.Payout.Float64()
	reqJSON, _ := json.Marshal(request)
	respJSON, _ := json.Marshal(response)

	keyPart := bet.ID
	if keyPart == "" {
		keyPart = fmt.Sprintf("nonce:%d", bet.Nonce)
	}
	requestHash := sha256.Sum256(reqJSON)
	entry := LedgerEntry{
		AccountID:        p.accountID,
		Source:           "app",
		Game:             game,
		ExternalBetID:    bet.ID,
		IdempotencyKey:   fmt.Sprintf("stake:%s:%s:%s:%x", p.accountID, game, keyPart, requestHash[:6]),
		Currency:         bet.Currency,
		Nonce:            int64(bet.Nonce),
		Amount:           amount,
		Payout:           payout,
		PayoutMultiplier: bet.PayoutMultiplier,
		RequestJSON:      string(reqJSON),
		ResponseJSON:     string(respJSON),
		CreatedAt:        time.Now().UTC(),
	}
	if err := p.ledger.RecordLedgerEntry(ctx, entry); err != nil {
		return fmt.Errorf("bet placed but ledger recording failed: %w", err)
	}
	return nil
}

func (p *ApiBetPlacer) placeKenoBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	numbers := vars.Numbers
	if len(numbers) == 0 {
		// Default picks if none set by script
		numbers = []int{1, 5, 10, 15, 20}
	}

	risk := vars.Risk
	if risk == "" {
		risk = "classic"
	}

	result, err := p.client.KenoBet(ctx, stake.KenoBetRequest{
		Numbers: numbers,
		Risk:    risk,
		Amount:  vars.NextBet,
	})
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) placeBaccaratBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	result, err := p.client.BaccaratBet(ctx, stake.BaccaratBetRequest{
		Player: vars.Player,
		Banker: vars.Banker,
		Tie:    vars.Tie,
	})
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) placePlinkoBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	risk := vars.Risk
	if risk == "" {
		risk = "medium"
	}
	rows := vars.Rows
	if rows == 0 {
		rows = 16
	}

	result, err := p.client.PlinkoBet(ctx, stake.PlinkoBetRequest{
		Risk:   risk,
		Rows:   rows,
		Amount: vars.NextBet,
	})
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
		Roll:        result.State.Result,
	}, nil
}

func (p *ApiBetPlacer) placeWheelBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	risk := vars.Risk
	if risk == "" {
		risk = "medium"
	}
	segments := vars.Segments
	if segments == 0 {
		segments = 30
	}

	result, err := p.client.WheelBet(ctx, stake.WheelBetRequest{
		Risk:     risk,
		Segments: segments,
		Amount:   vars.NextBet,
	})
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
		Roll:        result.State.Result,
	}, nil
}

func (p *ApiBetPlacer) placeRouletteBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	if len(vars.Chips) == 0 {
		return nil, fmt.Errorf("roulette requires chips to be set")
	}

	chips := make([]stake.RouletteChip, len(vars.Chips))
	for i, c := range vars.Chips {
		v, _ := c["value"].(float64)
		idx, _ := c["index"].(float64)
		chips[i] = stake.RouletteChip{Value: v, Index: int(idx)}
	}

	result, err := p.client.RouletteBet(ctx, stake.RouletteBetRequest{
		Chips:  chips,
		Amount: vars.NextBet,
	})
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
		Roll:        float64(result.State.Result),
	}, nil
}

func (p *ApiBetPlacer) placeHiloBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	var startCard *stake.Card
	if vars.StartCard != nil {
		rank, _ := vars.StartCard["rank"]
		suit, _ := vars.StartCard["suit"]
		if rank != "" && suit != "" {
			startCard = &stake.Card{Rank: rank, Suit: suit}
		}
	}

	req := stake.HiLoBetRequest{
		Amount:    vars.NextBet,
		StartCard: startCard,
	}
	result, err := p.client.HiLoBet(ctx, req)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "hilo", *result, req, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) placeMinesBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	minesCount := vars.Mines
	if minesCount == 0 {
		minesCount = 3
	}

	req := stake.MinesBetRequest{
		Amount:     vars.NextBet,
		MinesCount: minesCount,
		Fields:     vars.Fields,
	}
	result, err := p.client.MinesBet(ctx, req)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "mines", *result, req, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) placeBlackjackBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	req := stake.BlackjackBetRequest{
		Amount: vars.NextBet,
	}
	result, err := p.client.BlackjackBet(ctx, req)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	p.blackjackActions = blackjackActionsFromState(result.State)
	if err := p.recordLedger(ctx, "blackjack", *result, req, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

// --- MultiRoundPlacer interface implementation ---

// PlaceNextAction sends the next action for an active multi-round game.
func (p *ApiBetPlacer) PlaceNextAction(ctx context.Context, game string, action interface{}) (*scripting.BetResult, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	switch game {
	case "hilo":
		return p.hiloNext(ctx, action)
	case "mines":
		return p.minesNext(ctx, action)
	case "blackjack":
		return p.blackjackNext(ctx, action)
	default:
		return nil, false, fmt.Errorf("multi-round not supported for game %q", game)
	}
}

// Cashout cashes out the current active multi-round game.
func (p *ApiBetPlacer) Cashout(ctx context.Context, game string) (*scripting.BetResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	switch game {
	case "hilo":
		return p.hiloCashout(ctx)
	case "mines":
		return p.minesCashout(ctx)
	default:
		return nil, fmt.Errorf("cashout not supported for game %q", game)
	}
}

func (p *ApiBetPlacer) hiloNext(ctx context.Context, action interface{}) (*scripting.BetResult, bool, error) {
	// Map action to HiLo guess string.
	// HiLo constants: 2=equal, 4=lower, 5=higher, 7=skip, 3=cashout
	guess := ""
	switch v := action.(type) {
	case int64:
		switch v {
		case 2:
			guess = "equal"
		case 4:
			guess = "lower"
		case 5:
			guess = "higher"
		case 7:
			guess = "skip"
		case 3:
			// Cashout signal
			result, err := p.hiloCashout(ctx)
			if err != nil {
				return nil, false, err
			}
			return result, false, nil
		default:
			return nil, false, fmt.Errorf("invalid HiLo action: %d", v)
		}
	case float64:
		return p.hiloNext(ctx, int64(v))
	case string:
		guess = v
	default:
		return nil, false, fmt.Errorf("invalid HiLo action type: %T", action)
	}

	result, err := p.client.HiLoNext(ctx, guess)
	if err != nil {
		return nil, false, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "hilo", *result, map[string]any{"guess": guess}, result); err != nil {
		return nil, false, err
	}

	br := &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}

	return br, result.Active, nil
}

func (p *ApiBetPlacer) hiloCashout(ctx context.Context) (*scripting.BetResult, error) {
	result, err := p.client.HiLoCashout(ctx)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "hilo", *result, map[string]any{"cashout": true}, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) minesNext(ctx context.Context, action interface{}) (*scripting.BetResult, bool, error) {
	field := 0
	switch v := action.(type) {
	case int64:
		field = int(v)
	case float64:
		field = int(v)
	case int:
		field = v
	default:
		return nil, false, fmt.Errorf("invalid Mines action type: %T (expected int field index)", action)
	}

	result, err := p.client.MinesNext(ctx, field)
	if err != nil {
		return nil, false, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "mines", *result, map[string]any{"field": field}, result); err != nil {
		return nil, false, err
	}

	br := &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}

	return br, result.Active, nil
}

func (p *ApiBetPlacer) minesCashout(ctx context.Context) (*scripting.BetResult, error) {
	result, err := p.client.MinesCashout(ctx)
	if err != nil {
		return nil, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	if err := p.recordLedger(ctx, "mines", *result, map[string]any{"cashout": true}, result); err != nil {
		return nil, err
	}

	return &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}, nil
}

func (p *ApiBetPlacer) blackjackNext(ctx context.Context, action interface{}) (*scripting.BetResult, bool, error) {
	actionStr := ""
	switch v := action.(type) {
	case string:
		actionStr = v
	default:
		return nil, false, fmt.Errorf("invalid Blackjack action type: %T (expected string)", action)
	}
	if len(p.blackjackActions) > 0 && !p.blackjackActions[actionStr] {
		return nil, false, fmt.Errorf("blackjack action %q is not available in the current server state", actionStr)
	}

	result, err := p.client.BlackjackNext(ctx, actionStr)
	if err != nil {
		return nil, false, classifyError(err)
	}

	amount, _ := result.Amount.Float64()
	payout, _ := result.Payout.Float64()
	p.blackjackActions = blackjackActionsFromState(result.State)
	if err := p.recordLedger(ctx, "blackjack", *result, map[string]any{"action": actionStr}, result); err != nil {
		return nil, false, err
	}

	br := &scripting.BetResult{
		Amount:      amount,
		Payout:      payout,
		PayoutMulti: result.PayoutMultiplier,
		Win:         result.IsWin(),
	}

	return br, result.Active, nil
}

func blackjackActionsFromState(raw json.RawMessage) map[string]bool {
	if len(raw) == 0 {
		return nil
	}
	var state struct {
		Actions []string `json:"actions"`
	}
	if err := json.Unmarshal(raw, &state); err != nil || len(state.Actions) == 0 {
		return nil
	}
	out := make(map[string]bool, len(state.Actions))
	for _, action := range state.Actions {
		switch action {
		case "BLACKJACK_HIT":
			out["hit"] = true
		case "BLACKJACK_STAND":
			out["stand"] = true
		case "BLACKJACK_DOUBLE":
			out["double"] = true
		case "BLACKJACK_SPLIT":
			out["split"] = true
		case "BLACKJACK_INSURANCE":
			out["insurance"] = true
		case "BLACKJACK_NOINSURANCE":
			out["noInsurance"] = true
		default:
			out[action] = true
		}
	}
	return out
}

// GetBalance implements scripting.BalanceSyncer for periodic balance re-sync.
func (p *ApiBetPlacer) GetBalance(ctx context.Context, currency string) (float64, error) {
	bal, err := p.client.GetBalance(ctx, currency)
	if err != nil {
		return 0, err
	}
	f, _ := bal.Float64()
	return f, nil
}

// classifyError wraps Stake API errors into user-friendly messages and
// detects special error types that the engine should handle differently.
func classifyError(err error) error {
	if err == nil {
		return nil
	}

	var authErr *stake.AuthError
	if errors.As(err, &authErr) {
		return fmt.Errorf("authentication failed (HTTP %d): %s - update credentials or reconnect the account", authErr.StatusCode, authErr.Message)
	}

	var cfErr *stake.CloudflareError
	if errors.As(err, &cfErr) {
		return fmt.Errorf("browser session repair required (HTTP %d): %s", cfErr.StatusCode, cfErr.Message)
	}

	// Check for auth errors
	if authErr, ok := err.(*stake.AuthError); ok {
		return fmt.Errorf("authentication failed (HTTP %d): %s — please refresh your session token", authErr.StatusCode, authErr.Message)
	}

	// Check for Stake API errors
	if stakeErr, ok := err.(*stake.StakeError); ok {
		if stakeErr.IsInsufficientBalance() {
			return fmt.Errorf("insufficient balance: %s", stakeErr.Message)
		}
		if stakeErr.IsExistingGame() {
			return fmt.Errorf("existing active game detected: %s", stakeErr.Message)
		}
		return fmt.Errorf("API error (%s): %s", stakeErr.ErrorType, stakeErr.Message)
	}

	return err
}
