package stakeauth

import (
	"path/filepath"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := NewStore(filepath.Join(dir, "auth.db"))
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	if err := s.Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestStoreSaveListGetDelete(t *testing.T) {
	s := testStore(t)

	acct, err := s.Save(Account{
		Label:    "Main",
		Mirror:   "stake.com",
		Currency: "btc",
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if acct.ID == "" {
		t.Fatal("expected generated ID")
	}
	if acct.ProfileID == "" {
		t.Fatal("expected generated profile ID")
	}
	if acct.ConnectionState != StateNotConfigured {
		t.Fatalf("expected default state %q, got %q", StateNotConfigured, acct.ConnectionState)
	}

	list, err := s.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 account, got %d", len(list))
	}

	got, err := s.Get(acct.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Mirror != "stake.com" || got.Currency != "btc" {
		t.Fatalf("unexpected account: %+v", got)
	}

	updated, err := s.Save(Account{
		ID:              acct.ID,
		Label:           "Renamed",
		Mirror:          "stake.us",
		Currency:        "trx",
		ProfileID:       acct.ProfileID,
		ConnectionState: StateDisconnected,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Label != "Renamed" || updated.Mirror != "stake.us" || updated.Currency != "trx" {
		t.Fatalf("unexpected updated account: %+v", updated)
	}
	if updated.ProfileID != acct.ProfileID || updated.ConnectionState != StateDisconnected {
		t.Fatalf("unexpected updated state fields: %+v", updated)
	}

	if err := s.Delete(acct.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, err = s.List()
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected 0 accounts, got %d", len(list))
	}
}
