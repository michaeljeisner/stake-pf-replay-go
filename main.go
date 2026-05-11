package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	// Existing bindings (backend module)
	"github.com/MJE43/stake-pf-replay-go/bindings"

	// Live-ingest module (this repo, root module)
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/livehttp"
)

//go:embed all:frontend/dist
var assets embed.FS

const (
	appConfigDirName    = "wen-desktop"
	legacyConfigDirName = "stake-pf-replay-go-desktop" // migrate from old name
	liveIngestDBName    = "live_ingest.db"
	docsURL             = "https://github.com/MJE43/stake-pf-replay-go/blob/main/README.md"
	repoURL             = "https://github.com/MJE43/stake-pf-replay-go"
)

var (
	appCtx   context.Context
	appCtxMu sync.RWMutex
)

// buildWindowsOptions configures Windows-specific application settings
func buildWindowsOptions() *windows.Options {
	return &windows.Options{
		// Modern Windows 11 Mica backdrop effect
		BackdropType: windows.Mica,

		// Theme Settings
		Theme: windows.SystemDefault,

		// Custom theme colors for light/dark mode - monochrome palette
		CustomTheme: &windows.ThemeSettings{
			// Dark mode (deep black)
			DarkModeTitleBar:  windows.RGB(10, 10, 10),
			DarkModeTitleText: windows.RGB(250, 250, 250),
			DarkModeBorder:    windows.RGB(46, 46, 46),

			// Light mode
			LightModeTitleBar:  windows.RGB(250, 250, 250),
			LightModeTitleText: windows.RGB(23, 23, 23),
			LightModeBorder:    windows.RGB(217, 217, 217),
		},

		// WebView Configuration
		WebviewIsTransparent: false,
		WindowIsTranslucent:  false,

		// DPI and Zoom
		DisablePinchZoom:     false,
		IsZoomControlEnabled: false,
		ZoomFactor:           1.0,

		// Window Decorations
		DisableWindowIcon:                 false,
		DisableFramelessWindowDecorations: false,

		// Window Class Name
		WindowClassName: "WENWindow",

		// Power Management Callbacks
		OnSuspend: func() {
			log.Println("Windows entering low power mode")
		},
		OnResume: func() {
			log.Println("Windows resuming from low power mode")
		},
	}
}

// buildMacOptions configures macOS-specific application settings
func buildMacOptions() *mac.Options {
	// Load icon for About dialog
	iconData, err := assets.ReadFile("frontend/dist/assets/logo.png")
	var aboutIcon []byte
	if err == nil {
		aboutIcon = iconData
	}

	return &mac.Options{
		// Title Bar Configuration
		TitleBar: &mac.TitleBar{
			TitlebarAppearsTransparent: false,
			HideTitle:                  false,
			HideTitleBar:               false,
			FullSizeContent:            false,
			UseToolbar:                 false,
			HideToolbarSeparator:       true,
		},

		// Appearance - Follow system theme
		WebviewIsTransparent: false,
		WindowIsTranslucent:  false,

		// About Dialog
		About: &mac.AboutInfo{
			Title: "WEN?",
			Message: "A privacy-focused desktop application for analyzing provable fairness.\n\n" +
				"© 2024-2025 Michael Eisner\n" +
				"Built with Wails\n\n" +
				"This application processes all data locally and never transmits server seeds over the network.",
			Icon: aboutIcon,
		},
	}
}

// buildLinuxOptions configures Linux-specific application settings
func buildLinuxOptions() *linux.Options {
	// Load icon for window manager
	iconData, err := assets.ReadFile("frontend/dist/assets/logo.png")
	var windowIcon []byte
	if err == nil {
		windowIcon = iconData
	}

	return &linux.Options{
		// Window Icon
		Icon: windowIcon,

		// WebView Configuration
		WindowIsTranslucent: false,
		WebviewGpuPolicy:    linux.WebviewGpuPolicyAlways,

		// Program Name for window managers
		ProgramName: "wen",
	}
}

func main() {
	log.Printf("Starting WEN? (Go %s)...", runtime.Version())
	dataDir := ensureAppDataDir()

	// Existing backend bindings object
	app := bindings.New()

	// Stake account/auth module (multi-account + keyring + connection checks)
	authDBPath := filepath.Join(dataDir, "auth.db")
	authMod, err := bindings.NewAuthModule(authDBPath, bindings.DefaultFallbackSecretsPath(dataDir))
	if err != nil {
		log.Fatalf("auth module init failed: %v", err)
	}

	// Live ingest module wiring
	dbPath := defaultLiveDBPath()
	port := envInt("LIVE_INGEST_PORT", 17888)
	token := os.Getenv("LIVE_INGEST_TOKEN") // optional; when empty, no auth
	liveMod, err := livehttp.NewLiveModule(dbPath, port, token)
	if err != nil {
		log.Fatalf("live module init failed: %v", err)
	}

	// Scripting engine module
	scriptMod := bindings.NewScriptModuleWithAppBetSink(authMod, livehttp.NewAppBetSink(liveMod))

	// Initialize script session store
	scriptDBPath := filepath.Join(dataDir, "script_sessions.db")
	if err := scriptMod.InitStore(scriptDBPath); err != nil {
		log.Printf("script store init failed (continuing without persistence): %v", err)
	}

	startup := func(ctx context.Context) {
		// Start existing app
		app.Startup(ctx)
		authMod.Startup(ctx)
		scriptMod.Startup(ctx)
		setAppContext(ctx)

		// Start local HTTP ingest server
		if err := liveMod.Startup(ctx); err != nil {
			log.Printf("live ingest server failed to start: %v", err)
		} else {
			info := liveMod.IngestInfo()
			log.Printf("Live ingest ready at %s (token enabled: %v)", info.URL, info.TokenEnabled)
		}
	}

	beforeClose := func(ctx context.Context) (prevent bool) {
		// Graceful shutdown of live module
		if err := liveMod.Shutdown(ctx); err != nil {
			log.Printf("live module shutdown error: %v", err)
		}
		if err := authMod.Shutdown(); err != nil {
			log.Printf("auth module shutdown error: %v", err)
		}
		clearAppContext()
		log.Println("Application is closing")
		return false
	}

	if err := wails.Run(&options.App{
		// Window Configuration
		Title:             "WEN?",
		Width:             1280,
		Height:            800,
		MinWidth:          1024,
		MinHeight:         768,
		MaxWidth:          2560,
		MaxHeight:         1440,
		WindowStartState:  options.Normal,
		Frameless:         false,
		DisableResize:     false,
		Fullscreen:        false,
		StartHidden:       false,
		HideWindowOnClose: false,
		AlwaysOnTop:       false,
		BackgroundColour:  &options.RGBA{R: 10, G: 10, B: 10, A: 255},

		// Asset Server
		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		// Application Lifecycle
		OnStartup:     startup,
		OnBeforeClose: beforeClose,
		OnDomReady: func(ctx context.Context) {
			log.Println("DOM is ready")
		},
		OnShutdown: func(ctx context.Context) {
			log.Println("Application shutdown complete")
		},

		// Menu
		Menu: buildAppMenu(),

		// Bindings
		Bind: []interface{}{app, liveMod, scriptMod, authMod},

		// Logging
		LogLevel:           logger.INFO,
		LogLevelProduction: logger.ERROR,

		// User Experience
		EnableDefaultContextMenu:         false,
		EnableFraudulentWebsiteDetection: false,

		// Error Handling
		ErrorFormatter: func(err error) any {
			if err == nil {
				return nil
			}
			return err.Error()
		},

		// Single Instance Lock - prevents multiple app instances
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "c9f3d4e5-8a2b-4c6d-9e1f-wen-desktop",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				log.Printf("Second instance launch prevented. Args: %v", data.Args)
			},
		},

		// Drag and Drop Configuration
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     false, // Disable for security - app doesn't need file drops
			DisableWebViewDrop: true,
		},

		// Platform-Specific Options
		Windows: buildWindowsOptions(),
		Mac:     buildMacOptions(),
		Linux:   buildLinuxOptions(),
	}); err != nil {
		log.Printf("Error running Wails app: %v", err)
		fmt.Printf("Error: %v\n", err)
		panic(err)
	}

	log.Println("Application exited normally")
}

func defaultLiveDBPath() string {
	base := ensureAppDataDir()
	target := filepath.Join(base, liveIngestDBName)

	if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
		if legacy := legacyLiveDBPath(); legacy != "" && legacy != target {
			if err := os.Rename(legacy, target); err != nil {
				log.Printf("live ingest DB migration from %s failed: %v; using legacy path", legacy, err)
				return legacy
			}
			log.Printf("migrated live ingest DB from %s to %s", legacy, target)
		}
	}

	return target
}

func ensureAppDataDir() string {
	base := appDataDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		log.Printf("appdata mkdir failed for %s: %v; using local fallback", base, err)
		return "."
	}
	return base
}

// appDataDir returns an OS-appropriate writable directory.
func appDataDir() string {
	if d, err := os.UserConfigDir(); err == nil && d != "" {
		return filepath.Join(d, appConfigDirName)
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, "."+appConfigDirName)
	}
	return "."
}

func legacyLiveDBPath() string {
	for _, dir := range legacyAppDataDirs() {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, liveIngestDBName)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	fallback := filepath.Join(".", liveIngestDBName)
	if _, err := os.Stat(fallback); err == nil {
		return fallback
	}

	return ""
}

func legacyAppDataDirs() []string {
	var dirs []string

	if d, err := os.UserConfigDir(); err == nil && d != "" {
		dirs = append(dirs, filepath.Join(d, legacyConfigDirName))
	}

	if h, err := os.UserHomeDir(); err == nil && h != "" {
		dirs = append(dirs, filepath.Join(h, "."+legacyConfigDirName))
	}

	return dirs
}

func envInt(k string, def int) int {
	if s := os.Getenv(k); s != "" {
		var v int
		if _, err := fmt.Sscanf(s, "%d", &v); err == nil {
			return v
		}
	}
	return def
}

func buildAppMenu() *menu.Menu {
	rootMenu := menu.NewMenu()

	if runtime.GOOS == "darwin" {
		if appMenu := menu.AppMenu(); appMenu != nil {
			rootMenu.Append(appMenu)
		}
	}

	fileMenu := menu.NewMenu()
	fileMenu.AddText("Open Data Directory", keys.CmdOrCtrl("o"), func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			openPathInExplorer(ctx, appDataDir())
		})
	})
	fileMenu.AddSeparator()
	fileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			wruntime.Quit(ctx)
		})
	})
	rootMenu.Append(menu.SubMenu("File", fileMenu))

	viewMenu := menu.NewMenu()
	viewMenu.AddText("Reload Frontend", keys.CmdOrCtrl("r"), func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			wruntime.WindowReloadApp(ctx)
		})
	})
	viewMenu.AddText("Toggle Fullscreen", keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			toggleFullscreen(ctx)
		})
	})
	rootMenu.Append(menu.SubMenu("View", viewMenu))

	helpMenu := menu.NewMenu()
	helpMenu.AddText("Documentation", nil, func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			wruntime.BrowserOpenURL(ctx, docsURL)
		})
	})
	helpMenu.AddText("Project Repository", nil, func(_ *menu.CallbackData) {
		withAppContext(func(ctx context.Context) {
			wruntime.BrowserOpenURL(ctx, repoURL)
		})
	})
	rootMenu.Append(menu.SubMenu("Help", helpMenu))

	return rootMenu
}

func openPathInExplorer(ctx context.Context, path string) {
	if path == "" {
		return
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		log.Printf("resolve path %s failed: %v", path, err)
		abs = path
	}

	wruntime.BrowserOpenURL(ctx, fileURI(abs))
}

func fileURI(path string) string {
	clean := filepath.ToSlash(path)
	if runtime.GOOS == "windows" && len(clean) > 0 && clean[0] != '/' {
		clean = "/" + clean
	}

	u := url.URL{Scheme: "file", Path: clean}
	return u.String()
}

func toggleFullscreen(ctx context.Context) {
	if wruntime.WindowIsFullscreen(ctx) {
		wruntime.WindowUnfullscreen(ctx)
		return
	}
	wruntime.WindowFullscreen(ctx)
}

func setAppContext(ctx context.Context) {
	appCtxMu.Lock()
	defer appCtxMu.Unlock()
	appCtx = ctx
}

func clearAppContext() {
	appCtxMu.Lock()
	defer appCtxMu.Unlock()
	appCtx = nil
}

func withAppContext(action func(context.Context)) {
	appCtxMu.RLock()
	ctx := appCtx
	appCtxMu.RUnlock()
	if ctx == nil {
		log.Println("application context not initialised; ignoring menu action")
		return
	}
	action(ctx)
}

// Notes:
//
// * The `Bind` list now includes `liveMod`, so the frontend can call its methods directly. This matches how Wails bindings work in your repo’s current `main.go`, with minimal changes.&#x20;
// * Ensure the import path for the live module matches your root module name (`github.com/MJE43/stake-pf-replay-go-desktop`). If your module name differs, adjust the import.
