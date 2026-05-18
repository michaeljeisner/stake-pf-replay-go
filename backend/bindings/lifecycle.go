package bindings

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	"github.com/MJE43/stake-pf-replay-go/internal/store"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	ctx           context.Context
	db            store.DB
	runCancels    map[string]context.CancelFunc
	runCancelsMux sync.RWMutex
}

func New() *App {
	return &App{
		runCancels: make(map[string]context.CancelFunc),
	}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = "."
	}

	appDir := filepath.Join(configDir, "stake-pf-replay-go-desktop")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		panic(err)
	}

	dbPath := filepath.Join(appDir, "pf-replay.db")
	db, err := store.NewSQLiteDB(dbPath)
	if err != nil {
		panic(err)
	}
	a.db = db

	if err := a.db.Migrate(); err != nil {
		panic(err)
	}
}

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.Startup(ctx)
	return nil
}
