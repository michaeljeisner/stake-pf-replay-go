package livehttp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/MJE43/stake-pf-replay-go-desktop/internal/livestore"
)

func TestHeartbeatRetentionKeepsRecentRoundsAndNonceTruth(t *testing.T) {
	store := newTestStore(t)
	server := New(store, 0, "", nil)
	server.roundRetention = 3
	server.roundCleanupInterval = 1

	var streamID string
	for nonce := 1; nonce <= 5; nonce++ {
		body := map[string]any{
			"type":             "heartbeat",
			"nonce":            nonce,
			"roundResult":      float64(nonce) * 10,
			"clientSeed":       "client-a",
			"serverSeedHashed": "hash-a",
		}
		status, payload := postIngest(t, server, body)
		if status != http.StatusOK {
			t.Fatalf("heartbeat %d status = %d, payload = %s", nonce, status, payload)
		}
		if streamID == "" {
			var decoded struct {
				StreamID string `json:"streamId"`
			}
			if err := json.Unmarshal(payload, &decoded); err != nil {
				t.Fatalf("decode ingest response: %v", err)
			}
			streamID = decoded.StreamID
		}
	}

	id := mustParseUUID(t, streamID)
	rounds, err := store.GetRecentRounds(context.Background(), id, 10)
	if err != nil {
		t.Fatalf("GetRecentRounds: %v", err)
	}
	if len(rounds) != 3 {
		t.Fatalf("round count = %d, want 3", len(rounds))
	}
	gotNonces := []int64{rounds[0].Nonce, rounds[1].Nonce, rounds[2].Nonce}
	wantNonces := []int64{5, 4, 3}
	for i := range wantNonces {
		if gotNonces[i] != wantNonces[i] {
			t.Fatalf("round nonces = %v, want %v", gotNonces, wantNonces)
		}
	}

	stream, err := store.GetStream(context.Background(), id)
	if err != nil {
		t.Fatalf("GetStream: %v", err)
	}
	if stream.LastObservedNonce != 5 {
		t.Fatalf("last observed nonce = %d, want 5", stream.LastObservedNonce)
	}
}

func TestRoundsEndpointAllowsDashboardScaleHistory(t *testing.T) {
	store := newTestStore(t)
	server := New(store, 0, "", nil)

	streamID, err := store.FindOrCreateStream(context.Background(), "hash-b", "client-b")
	if err != nil {
		t.Fatalf("FindOrCreateStream: %v", err)
	}
	for nonce := 1; nonce <= 1500; nonce++ {
		if err := store.InsertRound(context.Background(), streamID, int64(nonce), 1.23); err != nil {
			t.Fatalf("InsertRound %d: %v", nonce, err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/live/streams/"+streamID.String()+"/rounds?limit=1500", nil)
	rec := httptest.NewRecorder()
	server.handleStreamSubroutes(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("rounds status = %d, payload = %s", rec.Code, rec.Body.String())
	}
	var decoded struct {
		Rows []livestore.LiveRound `json:"rows"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode rounds response: %v", err)
	}
	if len(decoded.Rows) != 1500 {
		t.Fatalf("rounds returned = %d, want 1500", len(decoded.Rows))
	}
}

func newTestStore(t *testing.T) *livestore.Store {
	t.Helper()
	store, err := livestore.New(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatalf("livestore.New: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func postIngest(t *testing.T, server *Server, body map[string]any) (int, []byte) {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/live/ingest", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.handleIngest(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func mustParseUUID(t *testing.T, id string) uuid.UUID {
	t.Helper()
	parsed, err := uuid.Parse(id)
	if err != nil {
		t.Fatalf("parse stream id: %v", err)
	}
	return parsed
}
