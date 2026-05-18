package stake

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

// StakeError represents an error returned by the Stake API.
type StakeError struct {
	ErrorType string `json:"errorType"`
	Message   string `json:"message"`
}

func (e *StakeError) Error() string {
	return fmt.Sprintf("stake: %s: %s", e.ErrorType, e.Message)
}

// Sentinel error types from the Stake API.
const (
	ErrTypeParallelBet         = "parallelCasinoBet"
	ErrTypeExistingGame        = "existingGame"
	ErrTypeNotFound            = "notFound"
	ErrTypeInsignificantBet    = "insignificantBet"
	ErrTypeInsufficientBalance = "insufficientBalance"
)

// IsParallelBet returns true if the error is a transient parallel bet error.
func (e *StakeError) IsParallelBet() bool {
	return strings.Contains(e.ErrorType, ErrTypeParallelBet)
}

// IsExistingGame returns true if there's an active game that needs to be resumed.
func (e *StakeError) IsExistingGame() bool {
	return strings.Contains(e.ErrorType, ErrTypeExistingGame)
}

// IsNotFound returns true if the bet/game was not found (treat as complete).
func (e *StakeError) IsNotFound() bool {
	return strings.Contains(e.ErrorType, ErrTypeNotFound)
}

// IsInsignificantBet returns true if the bet was too small.
func (e *StakeError) IsInsignificantBet() bool {
	return strings.Contains(e.ErrorType, ErrTypeInsignificantBet)
}

// IsInsufficientBalance returns true if there aren't enough funds.
func (e *StakeError) IsInsufficientBalance() bool {
	return strings.Contains(e.ErrorType, ErrTypeInsufficientBalance)
}

// IsRetryable returns true if the error indicates the request can be retried.
func (e *StakeError) IsRetryable() bool {
	return e.IsParallelBet()
}

// IsFatal returns true if the error should stop all betting.
func (e *StakeError) IsFatal() bool {
	return e.IsInsufficientBalance()
}

// HTTPError represents a non-200 HTTP response from the Stake API.
type HTTPError struct {
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("stake: HTTP %d: %s", e.StatusCode, e.Body)
}

// IsRateLimited returns true if the status indicates rate limiting.
func (e *HTTPError) IsRateLimited() bool {
	return e.StatusCode == 429
}

// IsRetryable returns true for rate limits and server errors.
func (e *HTTPError) IsRetryable() bool {
	return e.StatusCode == 429 || e.StatusCode >= 500
}

// AuthError indicates an authentication failure (token expired or invalid).
type AuthError struct {
	StatusCode int
	Message    string
}

func (e *AuthError) Error() string {
	return fmt.Sprintf("stake: authentication failed (HTTP %d): %s", e.StatusCode, e.Message)
}

// CloudflareError indicates Cloudflare challenge/block response.
type CloudflareError struct {
	StatusCode int
	Message    string
}

func (e *CloudflareError) Error() string {
	return fmt.Sprintf("stake: cloudflare challenge/block (HTTP %d): %s", e.StatusCode, e.Message)
}

// TransportError wraps network-level failures before a response is received.
type TransportError struct {
	Err error
}

func (e *TransportError) Error() string {
	return fmt.Sprintf("stake: transport error: %v", e.Err)
}

func (e *TransportError) Unwrap() error {
	return e.Err
}

func (e *TransportError) IsRetryable() bool {
	if e.Err == nil {
		return false
	}
	var netErr net.Error
	if ok := errors.As(e.Err, &netErr); ok && netErr.Timeout() {
		return true
	}
	msg := strings.ToLower(e.Err.Error())
	return strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "temporary") ||
		strings.Contains(msg, "timeout")
}

type ErrorKind string

const (
	ErrorKindUnknown             ErrorKind = "unknown"
	ErrorKindAuth                ErrorKind = "auth"
	ErrorKindCloudflare          ErrorKind = "cloudflare"
	ErrorKindRateOrParallel      ErrorKind = "rate_or_parallel"
	ErrorKindServerTransient     ErrorKind = "server_transient"
	ErrorKindInsufficientBalance ErrorKind = "insufficient_balance"
	ErrorKindUnsupported         ErrorKind = "unsupported"
)

// ClassifyError returns a stable high-level error category for callers.
func ClassifyError(err error) ErrorKind {
	if err == nil {
		return ErrorKindUnknown
	}
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return ErrorKindAuth
	}
	var cfErr *CloudflareError
	if errors.As(err, &cfErr) {
		return ErrorKindCloudflare
	}
	var stakeErr *StakeError
	if errors.As(err, &stakeErr) {
		if stakeErr.IsInsufficientBalance() {
			return ErrorKindInsufficientBalance
		}
		if stakeErr.IsParallelBet() {
			return ErrorKindRateOrParallel
		}
		return ErrorKindUnknown
	}
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.IsRateLimited() {
			return ErrorKindRateOrParallel
		}
		if httpErr.StatusCode >= 500 {
			return ErrorKindServerTransient
		}
		return ErrorKindUnknown
	}
	var transportErr *TransportError
	if errors.As(err, &transportErr) && transportErr.IsRetryable() {
		return ErrorKindServerTransient
	}
	return ErrorKindUnknown
}
