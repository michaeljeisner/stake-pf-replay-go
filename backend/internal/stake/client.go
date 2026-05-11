// Package stake provides a Go client for the Stake.com casino API.
//
// The client supports both REST (game betting) and GraphQL (account operations)
// endpoints with automatic retry, rate limit handling, and structured error types.
//
// # Authentication
//
// All requests require a session token extracted from the browser's "session" cookie.
// There is no programmatic token refresh; users must provide a fresh token when
// the current one expires.
//
// # Usage
//
//	client := stake.NewClient(stake.Config{
//	    Domain:       "stake.com",
//	    SessionToken: "your-session-token",
//	    Currency:     "btc",
//	})
//
//	balance, err := client.GetBalance(ctx, "btc")
package stake

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Config holds configuration for the Stake API client.
type Config struct {
	// Domain is the Stake domain to connect to (e.g., "stake.com", "stake.us").
	// Defaults to "stake.com" if empty.
	Domain string

	// SessionToken is the x-access-token value extracted from the browser's
	// "session" cookie. Required for all API calls.
	SessionToken string

	// Currency is the default currency for betting (e.g., "btc", "eth", "usdc").
	Currency string

	// MaxRetries is the maximum number of retry attempts for retryable errors.
	// Defaults to 3 if zero.
	MaxRetries int

	// BaseRetryDelay is the initial delay before the first retry.
	// Defaults to 2 seconds if zero.
	BaseRetryDelay time.Duration

	// MaxRetryDelay caps the exponential backoff delay.
	// Defaults to 10 seconds if zero.
	MaxRetryDelay time.Duration

	// HTTPClient allows injecting a custom HTTP client (useful for testing).
	// Defaults to a client with 30s timeout.
	HTTPClient *http.Client

	// Transport executes prepared HTTP requests. It exists so a future
	// browser-profile-backed transport can share the same Stake client surface.
	Transport RequestTransport

	// UserAgent overrides the User-Agent header. Optional.
	UserAgent string

	// Clearance is the Cloudflare cf_clearance cookie value, if available.
	// Optional but useful for environments where Cloudflare blocks API requests.
	Clearance string
}

// RequestTransport is the narrow request execution surface used by Client.
type RequestTransport interface {
	Do(req *http.Request) (*http.Response, error)
}

// Client is a Stake.com API client.
type Client struct {
	config    Config
	http      *http.Client
	transport RequestTransport
	mu        sync.RWMutex
}

// NewClient creates a new Stake API client with the given configuration.
func NewClient(cfg Config) *Client {
	if cfg.Domain == "" {
		cfg.Domain = "stake.com"
	}
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	}
	if cfg.BaseRetryDelay == 0 {
		cfg.BaseRetryDelay = 2 * time.Second
	}
	if cfg.MaxRetryDelay == 0 {
		cfg.MaxRetryDelay = 10 * time.Second
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	return &Client{
		config:    cfg,
		http:      httpClient,
		transport: firstTransport(cfg.Transport, httpClient),
	}
}

// SetSessionToken updates the session token (thread-safe).
// Call this when the user provides a fresh token.
func (c *Client) SetSessionToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config.SessionToken = token
}

// SessionToken returns the current session token (thread-safe).
func (c *Client) SessionToken() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.config.SessionToken
}

// Domain returns the configured domain.
func (c *Client) Domain() string {
	return c.config.Domain
}

// Currency returns the default currency.
func (c *Client) Currency() string {
	return c.config.Currency
}

// SetCurrency updates the default currency.
func (c *Client) SetCurrency(currency string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config.Currency = currency
}

// --- Core request methods ---

// doRequest sends a single POST request to the Stake API and decodes the response.
func (c *Client) doRequest(ctx context.Context, path string, body any) (*Response, error) {
	base := c.config.Domain
	if !strings.HasPrefix(base, "http://") && !strings.HasPrefix(base, "https://") {
		base = "https://" + base
	}
	url := fmt.Sprintf("%s/%s", strings.TrimRight(base, "/"), strings.TrimPrefix(path, "/"))

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("stake: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("stake: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-access-token", c.SessionToken())
	if c.config.UserAgent != "" {
		req.Header.Set("User-Agent", c.config.UserAgent)
	}
	if c.config.Clearance != "" {
		req.Header.Set("Cookie", fmt.Sprintf("cf_clearance=%s", c.config.Clearance))
	}

	resp, err := c.transport.Do(req)
	if err != nil {
		return nil, &TransportError{Err: err}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("stake: read response: %w", err)
	}

	// Handle non-200 status codes
	if resp.StatusCode == 401 {
		return nil, &AuthError{StatusCode: 401, Message: "session token expired or invalid"}
	}
	trimmed := strings.TrimSpace(string(respBody))
	if (resp.StatusCode == 403 || resp.StatusCode == 503) &&
		(strings.HasPrefix(trimmed, "<!DOCTYPE html") || strings.HasPrefix(trimmed, "<html") || strings.HasPrefix(trimmed, "<")) {
		return nil, &CloudflareError{
			StatusCode: resp.StatusCode,
			Message:    "challenge page received",
		}
	}
	if resp.StatusCode != 200 {
		return nil, &HTTPError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}

	// Parse response envelope.
	// Stake uses two formats:
	// Format 1 (REST): {"diceRoll": {...}} — no data/errors wrapper
	// Format 2 (GraphQL): {"data": {...}} or {"errors": [...]}
	// We need to detect which format and normalize.
	var stakeResp Response

	// First, probe for data/errors keys
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(respBody, &probe); err != nil {
		// Not valid JSON at all
		return nil, fmt.Errorf("stake: invalid response JSON: %w", err)
	}

	if errData, hasErrors := probe["errors"]; hasErrors {
		// Has errors key — parse the errors
		json.Unmarshal(errData, &stakeResp.Errors)
	}

	if dataField, hasData := probe["data"]; hasData {
		// GraphQL format: {"data": {...}}
		stakeResp.Data = dataField
	} else if !stakeResp.HasError() {
		// REST format: the whole body IS the data (e.g., {"diceRoll": {...}})
		stakeResp.Data = respBody
	}

	return &stakeResp, nil
}

// doRequestWithRetry sends a request with automatic retry on retryable errors.
func (c *Client) doRequestWithRetry(ctx context.Context, path string, body any) (*Response, error) {
	var lastErr error

	for attempt := 0; attempt <= c.config.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := c.retryDelay(attempt)
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		resp, err := c.doRequest(ctx, path, body)
		if err != nil {
			lastErr = err

			// Check if the HTTP or transport error is retryable.
			if httpErr, ok := err.(*HTTPError); ok && httpErr.IsRetryable() {
				continue
			}
			if transportErr, ok := err.(*TransportError); ok && transportErr.IsRetryable() {
				continue
			}

			// Auth, Cloudflare, and other non-retryable errors fail immediately.
			return nil, err
		}

		// Check for API-level errors
		if resp.HasError() {
			stakeErr := resp.FirstError()

			// Parallel bet errors are silently retried
			if stakeErr.IsParallelBet() {
				lastErr = stakeErr
				continue
			}

			// All other API errors are returned to the caller to handle
			return resp, nil
		}

		return resp, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("stake: max retries exceeded: %w", lastErr)
	}
	return nil, fmt.Errorf("stake: max retries exceeded")
}

func firstTransport(primary RequestTransport, fallback *http.Client) RequestTransport {
	if primary != nil {
		return primary
	}
	return fallback
}

// retryDelay calculates the backoff delay for a given attempt number.
func (c *Client) retryDelay(attempt int) time.Duration {
	delay := c.config.BaseRetryDelay * time.Duration(math.Pow(2, float64(attempt-1)))
	if delay > c.config.MaxRetryDelay {
		delay = c.config.MaxRetryDelay
	}
	return delay
}

// --- GraphQL helper ---

// graphql sends a GraphQL request and returns the parsed response.
func (c *Client) graphql(ctx context.Context, req *GraphQLRequest) (*Response, error) {
	return c.doRequestWithRetry(ctx, "_api/graphql", req)
}

// --- REST game helper ---

// gameRequest sends a game betting request to a REST endpoint.
func (c *Client) gameRequest(ctx context.Context, path string, body any) (*Response, error) {
	return c.doRequestWithRetry(ctx, path, body)
}

// --- Convenience: extract game data from response ---

// extractGameData handles the two response formats from the Stake API:
// Format 1 (REST): {"diceRoll": {...}}
// Format 2 (GraphQL-wrapped): {"data": {"diceRoll": {...}}}
// This normalizes both into just the inner game object JSON.
func extractGameData(resp *Response, gameKey string) (json.RawMessage, error) {
	if resp.HasError() {
		return nil, resp.FirstError()
	}

	var obj map[string]json.RawMessage
	if err := json.Unmarshal(resp.Data, &obj); err != nil {
		return nil, fmt.Errorf("stake: invalid game response payload: %w", err)
	}

	// Standard REST format: {"diceRoll": {...}}
	if gameData, ok := obj[gameKey]; ok {
		return gameData, nil
	}

	// Defensive fallback for unexpected nested data wrapper.
	if rawData, ok := obj["data"]; ok {
		var nested map[string]json.RawMessage
		if err := json.Unmarshal(rawData, &nested); err == nil {
			if gameData, ok := nested[gameKey]; ok {
				return gameData, nil
			}
		}
	}

	return nil, fmt.Errorf("stake: response missing expected game key %q", gameKey)
}
