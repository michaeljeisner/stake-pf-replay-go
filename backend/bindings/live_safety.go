package bindings

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/MJE43/stake-pf-replay-go/internal/scripting"
	"github.com/MJE43/stake-pf-replay-go/internal/stake"
)

type LiveScriptOptions struct {
	MaxBet             float64 `json:"maxBet,omitempty"`
	MaxTotalWager      float64 `json:"maxTotalWager,omitempty"`
	MaxLoss            float64 `json:"maxLoss,omitempty"`
	MaxBets            int     `json:"maxBets,omitempty"`
	MaxRuntimeSeconds  int     `json:"maxRuntimeSeconds,omitempty"`
	StopOnSessionError bool    `json:"stopOnSessionError,omitempty"`
}

type SafetyStopError struct {
	Reason string
}

func (e *SafetyStopError) Error() string {
	return "live safety stop: " + e.Reason
}

type SafetyBetPlacer struct {
	inner   scripting.BetPlacer
	options LiveScriptOptions
	started time.Time
	bets    int
	wagered float64
	profit  float64
}

func NewSafetyBetPlacer(inner scripting.BetPlacer, options LiveScriptOptions, started time.Time) *SafetyBetPlacer {
	if started.IsZero() {
		started = time.Now()
	}
	return &SafetyBetPlacer{inner: inner, options: options, started: started}
}

func (p *SafetyBetPlacer) PlaceBet(ctx context.Context, vars *scripting.Variables) (*scripting.BetResult, error) {
	if err := p.checkBefore(vars); err != nil {
		return nil, err
	}
	result, err := p.inner.PlaceBet(ctx, vars)
	if err != nil {
		if p.options.StopOnSessionError && isSessionError(err) {
			return nil, &SafetyStopError{Reason: err.Error()}
		}
		return nil, err
	}
	p.bets++
	p.wagered += result.Amount
	p.profit += result.Payout - result.Amount
	if err := p.checkAfter(); err != nil {
		return nil, err
	}
	return result, nil
}

func (p *SafetyBetPlacer) checkBefore(vars *scripting.Variables) error {
	if p.options.MaxRuntimeSeconds > 0 && time.Since(p.started) >= time.Duration(p.options.MaxRuntimeSeconds)*time.Second {
		return &SafetyStopError{Reason: "max runtime reached"}
	}
	if p.options.MaxBets > 0 && p.bets >= p.options.MaxBets {
		return &SafetyStopError{Reason: "max bets reached"}
	}
	if p.options.MaxBet > 0 && vars != nil && vars.NextBet > p.options.MaxBet {
		return &SafetyStopError{Reason: fmt.Sprintf("next bet %.8f exceeds max bet %.8f", vars.NextBet, p.options.MaxBet)}
	}
	if p.options.MaxTotalWager > 0 && vars != nil && p.wagered+vars.NextBet > p.options.MaxTotalWager {
		return &SafetyStopError{Reason: "max total wager would be exceeded"}
	}
	return nil
}

func (p *SafetyBetPlacer) checkAfter() error {
	if p.options.MaxLoss > 0 && -p.profit >= p.options.MaxLoss {
		return &SafetyStopError{Reason: "max loss reached"}
	}
	if p.options.MaxTotalWager > 0 && p.wagered >= p.options.MaxTotalWager {
		return &SafetyStopError{Reason: "max total wager reached"}
	}
	if p.options.MaxBets > 0 && p.bets >= p.options.MaxBets {
		return &SafetyStopError{Reason: "max bets reached"}
	}
	return nil
}

func isSessionError(err error) bool {
	var liveErr *LiveBetError
	if errors.As(err, &liveErr) {
		return liveErr.Kind == stake.ErrorKindAuth || liveErr.Kind == stake.ErrorKindCloudflare
	}
	return false
}
