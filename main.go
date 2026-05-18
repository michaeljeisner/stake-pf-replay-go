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

	"github.com/wailsapp/wails/v3/pkg/application"

	// Existing bindings (backend module)
	"github.com/MJE43/stake-pf-replay-go/bindings"

	// Live-ingest module (this repo, root module)
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/livehttp"
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/livestore"
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

func main() {
	log.Printf("Starting WEN? (Go %s)...", runtime.Version())
	dataDir := ensureAppDataDir()

	appSvc := bindings.New()

	authDBPath := filepath.Join(dataDir, "auth.db")
	authMod, err := bindings.NewAuthModule(authDBPath, bindings.DefaultFallbackSecretsPath(dataDir))
	if err != nil {
		log.Fatalf("auth module init failed: %v", err)
	}

	dbPath := defaultLiveDBPath()
	port := envInt("LIVE_INGEST_PORT", 17888)
	token := os.Getenv("LIVE_INGEST_TOKEN")
	liveMod, err := livehttp.NewLiveModule(dbPath, port, token)
	if err != nil {
		log.Fatalf("live module init failed: %v", err)
	}
	scriptMod := bindings.NewScriptModuleWithLedger(authMod, liveLedgerRecorder{mod: liveMod})

	scriptDBPath := filepath.Join(dataDir, "script_sessions.db")
	if err := scriptMod.InitStore(scriptDBPath); err != nil {
		log.Printf("script store init failed (continuing without persistence): %v", err)
	}

	icon := readAsset("frontend/dist/assets/logo.png")
	app := application.New(application.Options{
		Name:        "WEN?",
		Description: "A privacy-focused desktop application for analyzing provable fairness.",
		Icon:        icon,
		Services: []application.Service{
			application.NewService(appSvc),
			application.NewService(liveMod),
			application.NewService(scriptMod),
			application.NewService(authMod),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Windows: application.WindowsOptions{
			WndClass:              "WENWindow",
			WebviewUserDataPath:   filepath.Join(dataDir, "webview"),
			DisabledFeatures:      []string{"AutofillServerCommunication"},
			AdditionalBrowserArgs: []string{"--disable-features=msWebOOUI,msPdfOOUI"},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			ProgramName: "wen",
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "c9f3d4e5-8a2b-4c6d-9e1f-wen-desktop",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				log.Printf("Second instance launch prevented. Args: %v", data.Args)
			},
		},
		MarshalError: func(err error) []byte {
			if err == nil {
				return nil
			}
			return []byte(fmt.Sprintf("%q", err.Error()))
		},
		ShouldQuit: func() bool {
			log.Println("Application is closing")
			return true
		},
		OnShutdown: func() {
			log.Println("Application shutdown complete")
		},
		ErrorHandler: func(err error) {
			if err != nil {
				log.Printf("Wails application error: %v", err)
			}
		},
	})

	authMod.SetApplication(app)
	liveMod.SetApplication(app)

	app.Menu.Set(buildAppMenu(app))

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:                      "WEN?",
		Width:                      1280,
		Height:                     800,
		MinWidth:                   1024,
		MinHeight:                  768,
		MaxWidth:                   2560,
		MaxHeight:                  1440,
		StartState:                 application.WindowStateNormal,
		Frameless:                  false,
		DisableResize:              false,
		AlwaysOnTop:                false,
		BackgroundColour:           application.NewRGBA(10, 10, 10, 255),
		URL:                        "/",
		Zoom:                       1.0,
		ZoomControlEnabled:         false,
		EnableFileDrop:             false,
		DefaultContextMenuDisabled: true,
		UseApplicationMenu:         true,
		Windows:                    buildWindowsWindowOptions(),
		Mac:                        buildMacWindowOptions(),
		Linux:                      buildLinuxWindowOptions(),
	})

	if err := app.Run(); err != nil {
		log.Printf("Error running Wails app: %v", err)
		fmt.Printf("Error: %v\n", err)
		panic(err)
	}

	log.Println("Application exited normally")
}

type liveLedgerRecorder struct {
	mod *livehttp.LiveModule
}

func (r liveLedgerRecorder) RecordLedgerEntry(_ context.Context, entry bindings.LedgerEntry) error {
	if r.mod == nil {
		return nil
	}
	_, err := r.mod.RecordLedgerEntry(livestore.LedgerEntry{
		AccountID:        entry.AccountID,
		Source:           entry.Source,
		Game:             entry.Game,
		ExternalBetID:    entry.ExternalBetID,
		IdempotencyKey:   entry.IdempotencyKey,
		Currency:         entry.Currency,
		Nonce:            entry.Nonce,
		Amount:           entry.Amount,
		Payout:           entry.Payout,
		PayoutMultiplier: entry.PayoutMultiplier,
		RequestJSON:      entry.RequestJSON,
		ResponseJSON:     entry.ResponseJSON,
		CreatedAt:        entry.CreatedAt,
	})
	return err
}

func buildWindowsWindowOptions() application.WindowsWindow {
	return application.WindowsWindow{
		BackdropType:                      application.Mica,
		Theme:                             application.SystemDefault,
		DisableIcon:                       false,
		DisableFramelessWindowDecorations: false,
		GeneralAutofillEnabled:            false,
		PasswordAutosaveEnabled:           false,
		CustomTheme:                       buildWindowsThemeSettings(),
		ResizeDebounceMS:                  0,
		WindowDidMoveDebounceMS:           0,
		Permissions:                       nil,
		Menu:                              nil,
	}
}

func buildWindowsThemeSettings() application.ThemeSettings {
	darkTitle := application.NewRGBPtr(10, 10, 10)
	darkText := application.NewRGBPtr(250, 250, 250)
	darkBorder := application.NewRGBPtr(46, 46, 46)
	lightTitle := application.NewRGBPtr(250, 250, 250)
	lightText := application.NewRGBPtr(23, 23, 23)
	lightBorder := application.NewRGBPtr(217, 217, 217)

	return application.ThemeSettings{
		DarkModeActive: &application.WindowTheme{
			TitleBarColour:  darkTitle,
			TitleTextColour: darkText,
			BorderColour:    darkBorder,
		},
		DarkModeInactive: &application.WindowTheme{
			TitleBarColour:  darkTitle,
			TitleTextColour: darkText,
			BorderColour:    darkBorder,
		},
		LightModeActive: &application.WindowTheme{
			TitleBarColour:  lightTitle,
			TitleTextColour: lightText,
			BorderColour:    lightBorder,
		},
		LightModeInactive: &application.WindowTheme{
			TitleBarColour:  lightTitle,
			TitleTextColour: lightText,
			BorderColour:    lightBorder,
		},
	}
}

func buildMacWindowOptions() application.MacWindow {
	return application.MacWindow{
		Backdrop: application.MacBackdropNormal,
		TitleBar: application.MacTitleBar{
			AppearsTransparent:   false,
			Hide:                 false,
			HideTitle:            false,
			FullSizeContent:      false,
			UseToolbar:           false,
			HideToolbarSeparator: true,
		},
	}
}

func buildLinuxWindowOptions() application.LinuxWindow {
	return application.LinuxWindow{}
}

func readAsset(path string) []byte {
	data, err := assets.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
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

func buildAppMenu(app *application.App) *application.Menu {
	rootMenu := app.NewMenu()

	if runtime.GOOS == "darwin" {
		rootMenu.AddRole(application.AppMenu)
	}

	fileMenu := rootMenu.AddSubmenu("File")
	fileMenu.Add("Open Data Directory").
		SetAccelerator("CmdOrCtrl+O").
		OnClick(func(_ *application.Context) {
			openPathInExplorer(app, appDataDir())
		})
	fileMenu.AddSeparator()
	fileMenu.Add("Quit").
		SetAccelerator("CmdOrCtrl+Q").
		OnClick(func(_ *application.Context) {
			app.Quit()
		})

	viewMenu := rootMenu.AddSubmenu("View")
	viewMenu.Add("Reload Frontend").
		SetAccelerator("CmdOrCtrl+R").
		OnClick(func(_ *application.Context) {
			if window := app.Window.Current(); window != nil {
				window.ForceReload()
			}
		})
	viewMenu.Add("Toggle Fullscreen").
		SetAccelerator("CmdOrCtrl+Shift+F").
		OnClick(func(_ *application.Context) {
			if window := app.Window.Current(); window != nil {
				window.ToggleFullscreen()
			}
		})

	helpMenu := rootMenu.AddSubmenu("Help")
	helpMenu.Add("Documentation").OnClick(func(_ *application.Context) {
		if err := app.Browser.OpenURL(docsURL); err != nil {
			log.Printf("open documentation failed: %v", err)
		}
	})
	helpMenu.Add("Project Repository").OnClick(func(_ *application.Context) {
		if err := app.Browser.OpenURL(repoURL); err != nil {
			log.Printf("open repository failed: %v", err)
		}
	})

	return rootMenu
}

func openPathInExplorer(app *application.App, path string) {
	if path == "" {
		return
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		log.Printf("resolve path %s failed: %v", path, err)
		abs = path
	}

	if err := app.Browser.OpenURL(fileURI(abs)); err != nil {
		log.Printf("open data directory failed: %v", err)
	}
}

func fileURI(path string) string {
	clean := filepath.ToSlash(path)
	if runtime.GOOS == "windows" && len(clean) > 0 && clean[0] != '/' {
		clean = "/" + clean
	}

	u := url.URL{Scheme: "file", Path: clean}
	return u.String()
}
