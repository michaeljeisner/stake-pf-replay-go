package livestore

import (
	"context"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()

	store, err := New(t.TempDir() + "/livestore.db")
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})
	return store
}

func TestMigrateCreatesAppBetsTable(t *testing.T) {
	store := newTestStore(t)

	var name string
	err := store.db.QueryRowContext(context.Background(), `
		SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_bets'
	`).Scan(&name)
	if err != nil {
		t.Fatalf("app_bets table not created: %v", err)
	}
	if name != "app_bets" {
		t.Fatalf("table name = %q, want app_bets", name)
	}
}

func TestInsertAndListAppBetsFiltersByAccountAndSession(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	placed := time.Date(2026, 5, 10, 23, 15, 0, 0, time.UTC)

	rows := []AppBet{
		{
			AccountID:         "acct-a",
			ScriptSessionID:   "session-a",
			Game:              "LIMBO",
			Currency:          "btc",
			Amount:            1.25,
			Condition:         "above",
			Target:            2,
			Multiplier:        1.5,
			StakeResponseID:   "stake-1",
			StakeResponseHash: "hash-1",
			Payout:            1.875,
			Profit:            0.625,
			CreatedAt:         placed.Add(-time.Second),
			PlacedAt:          placed,
		},
		{
			AccountID:       "acct-a",
			ScriptSessionID: "session-b",
			Game:            "dice",
			Currency:        "eth",
			Amount:          2,
			Condition:       "below",
			Target:          49.5,
			Multiplier:      2,
			ErrorKind:       "STAKE_LIMIT",
			CreatedAt:       placed.Add(time.Second),
			PlacedAt:        placed.Add(2 * time.Second),
		},
		{
			AccountID:       "acct-b",
			ScriptSessionID: "session-a",
			Game:            "plinko",
			Currency:        "usdt",
			Amount:          3,
			Condition:       "risk",
			Target:          8,
			Multiplier:      0,
			ErrorKind:       "network",
			CreatedAt:       placed.Add(3 * time.Second),
			PlacedAt:        placed.Add(4 * time.Second),
		},
	}
	for _, row := range rows {
		if err := store.InsertAppBet(ctx, row); err != nil {
			t.Fatalf("InsertAppBet() error = %v", err)
		}
	}

	got, total, err := store.ListAppBets(ctx, "acct-a", "session-a", 10, 0)
	if err != nil {
		t.Fatalf("ListAppBets() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].AccountID != "acct-a" || got[0].ScriptSessionID != "session-a" {
		t.Fatalf("got row account/session = %q/%q", got[0].AccountID, got[0].ScriptSessionID)
	}
	if got[0].ID == 0 {
		t.Fatal("inserted app bet ID was not populated in query result")
	}
	if got[0].Game != "limbo" || got[0].Currency != "btc" {
		t.Fatalf("normalized game/currency = %q/%q, want limbo/btc", got[0].Game, got[0].Currency)
	}

	errorRows, total, err := store.ListAppBets(ctx, "acct-a", "session-b", 10, 0)
	if err != nil {
		t.Fatalf("ListAppBets(error row) error = %v", err)
	}
	if total != 1 || len(errorRows) != 1 {
		t.Fatalf("error rows total/len = %d/%d, want 1/1", total, len(errorRows))
	}
	if errorRows[0].ErrorKind != "stake_limit" {
		t.Fatalf("error kind = %q, want stake_limit", errorRows[0].ErrorKind)
	}

	all, total, err := store.ListAppBets(ctx, "", "", 10, 0)
	if err != nil {
		t.Fatalf("ListAppBets(all) error = %v", err)
	}
	if total != int64(len(rows)) || len(all) != len(rows) {
		t.Fatalf("all rows total/len = %d/%d, want %d/%d", total, len(all), len(rows), len(rows))
	}
}

func TestInsertAppBetPreservesSweepsAndGoldCurrency(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	now := time.Date(2026, 5, 10, 23, 20, 0, 0, time.UTC)

	for _, currency := range []string{"sweeps", "GOLD"} {
		if err := store.InsertAppBet(ctx, AppBet{
			AccountID:       "acct",
			ScriptSessionID: "session",
			Game:            "DICE",
			Currency:        currency,
			Amount:          1,
			Condition:       "above",
			Target:          50,
			Multiplier:      2,
			CreatedAt:       now,
			PlacedAt:        now,
		}); err != nil {
			t.Fatalf("InsertAppBet(%q) error = %v", currency, err)
		}
	}

	got, total, err := store.ListAppBets(ctx, "acct", "session", 10, 0)
	if err != nil {
		t.Fatalf("ListAppBets() error = %v", err)
	}
	if total != 2 || len(got) != 2 {
		t.Fatalf("total/len = %d/%d, want 2/2", total, len(got))
	}
	seen := map[string]bool{}
	for _, row := range got {
		seen[row.Currency] = true
	}
	if !seen["SWEEPS"] || !seen["GOLD"] {
		t.Fatalf("currencies = %#v, want SWEEPS and GOLD", seen)
	}
}
