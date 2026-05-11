package scripting

import "fmt"

// SafetyLimits are hard backend rails for automated sessions. They apply to
// both simulated and live modes, but live sessions should always provide
// non-zero limits.
type SafetyLimits struct {
	MaxBets      int     `json:"maxBets"`
	MaxBetAmount float64 `json:"maxBetAmount"`
	StopLoss     float64 `json:"stopLoss"`
	TakeProfit   float64 `json:"takeProfit"`
}

func DefaultLiveSafetyLimits() SafetyLimits {
	return SafetyLimits{
		MaxBets:      1000,
		MaxBetAmount: 0.001,
		StopLoss:     0.01,
	}
}

func (l SafetyLimits) Validate() error {
	if l.MaxBets < 0 {
		return fmt.Errorf("maxBets must be >= 0")
	}
	if l.MaxBetAmount < 0 {
		return fmt.Errorf("maxBetAmount must be >= 0")
	}
	if l.StopLoss < 0 {
		return fmt.Errorf("stopLoss must be >= 0")
	}
	if l.TakeProfit < 0 {
		return fmt.Errorf("takeProfit must be >= 0")
	}
	return nil
}

func (l SafetyLimits) IsZero() bool {
	return l.MaxBets == 0 && l.MaxBetAmount == 0 && l.StopLoss == 0 && l.TakeProfit == 0
}
