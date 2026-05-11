package accountconnect

import (
	"path/filepath"
	"testing"
)

func TestAccountConnectFacadeCreatesModule(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	if err := store.Migrate(); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	keyring := NewKeyringStore("wen-desktop-accountconnect-test", filepath.Join(t.TempDir(), "fallback.json"))
	mod := NewModule(store, keyring)
	if mod == nil {
		t.Fatal("NewModule returned nil")
	}
	if got := mod.ActiveConnectionState(); got != StateDisconnected {
		t.Fatalf("initial state = %q, want %q", got, StateDisconnected)
	}
}
