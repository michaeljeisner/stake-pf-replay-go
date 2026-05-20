package stakeclient

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type fakeTransport struct {
	mu       sync.Mutex
	requests []string
}

func (t *fakeTransport) Do(req *http.Request) (*http.Response, error) {
	t.mu.Lock()
	t.requests = append(t.requests, req.URL.Path)
	t.mu.Unlock()

	body := `{"data":{"user":{"balances":[{"available":{"amount":"1.25","currency":"btc"},"vault":{"amount":"0","currency":"btc"}}]}}}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
		Request:    req,
	}, nil
}

func TestNewRequiresBrowserTransportUnlessFallbackExplicit(t *testing.T) {
	_, err := New(Config{
		AccountID: "acct-1",
		APIKey:    "key",
		Currency:  "btc",
	})
	if err == nil {
		t.Fatal("expected missing transport error")
	}
	if !strings.Contains(err.Error(), "browser-backed transport") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUserBalancesUsesInjectedTransport(t *testing.T) {
	transport := &fakeTransport{}
	facade, err := New(Config{
		AccountID: "acct-1",
		Domain:    "https://stake.test",
		APIKey:    "key",
		Currency:  "btc",
		Transport: transport,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	balances, err := facade.UserBalances(context.Background())
	if err != nil {
		t.Fatalf("UserBalances: %v", err)
	}
	if len(balances) != 1 || balances[0].Available.Currency != "btc" {
		t.Fatalf("unexpected balances: %#v", balances)
	}
	if len(transport.requests) != 1 || transport.requests[0] != "/_api/graphql" {
		t.Fatalf("unexpected transport requests: %#v", transport.requests)
	}
}
