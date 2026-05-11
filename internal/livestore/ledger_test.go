package livestore

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestRecordLedgerEntryIsIdempotent(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	first, err := store.RecordLedgerEntry(ctx, LedgerEntry{
		AccountID:        "acct-1",
		Source:           "app",
		Game:             "dice",
		ExternalBetID:    "bet-1",
		IdempotencyKey:   "dice:acct-1:abc",
		Currency:         "btc",
		Nonce:            42,
		Amount:           0.001,
		Payout:           0.002,
		PayoutMultiplier: 2,
		RequestJSON:      `{"target":50}`,
		ResponseJSON:     `{"id":"bet-1"}`,
		CreatedAt:        time.Date(2026, 5, 11, 8, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RecordLedgerEntry first: %v", err)
	}

	second, err := store.RecordLedgerEntry(ctx, LedgerEntry{
		AccountID:      "acct-1",
		Source:         "app",
		Game:           "dice",
		IdempotencyKey: "dice:acct-1:abc",
		Currency:       "btc",
		Nonce:          43,
		Amount:         9,
		Payout:         0,
		CreatedAt:      time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RecordLedgerEntry duplicate: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("duplicate produced id %d, want existing id %d", second.ID, first.ID)
	}
	if second.Nonce != 42 || second.Amount != 0.001 {
		t.Fatalf("duplicate mutated existing entry: %#v", second)
	}

	entries, err := store.ListLedgerEntries(ctx, "acct-1", 10, 0)
	if err != nil {
		t.Fatalf("ListLedgerEntries: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("entry count = %d, want 1", len(entries))
	}
}

func TestRecordLedgerEntryValidatesRequiredFields(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.RecordLedgerEntry(context.Background(), LedgerEntry{
		Source:         "app",
		Game:           "limbo",
		IdempotencyKey: "k",
	})
	if err == nil {
		t.Fatal("expected account id validation error")
	}
}

func TestSyncHistoryEntriesNormalizesAndCountsDuplicates(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	entries := []LedgerEntry{
		{
			Game:             "Dice",
			ExternalBetID:    "stake-bet-1",
			Currency:         "BTC",
			Nonce:            101,
			Amount:           0.001,
			Payout:           0,
			PayoutMultiplier: 0,
			ResponseJSON:     `{"id":"stake-bet-1"}`,
			CreatedAt:        time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC),
		},
		{
			Game:             "Dice",
			ExternalBetID:    "stake-bet-1",
			Currency:         "BTC",
			Nonce:            999,
			Amount:           9,
			Payout:           9,
			PayoutMultiplier: 1,
			CreatedAt:        time.Date(2026, 5, 11, 10, 0, 0, 0, time.UTC),
		},
	}

	result, err := store.SyncHistoryEntries(ctx, " acct-1 ", entries)
	if err != nil {
		t.Fatalf("SyncHistoryEntries: %v", err)
	}
	if result.Inserted != 1 || result.Duplicates != 1 {
		t.Fatalf("counts = inserted %d duplicate %d, want 1/1", result.Inserted, result.Duplicates)
	}
	if len(result.Entries) != 2 {
		t.Fatalf("entries len = %d, want 2", len(result.Entries))
	}
	if result.Entries[0].Source != "history" || result.Entries[0].AccountID != "acct-1" {
		t.Fatalf("entry not normalized: %#v", result.Entries[0])
	}
	if result.Entries[0].Game != "dice" || result.Entries[0].Currency != "btc" {
		t.Fatalf("entry game/currency not normalized: %#v", result.Entries[0])
	}
	if result.Entries[0].IdempotencyKey != "history:acct-1:dice:stake-bet-1" {
		t.Fatalf("idempotency key = %q", result.Entries[0].IdempotencyKey)
	}
	if result.Entries[1].ID != result.Entries[0].ID {
		t.Fatalf("duplicate did not return existing entry: %#v", result.Entries)
	}

	list, err := store.ListLedgerEntries(ctx, "acct-1", 10, 0)
	if err != nil {
		t.Fatalf("ListLedgerEntries: %v", err)
	}
	if len(list) != 1 || list[0].Nonce != 101 {
		t.Fatalf("unexpected ledger list: %#v", list)
	}
}

func TestSyncHistoryEntriesRequiresStableIdentity(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.SyncHistoryEntries(context.Background(), "acct-1", []LedgerEntry{{
		Game:      "limbo",
		Currency:  "btc",
		CreatedAt: time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC),
	}})
	if err == nil {
		t.Fatal("expected missing idempotency key error")
	}
}

func TestGetLedgerSummaryAggregatesByGameAndSource(t *testing.T) {
	store, err := New(filepath.Join(t.TempDir(), "ledger.db"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	for _, entry := range []LedgerEntry{
		{
			AccountID:      "acct-1",
			Source:         "history",
			Game:           "dice",
			IdempotencyKey: "h1",
			Currency:       "btc",
			Nonce:          10,
			Amount:         1,
			Payout:         2,
			CreatedAt:      time.Date(2026, 5, 11, 9, 0, 0, 0, time.UTC),
		},
		{
			AccountID:      "acct-1",
			Source:         "history",
			Game:           "dice",
			IdempotencyKey: "h2",
			Currency:       "btc",
			Nonce:          11,
			Amount:         1,
			Payout:         0,
			CreatedAt:      time.Date(2026, 5, 11, 9, 1, 0, 0, time.UTC),
		},
		{
			AccountID:      "acct-1",
			Source:         "app",
			Game:           "limbo",
			IdempotencyKey: "a1",
			Currency:       "btc",
			Nonce:          7,
			Amount:         3,
			Payout:         6,
			CreatedAt:      time.Date(2026, 5, 11, 9, 2, 0, 0, time.UTC),
		},
		{
			AccountID:      "acct-2",
			Source:         "history",
			Game:           "dice",
			IdempotencyKey: "other",
			Currency:       "btc",
			Nonce:          1,
			Amount:         100,
			Payout:         200,
			CreatedAt:      time.Date(2026, 5, 11, 9, 3, 0, 0, time.UTC),
		},
	} {
		if _, err := store.RecordLedgerEntry(ctx, entry); err != nil {
			t.Fatalf("RecordLedgerEntry: %v", err)
		}
	}

	summary, err := store.GetLedgerSummary(ctx, "acct-1")
	if err != nil {
		t.Fatalf("GetLedgerSummary: %v", err)
	}
	if summary.Count != 3 || summary.Wagered != 5 || summary.Payout != 8 || summary.Profit != 3 || summary.WinCount != 2 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if summary.ROI != 0.6 {
		t.Fatalf("roi = %v, want 0.6", summary.ROI)
	}
	if len(summary.ByGame) != 2 {
		t.Fatalf("group count = %d, want 2: %#v", len(summary.ByGame), summary.ByGame)
	}
	if summary.ByGame[0].Game != "dice" || summary.ByGame[0].Source != "history" || summary.ByGame[0].LastNonce != 11 {
		t.Fatalf("unexpected first group: %#v", summary.ByGame[0])
	}
}
