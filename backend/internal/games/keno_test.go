package games

import (
	"testing"

	"github.com/MJE43/stake-pf-replay-go/internal/engine"
)

func TestKenoDrawsMatchStake(t *testing.T) {
	serverSeed := "fb30c5e2bbd8537b76c6df8e8e86533121cbeeae0bda9d306117147e656ad46e"
	clientSeed := "56e27fed-ece3-4279-ab56-96f71fe9b2ee"
	nonce := uint64(1)

	// Expected draws from the documented shrinking-pool translation.
	// EvaluateDrawOnly returns 0-based board indices; the Stake UI displays
	// these values as +1.
	expected := []int{7, 2, 16, 39, 9, 14, 1, 0, 35, 15}
	expectedDisplay := []int{8, 3, 17, 40, 10, 15, 2, 1, 36, 16}

	game := &KenoGame{}
	seeds := Seeds{Server: serverSeed, Client: clientSeed}

	// Debug: Print the raw floats
	floats := engine.Floats(serverSeed, clientSeed, nonce, 0, 10)
	t.Logf("Floats: %v", floats)

	// The engine returns 0-based board indices directly.
	draws := game.EvaluateDrawOnly(seeds, nonce)
	drawsDisplay := make([]int, len(draws))
	for i, draw := range draws {
		drawsDisplay[i] = draw + 1
	}

	t.Logf("Our draws: %v", draws)
	t.Logf("Expected:  %v", expected)
	t.Logf("Display:   %v", drawsDisplay)

	if len(draws) != len(expected) {
		t.Fatalf("Expected %d draws, got %d", len(expected), len(draws))
	}
	for i := range expected {
		if draws[i] != expected[i] {
			t.Errorf("draw[%d] = %d, want %d", i, draws[i], expected[i])
		}
	}
	for i := range expectedDisplay {
		if drawsDisplay[i] != expectedDisplay[i] {
			t.Errorf("display draw[%d] = %d, want %d", i, drawsDisplay[i], expectedDisplay[i])
		}
	}
}
