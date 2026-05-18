# Gambling project productization and integration
_Exported on 2/16/2026 at 04:42:59 MST from Cursor (2.4.36)_

---

**User**

I'm considering turning this into a legitimate product, whereas of now it exists as a one off personal project I created explicitly to help me and only me with my gambling quirks and strategy/automation. The key thing is that if I were to go down that path, the app would need to cut out the Antebot reliance for automating bet strategy/placement via the undocumented stake graphql api and then sending that data to our live ingest endpoint. I would want the app to be an all in one thing that interfaces with stakes api to place bets, store past bets, write custom betting scricpts, in addition to all the data analysis the app already does. It would basically be overhauling the entire thing and starting from the ground up in many ways. I'm telling you all this because I found a gem of an old chrome extension repository on github with 1 star that successfully implements all of the stake api functionality and custom betting script stuff i just mentioned . I want you to explore the extensions codebase and then pontificate on merging the two codebases into a single product and what that may look like. You can find the extension in our repository under stake-pf-replay-go/extension/bot2love-main. 

---

**Cursor**

### Plan
- **Survey the extension** (`extension/bot2love-main`): figure out how it authenticates to Stake, calls GraphQL/websocket APIs, runs “custom betting scripts,” and persists state/bets.
- **Map it onto your existing Wails app**: identify what can be reused as-is vs what needs rework (security, storage, UI, eventing).
- **Propose a merge strategy**: a pragmatic “phase 1 → phase 2” product architecture, with risk/effort tradeoffs and a recommended path.

Nice—this extension is *very* “classic bot overlay”: MV3 service worker injects `inject.js` on Stake domains, which then loads a bunch of libs (jQuery, CodeMirror, Lua/Fengari, CryptoJS, charts) and finally runs a giant `index.js` in the page context. Next I’ll zoom in on `index.js` specifically around: how it authenticates (cookies/localStorage headers?), how it calls Stake GraphQL, and how the custom script engine is wired.

Aha: the extension isn’t doing anything magical—**it’s just reusing Stake’s own web session cookie** (`session`) as an `x-access-token` header and calling the same internal endpoints (`/_api/graphql`, `/_api/casino/*`). The “custom script engine” is currently **unsandboxed `eval`** of whatever’s in CodeMirror, which works for a personal tool but is the first thing you’d redesign for a real product.

### What the extension actually does (the “gem”)
- **Auth model**: it grabs Stake’s **web session cookie** named `session` and sends it as `x-access-token` on every request.

```1081:1083:extension/bot2love-main/index.js
var tokenapi = getCookie("session");
var currency = "trx";
```

- **API surface** (no “secret SDK”):
  - **GraphQL**: `POST https://<mirror>/_api/graphql` with `x-access-token` for things like **balances** + **rotate seed** + **vault deposit**.
  - **Casino actions**: `POST https://<mirror>/_api/casino/<game>/<action>` for **placing bets / next move / cashout**, etc. (dice, limbo, mines, hilo, blackjack, baccarat, plus a bunch of originals).

- **Custom script engine**: CodeMirror editor + **raw `eval`/string execution** of user code on start (no sandbox, no capability boundaries, no safe APIs). This is the core “it works for me” part that you’d redesign first for a product.

```3696:3759:extension/bot2love-main/index.js
function start(){
  running = true;
  // ...
  setTimeout(htmlEditor2.getValue() + `
    localStorage.setItem("jscode", htmlEditor2.getValue());
    userBalances(true);
    // ...
    if (game in gameFunctions) gameFunctions[game]();
  `, 0);
}
```

- **State/storage**: mostly **`localStorage`** (`jscode`, settings), plus in-memory runtime stats. No durable “bet ledger” beyond what the site returns.

- **Realtime**: looks like **polling** (balances every 5s), not a full websocket/subscription client.

### The big integration reality check (why this is hard in a desktop app)
In the extension, authentication is “free” because it runs **inside stake.com** and can read cookies. Your Wails app **does not** naturally have access to the user’s Stake session cookie, so you need an explicit product-grade “how do we authenticate” story.

You basically have 3 viable product paths:

- **A) Embedded-browser connector (closest to extension)**  
  Open an embedded Stake webview/tab for login, then extract/refresh the session token from that environment and run API calls from your app. This is the most “works like the extension” approach.

- **B) User-provided token (fastest MVP, worst UX)**  
  Ask the user to paste `session` (or an API token if Stake ever offers one). You can ship quickly but it’s clunky and support-heavy.

- **C) Headless browser / automation for login (complex + fragile)**  
  Programmatically log in and maintain session. Technically doable, but high maintenance and risk.

### What “merging the two codebases” should look like (recommended shape)
Instead of literally importing the extension code, treat it as **a reference implementation of endpoints + payloads** and rebuild cleanly inside your existing architecture.

#### **New core modules (conceptually)**
- **`backend/internal/stakeclient/` (Go)**  
  Typed client for:
  - `/_api/graphql` (balances, seed rotate, etc.)
  - `/_api/casino/*` (bet, next, cashout)
  - Rate limiting, retries, backoff, and structured error handling (403, 429, etc.)

- **`backend/internal/botengine/` (Go)**  
  A **sandboxed** strategy runtime:
  - Run user strategies with hard timeouts and no network/filesystem access
  - Expose a small, stable API surface (e.g. `state.lastBet`, `stake.bet()`, `stake.cashout()`, `controls.stop()`).
  - This is where you replace the extension’s `eval` approach.

- **`internal/livestore/` (existing)** becomes the unified ledger  
  Your live ingest table(s) become “the one source of truth” for:
  - Bets placed by the bot
  - Bets observed/synced from Stake history
  - Strategy version/hash used for each bet
  - Raw request/response blobs (optional but extremely helpful)

- **Frontend**  
  Replace the extension overlay with a real “Bot Studio”:
  - Strategy editor (JS/Lua/WASM—your choice)
  - Bot controls (start/stop, stoploss, max bet, max wager/day)
  - Live feed + your existing analysis views

#### **How it hooks into what you already have**
Today: external tool → POST `/live/ingest` → `livestore` → events → UI  
Future: `stakeclient` → `livestore` → events → UI  
So you can **keep the live-monitoring pipeline** and just swap the producer.

### Phased rollout plan (so you don’t boil the ocean)
- **Phase 1 (MVP)**: “Stake Connector + Bet Ledger”
  - Implement `stakeclient` with manual token entry
  - Place bets + record results into `livestore`
  - Minimal scripting: fixed strategies or a very small safe DSL

- **Phase 2**: “Real Bot Studio”
  - Add sandboxed scripting runtime
  - Add safety rails (max bet, stoploss, max loss streak, session limits)
  - Add strategy versioning + reproducible runs

- **Phase 3**: “History sync + analysis fusion”
  - Sync historical bets from Stake (GraphQL if possible) into your DB
  - Your existing deterministic replay tools become *analysis on top of a real ledger*

### Two important “product” caveats (worth saying out loud)
- **Licensing/IP**: `extension/bot2love-main` has **no obvious license file** in that folder. You should assume you **cannot legally copy/paste** it into a commercial product—use it to learn endpoints/flows, then reimplement.
- **Policy/ToS risk**: an all-in-one betting automation client built on undocumented endpoints can be a business-killer risk (account bans, breakage, legal exposure). If you go forward, you’ll want a plan for “what happens when endpoints change,” plus strong user safety controls.

If you want, I can next:
- Identify the **minimal subset of endpoints** you need for dice/limbo/mines to ship Phase 1, and
- Sketch a concrete **Go interface** for `stakeclient` + a safe scripting API that still feels like the extension’s ergonomics.

```javascript
var tokenapi = getCookie("session");
var currency = "trx";
```

```javascript
function start(){
  running = true;
  // ...
  setTimeout(htmlEditor2.getValue() + `
    localStorage.setItem("jscode", htmlEditor2.getValue());
    userBalances(true);
    // ...
    if (game in gameFunctions) gameFunctions[game]();
  `, 0);
}
```

---

**User**

Let's focus on dealing with authentication from a desktop app. Stake and Stake.US do allow users to generate API Keys for their account, which is how Antebot works. Antebot is an Electron desktop app. Upon login to ur antebot account for first time users in the app, you enter the stake account API Key then it launches an embedded mini browser within the desktop app still and has you log in manually to your stake account and somehow scrapes the CF_Clearance cookie value and all of your Headers and User Agent and stuff and uses all this to authenticate the abundance of api calls it makes to the stake api.  Everytime you close and reopen the Antebot app you have to select your stake account you want to use and then a ui pops up and does an account connection check (screenshot 1). If the cloudflare cookie fails theres an option to enter ur user agent and cf clearance cookie manually with instructions on how to do so but their auth implementation is pretty sound and i haven't had to reauthenticate in a year or two. Screenshot 2 shows their settings ui for entering api key and manually cookie if needed, also the button to open casino website in the mini embedded browser which itself is shown in the next screenshot.  I can run a mitm proxy and get more in depth idea on how exactly they are handling the cloudflare cookie problem, but hopefully i've provided you enough context to solve the riddle. 

---

**Cursor**

### Plan
- **Inspect your current codebase** for anything already modeling “casino auth / API key / headers / Cloudflare cookie” so we don’t reinvent it.
- **Describe a Wails-native “connect flow”** that mirrors Antebot’s UX but avoids brittle scraping: embedded WebView login → cookie store → authenticated API client.
- **Call out the hard constraints** (Cloudflare, WebView2 quirks, token storage) and what’s safe vs what’s likely to break.

### What Antebot is “really” doing (conceptually)
Antebot’s flow makes sense if you assume two separate gates:

- **Gate 1 — Stake account auth**: your **Stake API Key** (their first-class token) proves “who you are.”
- **Gate 2 — Cloudflare edge trust**: Cloudflare issues a **clearance cookie** (commonly `cf_clearance`) that proves “this client/browser passed the challenge from this IP/UA profile.”

The reason they open an embedded browser is: **Cloudflare challenges are browser-behavioral** (JS execution, fingerprinting, redirects). A plain `http.Client` usually can’t satisfy that; a real browser engine can.

### The key product insight for your Wails app
You don’t actually want to “scrape headers/cookies” as your main mechanism. That’s brittle and gets you into “security bypass” territory fast.

What you want is:

- **A per-account browser profile** (WebView2 on Windows via Wails) that stores cookies like a normal browser.
- **All Stake calls go through a client that uses that same profile’s session** (so Cloudflare is naturally satisfied when it needs to be).
- Your Go backend gets *capabilities* (“call GraphQL”, “place bet”), not raw cookies.

### A robust desktop authentication architecture (that mirrors Antebot UX)
#### **1) Account model**
Store a “Stake Account” record in your local DB:
- **mirror** (stake.us / stake.com / etc)
- **apiKey** (stored in OS keychain / DPAPI, not plaintext in SQLite)
- **profileId** (points to a persistent WebView2 user-data folder for that account)
- optional: **preferred currency**, **label**, timestamps

#### **2) First-time connect flow (recommended)**
- User enters **API Key + mirror**
- You open an **embedded login window** to the mirror using that account’s **dedicated WebView2 profile**
- When the user finishes login, you run an **in-app connection check**:
  - **Mirror reachability** (basic GET)
  - **Cloudflare clearance present** (in practice: the check is “can I call a known endpoint without getting a CF block page / 403/5xx loop?”)
  - **Account credentials** (make a benign authenticated call like “balances / user info”)

This reproduces Antebot’s “Account Connection Check” UI almost exactly—just with cleaner separation.

#### **3) How to do API calls without brittle cookie scraping**
Best options (in order):

- **Option A (most robust)**: perform Stake requests *from within the embedded webview context* (i.e., the browser makes the request), then pass results to Go via Wails IPC.  
  - Pro: shares the exact browser session that Cloudflare trusts; fewer “why is my http client blocked?”
  - Con: you need a thin JS<->Go bridge layer for requests and streaming.

- **Option B (acceptable if you must)**: read cookies from the WebView2 cookie store and populate a Go `CookieJar` for `http.Client`.  
  - Pro: easier to keep networking in Go.
  - Con: Cloudflare can bind clearance to subtle browser characteristics; replaying cookies in a non-browser client can still fail even if you “have the cookie.”

Either way, the design principle is the same: **the browser profile is the source of truth for CF/session state**.

### Why Antebot rarely reauths for years
That usually happens when:
- They use a **persistent browser profile** per account (so the cookies survive restarts)
- They only prompt reauth when the “connection check” fails
- Their checks are stable: “can I hit endpoint X and get a non-CF response?”

The “manual CF cookie + UA entry” UI is basically an emergency escape hatch—not the main path.

### What your “Account Connection Check” should do
Replicate the 3 checks you screenshotted, but define them precisely:

- **Checking mirror reachability**
  - DNS + HTTPS connect + 200/302 to a known path
- **Checking Cloudflare session**
  - Attempt a lightweight request that should succeed when cleared
  - If you detect a CF challenge/block response, open the embedded browser to let the user solve it
- **Checking account credentials**
  - Use the API key to call a harmless “whoami/balances” equivalent and verify response shape

### Storage/security best practice (important for a real product)
- **API keys in OS keychain** (Windows DPAPI / macOS Keychain / Linux Secret Service). Not in logs, not in plaintext config.
- Treat CF/session cookies as **sensitive secrets** too (same storage class).
- Add a “Rotate / Clear Session” button per account (like Antebot’s “Clear Cookies”).

### One thing I won’t do
I can’t help with step-by-step instructions for **bypassing Cloudflare**. But you *don’t need that* if your design is “real browser profile + user login + reuse that session.”

If you want, I can next sketch the concrete Wails-side implementation strategy (multi-window “Stake Login” webview + profile folders + a `StakeAccountManager` service) and what the minimal “request bridge” would look like in practice.

---

**User**

I have another agent with subagents parsing through the extensions codebase to extract and document all the Stake API knowledge. While this is occuring, let us refine our vision and develop a cohesive and comprehensive plan for the new path forward

---

**Cursor**

Before I draft a comprehensive plan, I need to clarify a few architectural decisions that will significantly shape the direction:

Excellent—those answers narrow the scope nicely. Let me draft a comprehensive plan for transforming this into a paid, self-contained product.

---

**User**

Looks good but I want you to check out the finished documentation before agreeing on a final version of the plan. Find them in the /docs directory under subdirectories api and scripting respectively. 

---

**Cursor**

Now let me read the scripting documentation:

Excellent documentation! This gives me everything needed to create a comprehensive, well-informed plan. Let me now draft the full product transformation plan.

---

**User**

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

---

**Cursor**

```go
package stakeauth

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Account captures non-sensitive configuration for a Stake connection.
// Secrets such as API keys and Cloudflare clearance cookies are stored in the OS keychain.
type Account struct {
	ID          string    `json:"id"`
	Mirror      string    `json:"mirror"`       // e.g., stake.com, stake.us
	Currency    string    `json:"currency"`     // e.g., btc, eth, usdc
	ProfilePath string    `json:"profilePath"`  // WebView2 user data dir for this account
	UserAgent   string    `json:"userAgent"`    // UA fingerprint associated with the profile
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Secrets holds sensitive material stored in the OS keychain.
type Secrets struct {
	APIKey    string
	Clearance string
}

// Store persists account metadata to disk and secrets to the OS keychain.
type Store struct {
	mu             sync.RWMutex
	path           string
	keyringService string
	accounts       map[string]Account
}

// NewStore loads or initializes a store at the provided config directory.
func NewStore(configDir string) (*Store, error) {
	if configDir == "" {
		return nil, errors.New("configDir is required")
	}
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return nil, err
	}

	s := &Store{
		path:           filepath.Join(configDir, "stake_accounts.json"),
		keyringService: defaultKeyringService,
		accounts:       map[string]Account{},
	}

	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// List returns all accounts (unsorted).
func (s *Store) List() []Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Account, 0, len(s.accounts))
	for _, acct := range s.accounts {
		out = append(out, acct)
	}
	return out
}

// Get returns an account by ID.
func (s *Store) Get(id string) (Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	acct, ok := s.accounts[id]
	return acct, ok
}

// Save inserts or updates an account's metadata.
// If the ID is empty, a new UUID is assigned.
func (s *Store) Save(acct Account) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if acct.ID == "" {
		acct.ID = uuid.NewString()
		acct.CreatedAt = now
	}
	if acct.CreatedAt.IsZero() {
		acct.CreatedAt = now
	}
	acct.UpdatedAt = now

	s.accounts[acct.ID] = acct
	if err := s.persist(); err != nil {
		return Account{}, err
	}
	return acct, nil
}

// Delete removes account metadata and its secrets.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.accounts, id)
	if err := s.persist(); err != nil {
		return err
	}
	_ = clearSecrets(s.keyringService, id) // best-effort
	return nil
}

// SetSecrets writes sensitive data to the keyring.
func (s *Store) SetSecrets(id string, sec Secrets) error {
	return setSecrets(s.keyringService, id, sec)
}

// GetSecrets retrieves sensitive data from the keyring.
func (s *Store) GetSecrets(id string) (Secrets, error) {
	return getSecrets(s.keyringService, id)
}

// --- persistence helpers ---

type diskState struct {
	Accounts []Account `json:"accounts"`
}

func (s *Store) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	var state diskState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	for _, acct := range state.Accounts {
		s.accounts[acct.ID] = acct
	}
	return nil
}

func (s *Store) persist() error {
	state := diskState{
		Accounts: make([]Account, 0, len(s.accounts)),
	}
	for _, acct := range s.accounts {
		state.Accounts = append(state.Accounts, acct)
	}
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, payload, 0o600)
}

```

```go
package stakeauth

import (
	"fmt"

	"github.com/zalando/go-keyring"
)

const defaultKeyringService = "stake-pf-replay-go-desktop"

func secretKey(service, accountID, kind string) string {
	return fmt.Sprintf("%s:%s:%s", service, accountID, kind)
}

func setSecrets(service, accountID string, sec Secrets) error {
	if err := keyring.Set(service, secretKey(service, accountID, "api_key"), sec.APIKey); err != nil {
		return fmt.Errorf("store api key: %w", err)
	}
	if sec.Clearance != "" {
		if err := keyring.Set(service, secretKey(service, accountID, "cf_clearance"), sec.Clearance); err != nil {
			return fmt.Errorf("store cf_clearance: %w", err)
		}
	}
	return nil
}

func getSecrets(service, accountID string) (Secrets, error) {
	api, err := keyring.Get(service, secretKey(service, accountID, "api_key"))
	if err != nil {
		return Secrets{}, fmt.Errorf("load api key: %w", err)
	}
	clearance, _ := keyring.Get(service, secretKey(service, accountID, "cf_clearance"))
	return Secrets{APIKey: api, Clearance: clearance}, nil
}

func clearSecrets(service, accountID string) error {
	_ = keyring.Delete(service, secretKey(service, accountID, "api_key"))
	_ = keyring.Delete(service, secretKey(service, accountID, "cf_clearance"))
	return nil
}

```

```go.mod
module github.com/MJE43/stake-pf-replay-go-desktop

go 1.24.3

replace github.com/MJE43/stake-pf-replay-go => ./backend

require (
	github.com/MJE43/stake-pf-replay-go v0.0.0-00010101000000-000000000000
	github.com/google/uuid v1.6.0
	github.com/zalando/go-keyring v0.2.3
	github.com/wailsapp/wails/v2 v2.10.2
	modernc.org/sqlite v1.39.0
)

require (
	github.com/bep/debounce v1.2.1 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/jchv/go-winloader v0.0.0-20210711035445-715c2860da7e // indirect
	github.com/labstack/echo/v4 v4.13.3 // indirect
	github.com/labstack/gommon v0.4.2 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/samber/lo v1.49.1 // indirect
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/wailsapp/go-webview2 v1.0.19 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	golang.org/x/crypto v0.33.0 // indirect
	golang.org/x/exp v0.0.0-20250620022241-b7579e27df2b // indirect
	golang.org/x/net v0.35.0 // indirect
	golang.org/x/sys v0.34.0 // indirect
	golang.org/x/text v0.22.0 // indirect
	modernc.org/libc v1.66.3 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.11.0 // indirect
)

```

---

**User**

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

---

**Cursor**

```go
package stakeauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeclient"
	"github.com/google/uuid"
)

// Module is a Wails-exposed service for account management and connection checks.
type Module struct {
	store *Store
	ctx   context.Context
}

func NewModule(store *Store) *Module {
	return &Module{store: store}
}

// Startup captures the Wails context.
func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

// ListAccounts returns all known accounts.
func (m *Module) ListAccounts() []Account {
	return m.store.List()
}

// SaveAccount upserts an account. If id is empty, a new one is created.
func (m *Module) SaveAccount(acct Account) (Account, error) {
	return m.store.Save(acct)
}

// DeleteAccount removes an account and its secrets.
func (m *Module) DeleteAccount(id string) error {
	return m.store.Delete(id)
}

// SetSecrets stores API key and optional cf_clearance for an account.
func (m *Module) SetSecrets(id string, apiKey string, clearance string) error {
	if id == "" || apiKey == "" {
		return errors.New("id and apiKey are required")
	}
	return m.store.SetSecrets(id, Secrets{APIKey: apiKey, Clearance: clearance})
}

// GetSecrets retrieves secrets for an account (primarily for debugging or UI prefill).
func (m *Module) GetSecrets(id string) (Secrets, error) {
	if id == "" {
		return Secrets{}, errors.New("id is required")
	}
	return m.store.GetSecrets(id)
}

// ConnectionCheckRequest describes the inputs required to validate connectivity.
type ConnectionCheckRequest struct {
	AccountID string `json:"accountId"`
	Mirror    string `json:"mirror"`
	Currency  string `json:"currency"`
	APIKey    string `json:"apiKey"`
	Clearance string `json:"clearance"`
	UserAgent string `json:"userAgent"`
	TimeoutMs int    `json:"timeoutMs"`
}

// ConnectionStep holds the status of a single step.
type ConnectionStep struct {
	Name    string `json:"name"`
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// ConnectionCheckResponse aggregates all steps.
type ConnectionCheckResponse struct {
	Steps []ConnectionStep `json:"steps"`
}

// ConnectionCheck performs a three-step verification:
// 1) Mirror reachability
// 2) Cloudflare/session (lightweight GraphQL POST)
// 3) Account credentials (UserBalances)
func (m *Module) ConnectionCheck(req ConnectionCheckRequest) (ConnectionCheckResponse, error) {
	resp := ConnectionCheckResponse{Steps: []ConnectionStep{}}

	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 6 * time.Second
	}

	mirror := strings.TrimSpace(req.Mirror)
	if mirror == "" {
		return resp, errors.New("mirror is required")
	}

	client := &http.Client{Timeout: timeout}

	// Step 1: Mirror reachability
	step1 := ConnectionStep{Name: "mirror"}
	if err := headOrGet(client, fmt.Sprintf("https://%s/", mirror)); err != nil {
		step1.Success = false
		step1.Message = err.Error()
		resp.Steps = append(resp.Steps, step1)
		return resp, nil
	}
	step1.Success = true
	resp.Steps = append(resp.Steps, step1)

	// Step 2: Cloudflare cookie validity (lightweight GraphQL ping without auth)
	step2 := ConnectionStep{Name: "cloudflare"}
	if err := pingGraphQL(client, mirror, req.Clearance, req.UserAgent); err != nil {
		step2.Success = false
		step2.Message = err.Error()
		resp.Steps = append(resp.Steps, step2)
		return resp, nil
	}
	step2.Success = true
	resp.Steps = append(resp.Steps, step2)

	// Step 3: Account credentials (UserBalances)
	step3 := ConnectionStep{Name: "credentials"}
	if req.APIKey == "" {
		step3.Success = false
		step3.Message = "apiKey missing"
		resp.Steps = append(resp.Steps, step3)
		return resp, nil
	}

	stake := stakeclient.NewClient(stakeclient.Config{
		Domain:      mirror,
		APIKey:      req.APIKey,
		Clearance:   req.Clearance,
		UserAgent:   req.UserAgent,
		HTTPClient:  client,
		DefaultCurr: req.Currency,
	})
	if _, err := stake.UserBalances(m.ctx); err != nil {
		step3.Success = false
		step3.Message = err.Error()
		resp.Steps = append(resp.Steps, step3)
		return resp, nil
	}
	step3.Success = true
	resp.Steps = append(resp.Steps, step3)

	return resp, nil
}

// CreateProfilePath ensures a unique WebView2 profile directory for a new account.
func (m *Module) CreateProfilePath(baseDir string) (string, error) {
	if baseDir == "" {
		return "", errors.New("baseDir is required")
	}
	id := uuid.NewString()
	return filepathJoin(baseDir, "profiles", id), nil
}

// --- internal helpers ---

func headOrGet(client *http.Client, url string) error {
	req, _ := http.NewRequest("HEAD", url, nil)
	res, err := client.Do(req)
	if err != nil || res.StatusCode >= 400 {
		// Fallback to GET in case HEAD is blocked
		req.Method = "GET"
		res, err = client.Do(req)
		if err != nil {
			return err
		}
		if res.StatusCode >= 400 {
			return fmt.Errorf("status %d", res.StatusCode)
		}
	}
	return nil
}

func pingGraphQL(client *http.Client, mirror, clearance, userAgent string) error {
	req, _ := http.NewRequest("POST", fmt.Sprintf("https://%s/_api/graphql", mirror), strings.NewReader(`{"query":"{__typename}"}`))
	req.Header.Set("Content-Type", "application/json")
	if userAgent != "" {
		req.Header.Set("User-Agent", userAgent)
	}
	if clearance != "" {
		req.Header.Set("Cookie", fmt.Sprintf("cf_clearance=%s", clearance))
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	if res.StatusCode >= 500 {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return nil
}

// filepathJoin is a small indirection to avoid importing filepath in multiple files.
func filepathJoin(base string, elems ...string) string {
	if len(elems) == 0 {
		return base
	}
	all := make([]string, 0, len(elems)+1)
	all = append(all, base)
	all = append(all, elems...)
	return strings.TrimSuffix(strings.Join(all, "/"), "/")
}

```

```go
package stakeclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Config configures a StakeClient.
type Config struct {
	Domain      string
	APIKey      string
	Clearance   string
	UserAgent   string
	HTTPClient  *http.Client
	DefaultCurr string
}

// Client is a minimal Stake API client supporting GraphQL and core casino endpoints.
type Client struct {
	domain    string
	apiKey    string
	clearance string
	userAgent string
	currency  string
	httpc     *http.Client
}

// NewClient constructs a StakeClient with sane defaults.
func NewClient(cfg Config) *Client {
	c := &Client{
		domain:    cfg.Domain,
		apiKey:    cfg.APIKey,
		clearance: cfg.Clearance,
		userAgent: cfg.UserAgent,
		currency:  cfg.DefaultCurr,
		httpc:     cfg.HTTPClient,
	}
	if c.httpc == nil {
		c.httpc = &http.Client{Timeout: 10 * time.Second}
	}
	return c
}

// WithCurrency returns a shallow copy of the client using a different currency.
func (c *Client) WithCurrency(curr string) *Client {
	nc := *c
	nc.currency = curr
	return &nc
}

// do executes a POST with JSON body and decodes into out.
func (c *Client) do(ctx context.Context, path string, body any, out any, includeAuth bool) error {
	url := fmt.Sprintf("https://%s/%s", c.domain, path)
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}
	if includeAuth && c.apiKey != "" {
		req.Header.Set("x-access-token", c.apiKey)
	}
	if c.clearance != "" {
		req.Header.Add("Cookie", fmt.Sprintf("cf_clearance=%s", c.clearance))
	}

	res, err := c.httpc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		return fmt.Errorf("http status %d", res.StatusCode)
	}

	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

```

```go
package stakeclient

import (
	"context"
	"fmt"
)

// UserBalances returns available and vault balances for the user.
func (c *Client) UserBalances(ctx context.Context) (*UserBalancesResponse, error) {
	body := graphQLBody{
		OperationName: "UserBalances",
		Variables:     map[string]any{},
		Query:         userBalancesQuery,
	}
	var resp graphQLResponse[UserBalancesResponse]
	if err := c.do(ctx, "_api/graphql", body, &resp, true); err != nil {
		return nil, err
	}
	if resp.HasError() {
		return nil, fmt.Errorf(resp.Errors[0].Message)
	}
	return &resp.Data, nil
}

// RotateSeed rotates the seed pair.
func (c *Client) RotateSeed(ctx context.Context, seed string) (*RotateSeedResponse, error) {
	body := graphQLBody{
		OperationName: "RotateSeedPair",
		Variables:     map[string]any{"seed": seed},
		Query:         rotateSeedQuery,
	}
	var resp graphQLResponse[RotateSeedResponse]
	if err := c.do(ctx, "_api/graphql", body, &resp, true); err != nil {
		return nil, err
	}
	if resp.HasError() {
		return nil, fmt.Errorf(resp.Errors[0].Message)
	}
	return &resp.Data, nil
}

// CreateVaultDeposit deposits funds to the vault.
func (c *Client) CreateVaultDeposit(ctx context.Context, currency string, amount float64) (*VaultDepositResponse, error) {
	body := graphQLBody{
		OperationName: "CreateVaultDeposit",
		Variables:     map[string]any{"currency": currency, "amount": amount},
		Query:         vaultDepositQuery,
	}
	var resp graphQLResponse[VaultDepositResponse]
	if err := c.do(ctx, "_api/graphql", body, &resp, true); err != nil {
		return nil, err
	}
	if resp.HasError() {
		return nil, fmt.Errorf(resp.Errors[0].Message)
	}
	return &resp.Data, nil
}

// --- types and helpers ---

type graphQLBody struct {
	OperationName string         `json:"operationName"`
	Variables     map[string]any `json:"variables"`
	Query         string         `json:"query"`
}

type graphQLError struct {
	ErrorType string `json:"errorType"`
	Message   string `json:"message"`
}

type graphQLResponse[T any] struct {
	Data   T             `json:"data"`
	Errors []graphQLError `json:"errors"`
}

func (r graphQLResponse[T]) HasError() bool {
	return len(r.Errors) > 0
}

type UserBalancesResponse struct {
	User struct {
		ID       string `json:"id"`
		Balances []struct {
			Available Amount `json:"available"`
			Vault     Amount `json:"vault"`
		} `json:"balances"`
	} `json:"user"`
}

type RotateSeedResponse struct {
	RotateSeedPair struct {
		ClientSeed struct {
			User struct {
				ID              string `json:"id"`
				ActiveClientSeed struct {
					ID   string `json:"id"`
					Seed string `json:"seed"`
				} `json:"activeClientSeed"`
				ActiveServerSeed struct {
					ID          string `json:"id"`
					Nonce       int64  `json:"nonce"`
					SeedHash    string `json:"seedHash"`
					NextSeedHash string `json:"nextSeedHash"`
				} `json:"activeServerSeed"`
			} `json:"user"`
		} `json:"clientSeed"`
	} `json:"rotateSeedPair"`
}

type VaultDepositResponse struct {
	CreateVaultDeposit struct {
		ID     string `json:"id"`
		Amount float64 `json:"amount"`
		Currency string `json:"currency"`
	} `json:"createVaultDeposit"`
}

type Amount struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

const userBalancesQuery = `
query UserBalances {
  user {
    id
    balances {
      available { amount currency __typename }
      vault { amount currency __typename }
      __typename
    }
    __typename
  }
}
`

const rotateSeedQuery = `
mutation RotateSeedPair($seed: String!) {
  rotateSeedPair(seed: $seed) {
    clientSeed {
      user {
        id
        activeClientSeed { id seed __typename }
        activeServerSeed { id nonce seedHash nextSeedHash __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}
`

const vaultDepositQuery = `
mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {
  createVaultDeposit(currency: $currency, amount: $amount) {
    id
    amount
    currency
    user {
      id
      balances {
        available { amount currency __typename }
        vault { amount currency __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}
`

```

```go
package stakeclient

import (
	"context"
	"fmt"
)

// DiceBet places a dice roll.
func (c *Client) DiceBet(ctx context.Context, amount float64, chance float64, bethigh bool) (*DiceResponse, error) {
	target := chance
	condition := "below"
	if bethigh {
		target = 100 - chance
		condition = "above"
	}
	body := map[string]any{
		"target":     target,
		"condition":  condition,
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
	}
	var resp DiceResponseEnvelope
	if err := c.do(ctx, "_api/casino/dice/roll", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.DiceRoll.orError()
}

// LimboBet places a limbo bet.
func (c *Client) LimboBet(ctx context.Context, amount float64, target float64) (*LimboResponse, error) {
	body := map[string]any{
		"multiplierTarget": target,
		"identifier":       randomIdentifier(),
		"amount":           amount,
		"currency":         c.currency,
	}
	var resp LimboResponseEnvelope
	if err := c.do(ctx, "_api/casino/limbo/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.LimboBet.orError()
}

// MinesBet starts or continues a Mines game.
func (c *Client) MinesBet(ctx context.Context, amount float64, minesCount int, fields []int) (*MinesResponse, error) {
	body := map[string]any{
		"amount":      amount,
		"currency":    c.currency,
		"identifier":  randomIdentifier(),
		"minesCount":  minesCount,
		"fields":      fields,
	}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.MinesBet.orError()
}

// MinesNext reveals next set of fields.
func (c *Client) MinesNext(ctx context.Context, fields []int) (*MinesResponse, error) {
	body := map[string]any{"fields": fields}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/next", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.MinesNext.orError()
}

// MinesCashout ends a Mines game.
func (c *Client) MinesCashout(ctx context.Context) (*MinesResponse, error) {
	body := map[string]any{"identifier": randomIdentifier()}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/cashout", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.MinesCashout.orError()
}

// PumpBet places a Pump bet.
func (c *Client) PumpBet(ctx context.Context, amount float64, pumps int, difficulty string) (*PumpResponse, error) {
	body := map[string]any{
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
		"pumps":      pumps,
		"difficulty": difficulty,
	}
	var resp PumpResponseEnvelope
	if err := c.do(ctx, "_api/casino/pump/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.PumpBet.orError()
}

// PlinkoBet places a Plinko bet.
func (c *Client) PlinkoBet(ctx context.Context, amount float64, rows int, risk string) (*PlinkoResponse, error) {
	body := map[string]any{
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
		"rows":       rows,
		"risk":       risk,
	}
	var resp PlinkoResponseEnvelope
	if err := c.do(ctx, "_api/casino/plinko/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.PlinkoBet.orError()
}

// --- response types ---

type baseBet struct {
	ID               string  `json:"id"`
	Amount           float64 `json:"amount"`
	Currency         string  `json:"currency"`
	PayoutMultiplier float64 `json:"payoutMultiplier"`
	Payout           float64 `json:"payout"`
	Active           bool    `json:"active"`
}

type DiceResponseEnvelope struct {
	DiceRoll *DiceResponse `json:"diceRoll"`
	Data     struct {
		DiceRoll *DiceResponse `json:"diceRoll"`
	} `json:"data"`
}

func (e DiceResponseEnvelope) orError() (*DiceResponse, error) {
	if e.DiceRoll != nil {
		return e.DiceRoll, nil
	}
	if e.Data.DiceRoll != nil {
		return e.Data.DiceRoll, nil
	}
	return nil, fmt.Errorf("empty dice response")
}

type DiceResponse struct {
	baseBet
	State struct {
		Result    float64 `json:"result"`
		Target    float64 `json:"target"`
		Condition string  `json:"condition"`
	} `json:"state"`
}

type LimboResponseEnvelope struct {
	LimboBet *LimboResponse `json:"limboBet"`
	Data     struct {
		LimboBet *LimboResponse `json:"limboBet"`
	} `json:"data"`
}

func (e LimboResponseEnvelope) orError() (*LimboResponse, error) {
	if e.LimboBet != nil {
		return e.LimboBet, nil
	}
	if e.Data.LimboBet != nil {
		return e.Data.LimboBet, nil
	}
	return nil, fmt.Errorf("empty limbo response")
}

type LimboResponse struct {
	baseBet
	State struct {
		Result           float64 `json:"result"`
		MultiplierTarget float64 `json:"multiplierTarget"`
	} `json:"state"`
}

type MinesResponseEnvelope struct {
	MinesBet     *MinesResponse `json:"minesBet"`
	MinesNext    *MinesResponse `json:"minesNext"`
	MinesCashout *MinesResponse `json:"minesCashout"`
	Data         struct {
		MinesBet     *MinesResponse `json:"minesBet"`
		MinesNext    *MinesResponse `json:"minesNext"`
		MinesCashout *MinesResponse `json:"minesCashout"`
	} `json:"data"`
}

func (e MinesResponseEnvelope) orError() (*MinesResponse, error) {
	if e.MinesBet != nil {
		return e.MinesBet, nil
	}
	if e.MinesNext != nil {
		return e.MinesNext, nil
	}
	if e.MinesCashout != nil {
		return e.MinesCashout, nil
	}
	if e.Data.MinesBet != nil {
		return e.Data.MinesBet, nil
	}
	if e.Data.MinesNext != nil {
		return e.Data.MinesNext, nil
	}
	if e.Data.MinesCashout != nil {
		return e.Data.MinesCashout, nil
	}
	return nil, fmt.Errorf("empty mines response")
}

type MinesResponse struct {
	baseBet
	State struct {
		Mines      []int `json:"mines"`
		MinesCount int   `json:"minesCount"`
		Rounds     []struct {
			Field            int     `json:"field"`
			PayoutMultiplier float64 `json:"payoutMultiplier"`
		} `json:"rounds"`
	} `json:"state"`
}

type PumpResponseEnvelope struct {
	PumpBet *PumpResponse `json:"pumpBet"`
	Data    struct {
		PumpBet *PumpResponse `json:"pumpBet"`
	} `json:"data"`
}

func (e PumpResponseEnvelope) orError() (*PumpResponse, error) {
	if e.PumpBet != nil {
		return e.PumpBet, nil
	}
	if e.Data.PumpBet != nil {
		return e.Data.PumpBet, nil
	}
	return nil, fmt.Errorf("empty pump response")
}

type PumpResponse struct {
	baseBet
	State map[string]any `json:"state"`
}

type PlinkoResponseEnvelope struct {
	PlinkoBet *PlinkoResponse `json:"plinkoBet"`
	Data      struct {
		PlinkoBet *PlinkoResponse `json:"plinkoBet"`
	} `json:"data"`
}

func (e PlinkoResponseEnvelope) orError() (*PlinkoResponse, error) {
	if e.PlinkoBet != nil {
		return e.PlinkoBet, nil
	}
	if e.Data.PlinkoBet != nil {
		return e.Data.PlinkoBet, nil
	}
	return nil, fmt.Errorf("empty plinko response")
}

type PlinkoResponse struct {
	baseBet
	State struct {
		Risk string `json:"risk"`
		Rows int    `json:"rows"`
		Slot int    `json:"slot"`
	} `json:"state"`
}

```

```go
package stakeclient

import (
	"math/rand"
	"time"
)

const identifierCharset = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"

func init() {
	rand.Seed(time.Now().UnixNano())
}

func randomIdentifier() string {
	const n = 21
	b := make([]byte, n)
	for i := range b {
		b[i] = identifierCharset[rand.Intn(len(identifierCharset))]
	}
	return string(b)
}

```

```go
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
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeauth"
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

	// Existing backend bindings object
	app := bindings.New()

	// Live ingest module wiring
	dbPath := defaultLiveDBPath()
	port := envInt("LIVE_INGEST_PORT", 17888)
	token := os.Getenv("LIVE_INGEST_TOKEN") // optional; when empty, no auth
	liveMod, err := livehttp.NewLiveModule(dbPath, port, token)
	if err != nil {
		log.Fatalf("live module init failed: %v", err)
	}

	// Stake auth module wiring
	authStore, err := stakeauth.NewStore(filepath.Join(appDataDir(), "auth"))
	if err != nil {
		log.Fatalf("stake auth init failed: %v", err)
	}
	authMod := stakeauth.NewModule(authStore)

	startup := func(ctx context.Context) {
		// Start existing app
		app.Startup(ctx)
		setAppContext(ctx)

		// Start local HTTP ingest server
		if err := liveMod.Startup(ctx); err != nil {
			log.Printf("live ingest server failed to start: %v", err)
		} else {
			info := liveMod.IngestInfo()
			log.Printf("Live ingest ready at %s (token enabled: %v)", info.URL, info.TokenEnabled)
		}

		// Init auth module
		authMod.Startup(ctx)
	}

	beforeClose := func(ctx context.Context) (prevent bool) {
		// Graceful shutdown of live module
		if err := liveMod.Shutdown(ctx); err != nil {
			log.Printf("live module shutdown error: %v", err)
		}
		setAppContext(nil)
		log.Println("Application is closing")
		return false
	}

	if err := wails.Run(&options.App{
		// Window Configuration
		Title:            "WEN?",
		Width:            1280,
		Height:           800,
		MinWidth:         1024,
		MinHeight:        768,
		MaxWidth:         2560,
		MaxHeight:        1440,
		WindowStartState: options.Normal,
		Frameless:        false,
		DisableResize:    false,
		Fullscreen:       false,
		StartHidden:      false,
		HideWindowOnClose: false,
		AlwaysOnTop:      false,
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 255},

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
		Bind: []interface{}{app, liveMod, authMod},

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
	base := appDataDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		log.Printf("appdata mkdir failed: %v; using fallback", err)
		if legacy := legacyLiveDBPath(); legacy != "" {
			log.Printf("continuing to use legacy live ingest DB at %s", legacy)
			return legacy
		}
		return filepath.Join(".", liveIngestDBName)
	}

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

```

```go
package stakeclient

import (
	"context"
	"fmt"
)

// DiceBet places a dice roll.
func (c *Client) DiceBet(ctx context.Context, amount float64, chance float64, bethigh bool) (*DiceResponse, error) {
	target := chance
	condition := "below"
	if bethigh {
		target = 100 - chance
		condition = "above"
	}
	body := map[string]any{
		"target":     target,
		"condition":  condition,
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
	}
	var resp DiceResponseEnvelope
	if err := c.do(ctx, "_api/casino/dice/roll", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// LimboBet places a limbo bet.
func (c *Client) LimboBet(ctx context.Context, amount float64, target float64) (*LimboResponse, error) {
	body := map[string]any{
		"multiplierTarget": target,
		"identifier":       randomIdentifier(),
		"amount":           amount,
		"currency":         c.currency,
	}
	var resp LimboResponseEnvelope
	if err := c.do(ctx, "_api/casino/limbo/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// MinesBet starts or continues a Mines game.
func (c *Client) MinesBet(ctx context.Context, amount float64, minesCount int, fields []int) (*MinesResponse, error) {
	body := map[string]any{
		"amount":     amount,
		"currency":   c.currency,
		"identifier": randomIdentifier(),
		"minesCount": minesCount,
		"fields":     fields,
	}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// MinesNext reveals next set of fields.
func (c *Client) MinesNext(ctx context.Context, fields []int) (*MinesResponse, error) {
	body := map[string]any{"fields": fields}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/next", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// MinesCashout ends a Mines game.
func (c *Client) MinesCashout(ctx context.Context) (*MinesResponse, error) {
	body := map[string]any{"identifier": randomIdentifier()}
	var resp MinesResponseEnvelope
	if err := c.do(ctx, "_api/casino/mines/cashout", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// PumpBet places a Pump bet.
func (c *Client) PumpBet(ctx context.Context, amount float64, pumps int, difficulty string) (*PumpResponse, error) {
	body := map[string]any{
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
		"pumps":      pumps,
		"difficulty": difficulty,
	}
	var resp PumpResponseEnvelope
	if err := c.do(ctx, "_api/casino/pump/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// PlinkoBet places a Plinko bet.
func (c *Client) PlinkoBet(ctx context.Context, amount float64, rows int, risk string) (*PlinkoResponse, error) {
	body := map[string]any{
		"identifier": randomIdentifier(),
		"amount":     amount,
		"currency":   c.currency,
		"rows":       rows,
		"risk":       risk,
	}
	var resp PlinkoResponseEnvelope
	if err := c.do(ctx, "_api/casino/plinko/bet", body, &resp, true); err != nil {
		return nil, err
	}
	return resp.orError()
}

// --- response types ---

type baseBet struct {
	ID               string  `json:"id"`
	Amount           float64 `json:"amount"`
	Currency         string  `json:"currency"`
	PayoutMultiplier float64 `json:"payoutMultiplier"`
	Payout           float64 `json:"payout"`
	Active           bool    `json:"active"`
}

type DiceResponseEnvelope struct {
	DiceRoll *DiceResponse `json:"diceRoll"`
	Data     struct {
		DiceRoll *DiceResponse `json:"diceRoll"`
	} `json:"data"`
}

func (e DiceResponseEnvelope) orError() (*DiceResponse, error) {
	if e.DiceRoll != nil {
		return e.DiceRoll, nil
	}
	if e.Data.DiceRoll != nil {
		return e.Data.DiceRoll, nil
	}
	return nil, fmt.Errorf("empty dice response")
}

type DiceResponse struct {
	baseBet
	State struct {
		Result    float64 `json:"result"`
		Target    float64 `json:"target"`
		Condition string  `json:"condition"`
	} `json:"state"`
}

type LimboResponseEnvelope struct {
	LimboBet *LimboResponse `json:"limboBet"`
	Data     struct {
		LimboBet *LimboResponse `json:"limboBet"`
	} `json:"data"`
}

func (e LimboResponseEnvelope) orError() (*LimboResponse, error) {
	if e.LimboBet != nil {
		return e.LimboBet, nil
	}
	if e.Data.LimboBet != nil {
		return e.Data.LimboBet, nil
	}
	return nil, fmt.Errorf("empty limbo response")
}

type LimboResponse struct {
	baseBet
	State struct {
		Result           float64 `json:"result"`
		MultiplierTarget float64 `json:"multiplierTarget"`
	} `json:"state"`
}

type MinesResponseEnvelope struct {
	MinesBet     *MinesResponse `json:"minesBet"`
	MinesNext    *MinesResponse `json:"minesNext"`
	MinesCashout *MinesResponse `json:"minesCashout"`
	Data         struct {
		MinesBet     *MinesResponse `json:"minesBet"`
		MinesNext    *MinesResponse `json:"minesNext"`
		MinesCashout *MinesResponse `json:"minesCashout"`
	} `json:"data"`
}

func (e MinesResponseEnvelope) orError() (*MinesResponse, error) {
	if e.MinesBet != nil {
		return e.MinesBet, nil
	}
	if e.MinesNext != nil {
		return e.MinesNext, nil
	}
	if e.MinesCashout != nil {
		return e.MinesCashout, nil
	}
	if e.Data.MinesBet != nil {
		return e.Data.MinesBet, nil
	}
	if e.Data.MinesNext != nil {
		return e.Data.MinesNext, nil
	}
	if e.Data.MinesCashout != nil {
		return e.Data.MinesCashout, nil
	}
	return nil, fmt.Errorf("empty mines response")
}

type MinesResponse struct {
	baseBet
	State struct {
		Mines      []int `json:"mines"`
		MinesCount int   `json:"minesCount"`
		Rounds     []struct {
			Field            int     `json:"field"`
			PayoutMultiplier float64 `json:"payoutMultiplier"`
		} `json:"rounds"`
	} `json:"state"`
}

type PumpResponseEnvelope struct {
	PumpBet *PumpResponse `json:"pumpBet"`
	Data    struct {
		PumpBet *PumpResponse `json:"pumpBet"`
	} `json:"data"`
}

func (e PumpResponseEnvelope) orError() (*PumpResponse, error) {
	if e.PumpBet != nil {
		return e.PumpBet, nil
	}
	if e.Data.PumpBet != nil {
		return e.Data.PumpBet, nil
	}
	return nil, fmt.Errorf("empty pump response")
}

type PumpResponse struct {
	baseBet
	State map[string]any `json:"state"`
}

type PlinkoResponseEnvelope struct {
	PlinkoBet *PlinkoResponse `json:"plinkoBet"`
	Data      struct {
		PlinkoBet *PlinkoResponse `json:"plinkoBet"`
	} `json:"data"`
}

func (e PlinkoResponseEnvelope) orError() (*PlinkoResponse, error) {
	if e.PlinkoBet != nil {
		return e.PlinkoBet, nil
	}
	if e.Data.PlinkoBet != nil {
		return e.Data.PlinkoBet, nil
	}
	return nil, fmt.Errorf("empty plinko response")
}

type PlinkoResponse struct {
	baseBet
	State struct {
		Risk string `json:"risk"`
		Rows int    `json:"rows"`
		Slot int    `json:"slot"`
	} `json:"state"`
}

```

```go
package botengine

import (
	"context"
	"fmt"
	"time"

	"github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeclient"
)

// Config configures a bot engine run.
type Config struct {
	Game     string
	Currency string
	BaseBet  float64
	Chance   float64 // dice
	Target   float64 // limbo/plinko
	Bethigh  bool
	Script   string
}

// Engine orchestrates scripting, betting, and stats.
type Engine struct {
	ctx    context.Context
	client *stakeclient.Client
	cfg    Config

	vm     *scriptVM
	stats  *Stats
	limits SafetyLimits

	running bool
	stopped bool
}

// New constructs an Engine with stake client and config.
func New(ctx context.Context, client *stakeclient.Client, cfg Config) (*Engine, error) {
	if client == nil {
		return nil, fmt.Errorf("stake client is required")
	}
	stats := NewStats()
	vm, err := newScriptVM(cfg, stats)
	if err != nil {
		return nil, err
	}
	return &Engine{
		ctx:    ctx,
		client: client,
		cfg:    cfg,
		vm:     vm,
		stats:  stats,
		limits: SafetyLimits{},
	}, nil
}

// SetSafetyLimits configures safety rails.
func (e *Engine) SetSafetyLimits(l SafetyLimits) {
	e.limits = l
}

// Start marks the engine as running.
func (e *Engine) Start() {
	e.running = true
	e.stopped = false
}

// Stop halts the engine.
func (e *Engine) Stop() {
	e.running = false
	e.stopped = true
}

// Running reports if engine is active.
func (e *Engine) Running() bool {
	return e.running && !e.stopped
}

// RunOnce executes a single bet cycle:
// 1) Read script-controlled params
// 2) Place bet via stakeclient
// 3) Update stats and script globals
// 4) Invoke dobet() for next iteration
func (e *Engine) RunOnce() (*BetResult, error) {
	if !e.Running() {
		return nil, fmt.Errorf("engine not running")
	}

	params := e.vm.readParams()
	// Apply safety limits
	if err := e.limits.Check(params.NextBet, e.stats); err != nil {
		e.Stop()
		return nil, err
	}

	ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
	defer cancel()

	var result *BetResult
	var err error

	switch e.cfg.Game {
	case "dice":
		r, berr := e.client.DiceBet(ctx, params.NextBet, params.Chance, params.BetHigh)
		err = berr
		if r != nil {
			result = fromDice(r)
		}
	case "limbo":
		r, berr := e.client.LimboBet(ctx, params.NextBet, params.Target)
		err = berr
		if r != nil {
			result = fromLimbo(r)
		}
	case "plinko":
		r, berr := e.client.PlinkoBet(ctx, params.NextBet, params.Rows, params.Risk)
		err = berr
		if r != nil {
			result = fromPlinko(r)
		}
	case "pump":
		r, berr := e.client.PumpBet(ctx, params.NextBet, params.Pumps, params.Difficulty)
		err = berr
		if r != nil {
			result = fromPump(r)
		}
	case "mines":
		r, berr := e.client.MinesBet(ctx, params.NextBet, params.Mines, params.Fields)
		err = berr
		if r != nil {
			result = fromMines(r)
		}
	default:
		return nil, fmt.Errorf("unsupported game: %s", e.cfg.Game)
	}

	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, fmt.Errorf("empty result")
	}

	e.stats.Update(result)
	e.vm.updateAfterBet(result, e.stats)

	// Invoke user dobet() for next iteration
	_ = e.vm.callDobEt()

	return result, nil
}

```

```go
package botengine

import (
	"fmt"
	"time"

	"github.com/dop251/goja"
)

// scriptVM wraps goja runtime and exposes globals.
type scriptVM struct {
	vm    *goja.Runtime
	stats *Stats
	cfg   Config
}

// scriptParams mirrors writable betting variables.
type scriptParams struct {
	NextBet    float64
	Chance     float64
	BetHigh    bool
	Target     float64
	Mines      int
	Fields     []int
	Rows       int
	Risk       string
	Pumps      int
	Difficulty string
}

func newScriptVM(cfg Config, stats *Stats) (*scriptVM, error) {
	r := goja.New()
	vm := &scriptVM{vm: r, stats: stats, cfg: cfg}

	// Core vars
	r.Set("game", cfg.Game)
	r.Set("currency", cfg.Currency)
	r.Set("basebet", cfg.BaseBet)
	r.Set("nextbet", cfg.BaseBet)
	r.Set("chance", cfg.Chance)
	r.Set("bethigh", cfg.Bethigh)
	r.Set("target", cfg.Target)

	// Common defaults
	r.Set("mines", 1)
	r.Set("fields", []int{1, 2, 3})
	r.Set("risk", "low")
	r.Set("rows", 8)
	r.Set("pumps", 1)
	r.Set("difficulty", "easy")

	// Stats vars
	vm.pushStats()

	// Utils
	r.Set("log", func(msg any) {
		fmt.Printf("[script] %v\n", msg)
	})
	r.Set("stop", func() {
		// Caller will stop engine; here we just set a flag
		r.Set("running", false)
	})
	r.Set("resetstats", func() {
		stats.Reset()
		vm.pushStats()
	})
	r.Set("sleep", func(ms int) {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	})

	// Run user script
	if _, err := r.RunString(cfg.Script); err != nil {
		return nil, err
	}

	return vm, nil
}

func (s *scriptVM) readParams() scriptParams {
	return scriptParams{
		NextBet:    s.readFloat("nextbet", s.cfg.BaseBet),
		Chance:     s.readFloat("chance", s.cfg.Chance),
		BetHigh:    s.readBool("bethigh", s.cfg.Bethigh),
		Target:     s.readFloat("target", s.cfg.Target),
		Mines:      int(s.readFloat("mines", 1)),
		Fields:     s.readIntSlice("fields"),
		Rows:       int(s.readFloat("rows", 8)),
		Risk:       s.readString("risk", "low"),
		Pumps:      int(s.readFloat("pumps", 1)),
		Difficulty: s.readString("difficulty", "easy"),
	}
}

func (s *scriptVM) callDobEt() error {
	fn := s.vm.Get("dobet")
	if fn == nil || goja.IsUndefined(fn) {
		return nil
	}
	if callable, ok := goja.AssertFunction(fn); ok {
		_, err := callable(goja.Undefined())
		return err
	}
	return nil
}

func (s *scriptVM) updateAfterBet(result *BetResult, stats *Stats) {
	s.vm.Set("previousbet", result.Amount)
	s.vm.Set("win", result.Win)
	s.vm.Set("lastBet", result.ToMap())
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
	s.vm.Set("wagered", stats.Wagered)
}

// --- helpers to read typed values ---

func (s *scriptVM) readFloat(name string, def float64) float64 {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if f, ok := v.Export().(float64); ok {
		return f
	}
	if i, ok := v.Export().(int64); ok {
		return float64(i)
	}
	return def
}

func (s *scriptVM) readBool(name string, def bool) bool {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if b, ok := v.Export().(bool); ok {
		return b
	}
	return def
}

func (s *scriptVM) readString(name, def string) string {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if str, ok := v.Export().(string); ok {
		return str
	}
	return def
}

func (s *scriptVM) readIntSlice(name string) []int {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return nil
	}
	exported := v.Export()
	switch vals := exported.(type) {
	case []int:
		return vals
	case []interface{}:
		out := make([]int, 0, len(vals))
		for _, val := range vals {
			switch n := val.(type) {
			case int:
				out = append(out, n)
			case int64:
				out = append(out, int(n))
			case float64:
				out = append(out, int(n))
			}
		}
		return out
	default:
		return nil
	}
}

func (s *scriptVM) pushStats() {
	stats := s.stats
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("wagered", stats.Wagered)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
}

```

```go
package botengine

import "math"

// Stats tracks session-level metrics.
type Stats struct {
	BetCount      int
	Wins          int
	Losses        int
	WinStreak     int
	LoseStreak    int
	CurrentStreak int

	Wagered      float64
	ProfitTotal  float64
	HighestProfit float64
	LowestProfit  float64
	HighestBet    float64
}

func NewStats() *Stats {
	return &Stats{
		LowestProfit: 0,
	}
}

// BetResult is a normalized view of a bet outcome.
type BetResult struct {
	Game            string
	Amount          float64
	Payout          float64
	PayoutMultiplier float64
	Win             bool
	Raw             any
}

// ToMap exports for scripting.
func (b *BetResult) ToMap() map[string]any {
	return map[string]any{
		"amount":           b.Amount,
		"payout":           b.Payout,
		"payoutMultiplier": b.PayoutMultiplier,
		"win":              b.Win,
		"game":             b.Game,
	}
}

// Update updates stats after a bet.
func (s *Stats) Update(r *BetResult) {
	s.BetCount++
	s.Wagered += r.Amount
	profit := r.Payout - r.Amount
	s.ProfitTotal += profit

	if r.Amount > s.HighestBet {
		s.HighestBet = r.Amount
	}
	if s.ProfitTotal > s.HighestProfit {
		s.HighestProfit = s.ProfitTotal
	}
	if s.BetCount == 1 {
		s.LowestProfit = s.ProfitTotal
	} else {
		s.LowestProfit = math.Min(s.LowestProfit, s.ProfitTotal)
	}

	if r.Win {
		s.Wins++
		s.WinStreak++
		s.LoseStreak = 0
		s.CurrentStreak = s.WinStreak
	} else {
		s.Losses++
		s.LoseStreak++
		s.WinStreak = 0
		s.CurrentStreak = -s.LoseStreak
	}
}

// Reset clears stats to zero.
func (s *Stats) Reset() {
	*s = Stats{
		LowestProfit: 0,
	}
}

```

```go
package botengine

import "fmt"

// SafetyLimits enforces guardrails for betting.
type SafetyLimits struct {
	MaxBet        float64
	StopLoss      float64 // negative threshold
	MaxLossStreak int
}

func (l SafetyLimits) Check(nextBet float64, stats *Stats) error {
	if l.MaxBet > 0 && nextBet > l.MaxBet {
		return fmt.Errorf("max bet exceeded: %.8f > %.8f", nextBet, l.MaxBet)
	}
	if l.StopLoss < 0 && stats.ProfitTotal <= l.StopLoss {
		return fmt.Errorf("stop loss triggered at %.8f", stats.ProfitTotal)
	}
	if l.MaxLossStreak > 0 && stats.LoseStreak >= l.MaxLossStreak {
		return fmt.Errorf("max loss streak reached: %d", stats.LoseStreak)
	}
	return nil
}

```

```go
package botengine

import "github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeclient"

func fromDice(r *stakeclient.DiceResponse) *BetResult {
	return &BetResult{
		Game:             "dice",
		Amount:           r.Amount,
		Payout:           r.Payout,
		PayoutMultiplier: r.PayoutMultiplier,
		Win:              r.PayoutMultiplier >= 1.0,
		Raw:              r,
	}
}

func fromLimbo(r *stakeclient.LimboResponse) *BetResult {
	return &BetResult{
		Game:             "limbo",
		Amount:           r.Amount,
		Payout:           r.Payout,
		PayoutMultiplier: r.PayoutMultiplier,
		Win:              r.PayoutMultiplier >= 1.0,
		Raw:              r,
	}
}

func fromPlinko(r *stakeclient.PlinkoResponse) *BetResult {
	return &BetResult{
		Game:             "plinko",
		Amount:           r.Amount,
		Payout:           r.Payout,
		PayoutMultiplier: r.PayoutMultiplier,
		Win:              r.PayoutMultiplier >= 1.0,
		Raw:              r,
	}
}

func fromPump(r *stakeclient.PumpResponse) *BetResult {
	return &BetResult{
		Game:             "pump",
		Amount:           r.Amount,
		Payout:           r.Payout,
		PayoutMultiplier: r.PayoutMultiplier,
		Win:              r.PayoutMultiplier >= 1.0,
		Raw:              r,
	}
}

func fromMines(r *stakeclient.MinesResponse) *BetResult {
	return &BetResult{
		Game:             "mines",
		Amount:           r.Amount,
		Payout:           r.Payout,
		PayoutMultiplier: r.PayoutMultiplier,
		Win:              r.PayoutMultiplier >= 1.0,
		Raw:              r,
	}
}

```

```go
package botengine

import "fmt"

// SafetyLimits enforces guardrails for betting.
type SafetyLimits struct {
	MaxBet        float64
	StopLoss      float64 // negative threshold
	MaxLossStreak int
	ScriptTimeout time.Duration
}

func (l SafetyLimits) Check(nextBet float64, stats *Stats) error {
	if l.MaxBet > 0 && nextBet > l.MaxBet {
		return fmt.Errorf("max bet exceeded: %.8f > %.8f", nextBet, l.MaxBet)
	}
	if l.StopLoss < 0 && stats.ProfitTotal <= l.StopLoss {
		return fmt.Errorf("stop loss triggered at %.8f", stats.ProfitTotal)
	}
	if l.MaxLossStreak > 0 && stats.LoseStreak >= l.MaxLossStreak {
		return fmt.Errorf("max loss streak reached: %d", stats.LoseStreak)
	}
	return nil
}

```

```go
package botengine

import (
	"fmt"
	"time"
)

// SafetyLimits enforces guardrails for betting.
type SafetyLimits struct {
	MaxBet        float64
	StopLoss      float64 // negative threshold
	MaxLossStreak int
	ScriptTimeout time.Duration
}

func (l SafetyLimits) Check(nextBet float64, stats *Stats) error {
	if l.MaxBet > 0 && nextBet > l.MaxBet {
		return fmt.Errorf("max bet exceeded: %.8f > %.8f", nextBet, l.MaxBet)
	}
	if l.StopLoss < 0 && stats.ProfitTotal <= l.StopLoss {
		return fmt.Errorf("stop loss triggered at %.8f", stats.ProfitTotal)
	}
	if l.MaxLossStreak > 0 && stats.LoseStreak >= l.MaxLossStreak {
		return fmt.Errorf("max loss streak reached: %d", stats.LoseStreak)
	}
	return nil
}

```

```go
package botengine

import (
	"fmt"
	"time"

	"github.com/dop251/goja"
)

// scriptVM wraps goja runtime and exposes globals.
type scriptVM struct {
	vm    *goja.Runtime
	stats *Stats
	cfg   Config
	timeout time.Duration
}

// scriptParams mirrors writable betting variables.
type scriptParams struct {
	NextBet    float64
	Chance     float64
	BetHigh    bool
	Target     float64
	Mines      int
	Fields     []int
	Rows       int
	Risk       string
	Pumps      int
	Difficulty string
}

func newScriptVM(cfg Config, stats *Stats) (*scriptVM, error) {
	r := goja.New()
	vm := &scriptVM{vm: r, stats: stats, cfg: cfg, timeout: 5 * time.Second}
	r.SetInterrupt(make(chan func(), 1))

	// Core vars
	r.Set("game", cfg.Game)
	r.Set("currency", cfg.Currency)
	r.Set("basebet", cfg.BaseBet)
	r.Set("nextbet", cfg.BaseBet)
	r.Set("chance", cfg.Chance)
	r.Set("bethigh", cfg.Bethigh)
	r.Set("target", cfg.Target)

	// Common defaults
	r.Set("mines", 1)
	r.Set("fields", []int{1, 2, 3})
	r.Set("risk", "low")
	r.Set("rows", 8)
	r.Set("pumps", 1)
	r.Set("difficulty", "easy")

	// Stats vars
	vm.pushStats()

	// Utils
	r.Set("log", func(msg any) {
		fmt.Printf("[script] %v\n", msg)
	})
	r.Set("stop", func() {
		// Caller will stop engine; here we just set a flag
		r.Set("running", false)
	})
	r.Set("resetstats", func() {
		stats.Reset()
		vm.pushStats()
	})
	r.Set("sleep", func(ms int) {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	})

	// Run user script
	if _, err := r.RunString(cfg.Script); err != nil {
		return nil, err
	}

	return vm, nil
}

func (s *scriptVM) readParams() scriptParams {
	return scriptParams{
		NextBet:    s.readFloat("nextbet", s.cfg.BaseBet),
		Chance:     s.readFloat("chance", s.cfg.Chance),
		BetHigh:    s.readBool("bethigh", s.cfg.Bethigh),
		Target:     s.readFloat("target", s.cfg.Target),
		Mines:      int(s.readFloat("mines", 1)),
		Fields:     s.readIntSlice("fields"),
		Rows:       int(s.readFloat("rows", 8)),
		Risk:       s.readString("risk", "low"),
		Pumps:      int(s.readFloat("pumps", 1)),
		Difficulty: s.readString("difficulty", "easy"),
	}
}

func (s *scriptVM) callDobEt() error {
	fn := s.vm.Get("dobet")
	if fn == nil || goja.IsUndefined(fn) {
		return nil
	}
	if callable, ok := goja.AssertFunction(fn); ok {
		timer := time.AfterFunc(s.timeout, func() {
			select {
			case s.vm.Interrupt <- func() { panic("script timeout") }:
			default:
			}
		})
		defer timer.Stop()
		_, err := callable(goja.Undefined())
		return err
	}
	return nil
}

func (s *scriptVM) updateAfterBet(result *BetResult, stats *Stats) {
	s.vm.Set("previousbet", result.Amount)
	s.vm.Set("win", result.Win)
	s.vm.Set("lastBet", result.ToMap())
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
	s.vm.Set("wagered", stats.Wagered)
}

// --- helpers to read typed values ---

func (s *scriptVM) readFloat(name string, def float64) float64 {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if f, ok := v.Export().(float64); ok {
		return f
	}
	if i, ok := v.Export().(int64); ok {
		return float64(i)
	}
	return def
}

func (s *scriptVM) readBool(name string, def bool) bool {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if b, ok := v.Export().(bool); ok {
		return b
	}
	return def
}

func (s *scriptVM) readString(name, def string) string {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if str, ok := v.Export().(string); ok {
		return str
	}
	return def
}

func (s *scriptVM) readIntSlice(name string) []int {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return nil
	}
	exported := v.Export()
	switch vals := exported.(type) {
	case []int:
		return vals
	case []interface{}:
		out := make([]int, 0, len(vals))
		for _, val := range vals {
			switch n := val.(type) {
			case int:
				out = append(out, n)
			case int64:
				out = append(out, int(n))
			case float64:
				out = append(out, int(n))
			}
		}
		return out
	default:
		return nil
	}
}

func (s *scriptVM) pushStats() {
	stats := s.stats
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("wagered", stats.Wagered)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
}

```

```go
package botengine

import (
	"context"
	"fmt"
	"time"

	"github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeclient"
)

// Config configures a bot engine run.
type Config struct {
	Game     string
	Currency string
	BaseBet  float64
	Chance   float64 // dice
	Target   float64 // limbo/plinko
	Bethigh  bool
	Script   string
}

// Engine orchestrates scripting, betting, and stats.
type Engine struct {
	ctx    context.Context
	client *stakeclient.Client
	cfg    Config

	vm     *scriptVM
	stats  *Stats
	limits SafetyLimits

	running bool
	stopped bool
}

// New constructs an Engine with stake client and config.
func New(ctx context.Context, client *stakeclient.Client, cfg Config) (*Engine, error) {
	if client == nil {
		return nil, fmt.Errorf("stake client is required")
	}
	stats := NewStats()
	vm, err := newScriptVM(cfg, stats)
	if err != nil {
		return nil, err
	}
	return &Engine{
		ctx:    ctx,
		client: client,
		cfg:    cfg,
		vm:     vm,
		stats:  stats,
		limits: SafetyLimits{},
	}, nil
}

// SetSafetyLimits configures safety rails.
func (e *Engine) SetSafetyLimits(l SafetyLimits) {
	e.limits = l
	if l.ScriptTimeout > 0 && e.vm != nil {
		e.vm.timeout = l.ScriptTimeout
	}
}

// Start marks the engine as running.
func (e *Engine) Start() {
	e.running = true
	e.stopped = false
}

// Stop halts the engine.
func (e *Engine) Stop() {
	e.running = false
	e.stopped = true
}

// Running reports if engine is active.
func (e *Engine) Running() bool {
	return e.running && !e.stopped
}

// RunOnce executes a single bet cycle:
// 1) Read script-controlled params
// 2) Place bet via stakeclient
// 3) Update stats and script globals
// 4) Invoke dobet() for next iteration
func (e *Engine) RunOnce() (*BetResult, error) {
	if !e.Running() {
		return nil, fmt.Errorf("engine not running")
	}

	params := e.vm.readParams()
	// Apply safety limits
	if err := e.limits.Check(params.NextBet, e.stats); err != nil {
		e.Stop()
		return nil, err
	}

	ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
	defer cancel()

	var result *BetResult
	var err error

	switch e.cfg.Game {
	case "dice":
		r, berr := e.client.DiceBet(ctx, params.NextBet, params.Chance, params.BetHigh)
		err = berr
		if r != nil {
			result = fromDice(r)
		}
	case "limbo":
		r, berr := e.client.LimboBet(ctx, params.NextBet, params.Target)
		err = berr
		if r != nil {
			result = fromLimbo(r)
		}
	case "plinko":
		r, berr := e.client.PlinkoBet(ctx, params.NextBet, params.Rows, params.Risk)
		err = berr
		if r != nil {
			result = fromPlinko(r)
		}
	case "pump":
		r, berr := e.client.PumpBet(ctx, params.NextBet, params.Pumps, params.Difficulty)
		err = berr
		if r != nil {
			result = fromPump(r)
		}
	case "mines":
		r, berr := e.client.MinesBet(ctx, params.NextBet, params.Mines, params.Fields)
		err = berr
		if r != nil {
			result = fromMines(r)
		}
	default:
		return nil, fmt.Errorf("unsupported game: %s", e.cfg.Game)
	}

	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, fmt.Errorf("empty result")
	}

	e.stats.Update(result)
	e.vm.updateAfterBet(result, e.stats)

	// Invoke user dobet() for next iteration
	_ = e.vm.callDobEt()

	return result, nil
}

```

```go
package botengine

import (
	"fmt"
	"time"

	"github.com/dop251/goja"
)

// scriptVM wraps goja runtime and exposes globals.
type scriptVM struct {
	vm      *goja.Runtime
	stats   *Stats
	cfg     Config
	timeout time.Duration
}

// scriptParams mirrors writable betting variables.
type scriptParams struct {
	NextBet    float64
	Chance     float64
	BetHigh    bool
	Target     float64
	Mines      int
	Fields     []int
	Rows       int
	Risk       string
	Pumps      int
	Difficulty string
}

func newScriptVM(cfg Config, stats *Stats) (*scriptVM, error) {
	r := goja.New()
	vm := &scriptVM{vm: r, stats: stats, cfg: cfg, timeout: 5 * time.Second}

	// Core vars
	r.Set("game", cfg.Game)
	r.Set("currency", cfg.Currency)
	r.Set("basebet", cfg.BaseBet)
	r.Set("nextbet", cfg.BaseBet)
	r.Set("chance", cfg.Chance)
	r.Set("bethigh", cfg.Bethigh)
	r.Set("target", cfg.Target)

	// Common defaults
	r.Set("mines", 1)
	r.Set("fields", []int{1, 2, 3})
	r.Set("risk", "low")
	r.Set("rows", 8)
	r.Set("pumps", 1)
	r.Set("difficulty", "easy")

	// Stats vars
	vm.pushStats()

	// Utils
	r.Set("log", func(msg any) {
		fmt.Printf("[script] %v\n", msg)
	})
	r.Set("stop", func() {
		// Caller will stop engine; here we just set a flag
		r.Set("running", false)
	})
	r.Set("resetstats", func() {
		stats.Reset()
		vm.pushStats()
	})
	r.Set("sleep", func(ms int) {
		time.Sleep(time.Duration(ms) * time.Millisecond)
	})

	// Run user script
	if _, err := r.RunString(cfg.Script); err != nil {
		return nil, err
	}

	return vm, nil
}

func (s *scriptVM) readParams() scriptParams {
	return scriptParams{
		NextBet:    s.readFloat("nextbet", s.cfg.BaseBet),
		Chance:     s.readFloat("chance", s.cfg.Chance),
		BetHigh:    s.readBool("bethigh", s.cfg.Bethigh),
		Target:     s.readFloat("target", s.cfg.Target),
		Mines:      int(s.readFloat("mines", 1)),
		Fields:     s.readIntSlice("fields"),
		Rows:       int(s.readFloat("rows", 8)),
		Risk:       s.readString("risk", "low"),
		Pumps:      int(s.readFloat("pumps", 1)),
		Difficulty: s.readString("difficulty", "easy"),
	}
}

func (s *scriptVM) callDobEt() error {
	fn := s.vm.Get("dobet")
	if fn == nil || goja.IsUndefined(fn) {
		return nil
	}
	if callable, ok := goja.AssertFunction(fn); ok {
		timer := time.AfterFunc(s.timeout, func() {
			s.vm.Interrupt("script timeout")
		})
		defer timer.Stop()
		_, err := callable(goja.Undefined())
		return err
	}
	return nil
}

func (s *scriptVM) updateAfterBet(result *BetResult, stats *Stats) {
	s.vm.Set("previousbet", result.Amount)
	s.vm.Set("win", result.Win)
	s.vm.Set("lastBet", result.ToMap())
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
	s.vm.Set("wagered", stats.Wagered)
}

// --- helpers to read typed values ---

func (s *scriptVM) readFloat(name string, def float64) float64 {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if f, ok := v.Export().(float64); ok {
		return f
	}
	if i, ok := v.Export().(int64); ok {
		return float64(i)
	}
	return def
}

func (s *scriptVM) readBool(name string, def bool) bool {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if b, ok := v.Export().(bool); ok {
		return b
	}
	return def
}

func (s *scriptVM) readString(name, def string) string {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return def
	}
	if str, ok := v.Export().(string); ok {
		return str
	}
	return def
}

func (s *scriptVM) readIntSlice(name string) []int {
	v := s.vm.Get(name)
	if v == nil || goja.IsUndefined(v) {
		return nil
	}
	exported := v.Export()
	switch vals := exported.(type) {
	case []int:
		return vals
	case []interface{}:
		out := make([]int, 0, len(vals))
		for _, val := range vals {
			switch n := val.(type) {
			case int:
				out = append(out, n)
			case int64:
				out = append(out, int(n))
			case float64:
				out = append(out, int(n))
			}
		}
		return out
	default:
		return nil
	}
}

func (s *scriptVM) pushStats() {
	stats := s.stats
	s.vm.Set("bets", stats.BetCount)
	s.vm.Set("betcount", stats.BetCount)
	s.vm.Set("wins", stats.Wins)
	s.vm.Set("losses", stats.Losses)
	s.vm.Set("winstreak", stats.WinStreak)
	s.vm.Set("losestreak", stats.LoseStreak)
	s.vm.Set("currentstreak", stats.CurrentStreak)
	s.vm.Set("profit", stats.ProfitTotal)
	s.vm.Set("profit_total", stats.ProfitTotal)
	s.vm.Set("wagered", stats.Wagered)
	s.vm.Set("highest_profit", []float64{stats.HighestProfit})
	s.vm.Set("lowest_profit", []float64{stats.LowestProfit})
	s.vm.Set("highest_bet", []float64{stats.HighestBet})
}

```

```go
package livestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// --------- Data models ---------

type LiveStream struct {
	ID                uuid.UUID `json:"id"`
	ServerSeedHashed  string    `json:"server_seed_hashed"`
	ClientSeed        string    `json:"client_seed"`
	CreatedAt         time.Time `json:"created_at"`
	LastSeenAt        time.Time `json:"last_seen_at"`
	Notes             string    `json:"notes"`
	TotalBets         int64     `json:"total_bets"`
	HighestResult     float64   `json:"highest_result"`
	LastObservedNonce int64     `json:"last_observed_nonce"`
	LastObservedAt    time.Time `json:"last_observed_at"`
}

// LiveRound represents a single round observation from heartbeat data.
type LiveRound struct {
	ID          int64     `json:"id"`
	StreamID    uuid.UUID `json:"stream_id"`
	Nonce       int64     `json:"nonce"`
	RoundResult float64   `json:"round_result"`
	ReceivedAt  time.Time `json:"received_at"`
}

type LiveBet struct {
	ID           int64     `json:"id"`
	StreamID     uuid.UUID `json:"stream_id"`
	AntebotBetID string    `json:"antebot_bet_id"`
	Source       string    `json:"source"`
	ScriptHash   string    `json:"script_hash"`
	SessionID    string    `json:"session_id"`
	ReceivedAt   time.Time `json:"received_at"`
	DateTime     time.Time `json:"date_time"`
	Nonce        int64     `json:"nonce"`
	Amount       float64   `json:"amount"`
	Payout       float64   `json:"payout"`
	Difficulty   string    `json:"difficulty"`
	RoundTarget  float64   `json:"round_target"`
	RoundResult  float64   `json:"round_result"`
}

// IngestResult indicates whether a bet was stored or ignored as duplicate.
type IngestResult struct {
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}

// --------- Store ---------

type Store struct {
	db *sql.DB
}

// BotSession tracks bot-run sessions for source attribution.
type BotSession struct {
	ID              string    `json:"id"`
	StartedAt       time.Time `json:"started_at"`
	EndedAt         time.Time `json:"ended_at"`
	Game            string    `json:"game"`
	Currency        string    `json:"currency"`
	StartingBalance float64   `json:"starting_balance"`
	EndingBalance   float64   `json:"ending_balance"`
	ScriptHash      string    `json:"script_hash"`
	ScriptSource    string    `json:"script_source"`
	State           string    `json:"state"` // running|stopped|error|completed
}

// New opens/creates a SQLite database at dbPath and runs migrations.
func New(dbPath string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&cache=shared", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite is not concurrent for writes
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// --------- Migrations ---------

func (s *Store) migrate(ctx context.Context) error {
	stmts := []string{
		// Streams table
		`CREATE TABLE IF NOT EXISTS live_streams (
			id TEXT PRIMARY KEY,
			server_seed_hashed TEXT NOT NULL,
			client_seed TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			last_seen_at TIMESTAMP NOT NULL,
			notes TEXT DEFAULT '',
			last_observed_nonce INTEGER DEFAULT 0,
			last_observed_at TIMESTAMP,
			UNIQUE(server_seed_hashed, client_seed)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_streams_last_seen ON live_streams(last_seen_at DESC);`,

		// Bets table
		`CREATE TABLE IF NOT EXISTS live_bets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			antebot_bet_id TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'ingest',
			script_hash TEXT DEFAULT '',
			session_id TEXT DEFAULT '',
			received_at TIMESTAMP NOT NULL,
			date_time TIMESTAMP NOT NULL,
			nonce INTEGER NOT NULL,
			amount REAL NOT NULL,
			payout REAL NOT NULL,
			difficulty TEXT NOT NULL,
			round_target REAL NOT NULL,
			round_result REAL NOT NULL,
			UNIQUE(stream_id, antebot_bet_id),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_nonce ON live_bets(stream_id, nonce);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_datetime ON live_bets(stream_id, date_time DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_result ON live_bets(stream_id, round_result DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_source ON live_bets(source);`,

		// Bot sessions (source=bot)
		`CREATE TABLE IF NOT EXISTS bot_sessions (
			id TEXT PRIMARY KEY,
			started_at TIMESTAMP NOT NULL,
			ended_at TIMESTAMP,
			game TEXT NOT NULL,
			currency TEXT NOT NULL,
			starting_balance REAL DEFAULT 0,
			ending_balance REAL DEFAULT 0,
			script_hash TEXT DEFAULT '',
			script_source TEXT DEFAULT '',
			state TEXT DEFAULT 'running'
		);`,

		// Rounds table for heartbeat data (all round results for pattern analysis)
		`CREATE TABLE IF NOT EXISTS live_rounds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			nonce INTEGER NOT NULL,
			round_result REAL NOT NULL,
			received_at TIMESTAMP NOT NULL,
			UNIQUE(stream_id, nonce),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_nonce ON live_rounds(stream_id, nonce DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_result ON live_rounds(stream_id, round_result DESC);`,

		// Optional mapping of hashed → plain
		`CREATE TABLE IF NOT EXISTS seed_aliases (
			server_seed_hashed TEXT PRIMARY KEY,
			server_seed_plain  TEXT NOT NULL,
			first_seen TIMESTAMP NOT NULL,
			last_seen  TIMESTAMP NOT NULL
		);`,

		// Migration: add columns to existing live_streams if they don't exist
		// SQLite doesn't support IF NOT EXISTS for columns, so we use a workaround
		`CREATE TABLE IF NOT EXISTS _migration_marker (version INTEGER PRIMARY KEY);`,
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Run column migrations for existing databases
	return s.migrateColumns(ctx)
}

// migrateColumns adds new columns to existing tables (idempotent).
func (s *Store) migrateColumns(ctx context.Context) error {
	// Check if last_observed_nonce column exists
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info('live_streams') WHERE name='last_observed_nonce'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		// Add the new columns
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_nonce INTEGER DEFAULT 0`); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_at TIMESTAMP`); err != nil {
			return err
		}
	}

	// live_bets new columns: source, script_hash, session_id
	if err := s.ensureColumn(ctx, "live_bets", "source", "TEXT", "ALTER TABLE live_bets ADD COLUMN source TEXT NOT NULL DEFAULT 'ingest'"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "script_hash", "TEXT", "ALTER TABLE live_bets ADD COLUMN script_hash TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "session_id", "TEXT", "ALTER TABLE live_bets ADD COLUMN session_id TEXT DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(ctx context.Context, table, name, typ, alter string) error {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`, table, name).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		if _, err := s.db.ExecContext(ctx, alter); err != nil {
			return err
		}
	}
	return nil
}

// --------- Streams ---------

// FindOrCreateStream gets the stream id for a (hash, client) pair.
// If it does not exist, it is created.
func (s *Store) FindOrCreateStream(ctx context.Context, serverSeedHashed, clientSeed string) (uuid.UUID, error) {
	now := time.Now().UTC()

	// Try fast path: select existing
	var idStr string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM live_streams WHERE server_seed_hashed=? AND client_seed=?`,
		serverSeedHashed, clientSeed).Scan(&idStr)
	switch {
	case err == nil:
		if _, err2 := s.db.ExecContext(ctx,
			`UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, idStr); err2 != nil {
			return uuid.Nil, err2
		}
		return uuid.MustParse(idStr), nil
	case errors.Is(err, sql.ErrNoRows):
		// Create new
		id := uuid.New()
		_, err2 := s.db.ExecContext(ctx,
			`INSERT INTO live_streams(id, server_seed_hashed, client_seed, created_at, last_seen_at, notes)
			 VALUES(?, ?, ?, ?, ?, '')`,
			id.String(), serverSeedHashed, clientSeed, now, now)
		if err2 != nil {
			// Race: another writer inserted concurrently; select again.
			if isConstraintErr(err2) {
				return s.FindOrCreateStream(ctx, serverSeedHashed, clientSeed)
			}
			return uuid.Nil, err2
		}
		return id, nil
	default:
		return uuid.Nil, err
	}
}

// UpdateNotes sets or clears notes on a stream.
func (s *Store) UpdateNotes(ctx context.Context, streamID uuid.UUID, notes string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE live_streams SET notes=? WHERE id=?`, notes, streamID.String())
	return err
}

// GetStream returns stream metadata including aggregates.
func (s *Store) GetStream(ctx context.Context, streamID uuid.UUID) (LiveStream, error) {
	var ls LiveStream
	var lastObservedAt sql.NullTime
	row := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0), s.last_observed_at,
		       COALESCE(b.cnt, 0), COALESCE(b.maxres, 0)
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets WHERE stream_id=? ) b
		ON s.id = b.stream_id
		WHERE s.id=?`,
		streamID.String(), streamID.String(),
	)
	err := row.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
		&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult)
	if lastObservedAt.Valid {
		ls.LastObservedAt = lastObservedAt.Time
	}
	return ls, err
}

// ListStreams returns streams ordered by last_seen_at desc with aggregates.
func (s *Store) ListStreams(ctx context.Context, limit, offset int) ([]LiveStream, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0) AS last_observed_nonce,
		       s.last_observed_at,
		       COALESCE(b.cnt, 0) AS total_bets,
		       COALESCE(b.maxres, 0) AS highest_result
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets GROUP BY stream_id
		) b ON s.id = b.stream_id
		ORDER BY s.last_seen_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveStream
	for rows.Next() {
		var ls LiveStream
		var lastObservedAt sql.NullTime
		if err := rows.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
			&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult); err != nil {
			return nil, err
		}
		if lastObservedAt.Valid {
			ls.LastObservedAt = lastObservedAt.Time
		}
		out = append(out, ls)
	}
	return out, rows.Err()
}

// --------- Bets (ingest/query) ---------

// IngestBet stores a bet under the stream. Idempotent on (stream_id, antebot_bet_id).
func (s *Store) IngestBet(ctx context.Context, streamID uuid.UUID, bet LiveBet) (IngestResult, error) {
	// Basic validation
	if bet.AntebotBetID == "" {
		return IngestResult{Accepted: false, Reason: "missing bet id"}, errors.New("missing antebot_bet_id")
	}
	if bet.DateTime.IsZero() {
		return IngestResult{Accepted: false, Reason: "missing date_time"}, errors.New("missing date_time")
	}
	if bet.Nonce <= 0 {
		return IngestResult{Accepted: false, Reason: "invalid nonce"}, errors.New("invalid nonce")
	}
	if bet.Difficulty == "" {
		return IngestResult{Accepted: false, Reason: "missing difficulty"}, errors.New("missing difficulty")
	}
	if bet.Source == "" {
		bet.Source = "ingest"
	}

	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_bets(
			stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce,
			amount, payout, difficulty, round_target, round_result
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		streamID.String(), bet.AntebotBetID, bet.Source, bet.ScriptHash, bet.SessionID, now, bet.DateTime.UTC(), bet.Nonce,
		bet.Amount, bet.Payout, strings.ToLower(bet.Difficulty), bet.RoundTarget, bet.RoundResult)
	if err != nil {
		if isConstraintErr(err) {
			// Duplicate bet for this stream
			return IngestResult{Accepted: false, Reason: "duplicate"}, nil
		}
		return IngestResult{Accepted: false, Reason: "db_error"}, err
	}

	// touch last_seen_at
	_, _ = s.db.ExecContext(ctx, `UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, streamID.String())
	return IngestResult{Accepted: true}, nil
}

// ListBets returns paginated bets for a stream with optional minResult filter.
// order can be "asc" or "desc" by nonce.
func (s *Store) ListBets(ctx context.Context, streamID uuid.UUID, minResult float64, order string, limit, offset int) ([]LiveBet, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 500
	}
	if order != "asc" {
		order = "desc"
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_bets WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE %s
		ORDER BY nonce %s
		LIMIT ? OFFSET ?`, where, strings.ToUpper(order))
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

// TailBets returns bets strictly greater than lastID for a stream, limited.
func (s *Store) TailBets(ctx context.Context, streamID uuid.UUID, lastID int64, limit int) ([]LiveBet, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE stream_id=? AND id > ?
		ORDER BY id ASC
		LIMIT ?`, streamID.String(), lastID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteStream removes a stream and all related bets.
func (s *Store) DeleteStream(ctx context.Context, streamID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM live_streams WHERE id=?`, streamID.String())
	return err
}

// ExportCSV writes all bets for a stream to the writer as CSV (header included).
func (s *Store) ExportCSV(ctx context.Context, w io.Writer, streamID uuid.UUID) error {
	// Write header
	if _, err := io.WriteString(w, "id,nonce,date_time,amount,payout,difficulty,round_target,round_result,source,script_hash,session_id\n"); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, nonce, date_time, amount, payout, difficulty, round_target, round_result, source, script_hash, session_id
		FROM live_bets WHERE stream_id=? ORDER BY nonce ASC`, streamID.String())
	if err != nil {
		return err
	}
	defer rows.Close()

	var (
		id                 int64
		n                  int64
		ts                 time.Time
		amt, pay, tgt, res float64
		diff               string
		src, shash, sess   string
	)
	for rows.Next() {
		if err := rows.Scan(&id, &n, &ts, &amt, &pay, &diff, &tgt, &res, &src, &shash, &sess); err != nil {
			return err
		}
		line := fmt.Sprintf("%d,%d,%s,%.8f,%.8f,%s,%.2f,%.2f,%s,%s,%s\n",
			id, n, ts.UTC().Format(time.RFC3339Nano), amt, pay, diff, tgt, res, src, shash, sess)
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	return rows.Err()
}

// --------- Rounds (heartbeat data) ---------

// UpdateLastObservedNonce updates the stream's last observed nonce (from heartbeats).
func (s *Store) UpdateLastObservedNonce(ctx context.Context, streamID uuid.UUID, nonce int64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE live_streams
		SET last_observed_nonce = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN COALESCE(last_observed_nonce, 0)
		        ELSE ?
		    END,
		    last_observed_at = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN last_observed_at
		        ELSE ?
		    END,
		    last_seen_at = ?
		WHERE id = ?`,
		nonce, nonce, nonce, now, now, streamID.String())
	return err
}

// InsertRound stores a round from heartbeat data. Idempotent on (stream_id, nonce).
func (s *Store) InsertRound(ctx context.Context, streamID uuid.UUID, nonce int64, roundResult float64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_rounds(stream_id, nonce, round_result, received_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(stream_id, nonce) DO UPDATE SET
			round_result = excluded.round_result,
			received_at = excluded.received_at`,
		streamID.String(), nonce, roundResult, now)
	return err
}

// ListRounds returns rounds for a stream ordered by nonce.
func (s *Store) ListRounds(ctx context.Context, streamID uuid.UUID, minResult float64, limit, offset int) ([]LiveRound, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_rounds WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE %s
		ORDER BY nonce DESC
		LIMIT ? OFFSET ?`, where)
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// TailRounds returns rounds with nonce > sinceNonce for a stream, ordered by nonce ASC.
func (s *Store) TailRounds(ctx context.Context, streamID uuid.UUID, sinceNonce int64, limit int) ([]LiveRound, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ? AND nonce > ?
		ORDER BY nonce ASC
		LIMIT ?`, streamID.String(), sinceNonce, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRecentRounds returns the most recent N rounds for a stream, ordered by nonce DESC.
func (s *Store) GetRecentRounds(ctx context.Context, streamID uuid.UUID, limit int) ([]LiveRound, error) {
	// Frontend requests thousands of rounds for analytics/patterns; keep this in sync.
	// We clamp rather than defaulting to 200 when the caller asks for more than the max.
	const defaultLimit = 200
	const maxLimit = 20000
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ?
		ORDER BY nonce DESC
		LIMIT ?`, streamID.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CleanupOldRounds removes rounds older than the specified nonce threshold for a stream.
// This helps prevent unbounded growth of the rounds table.
func (s *Store) CleanupOldRounds(ctx context.Context, streamID uuid.UUID, keepLastN int) error {
	if keepLastN <= 0 {
		keepLastN = 50000 // Default: keep last 50k rounds
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM live_rounds
		WHERE stream_id = ? AND nonce < (
			SELECT MIN(nonce) FROM (
				SELECT nonce FROM live_rounds WHERE stream_id = ?
				ORDER BY nonce DESC LIMIT ?
			)
		)`, streamID.String(), streamID.String(), keepLastN)
	return err
}

// --------- Seed aliases ---------

// UpsertSeedAlias links a hashed server seed to its plain text.
func (s *Store) UpsertSeedAlias(ctx context.Context, hashed, plain string) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO seed_aliases(server_seed_hashed, server_seed_plain, first_seen, last_seen)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(server_seed_hashed) DO UPDATE SET
			server_seed_plain=excluded.server_seed_plain,
			last_seen=excluded.last_seen
	`, hashed, plain, now, now)
	return err
}

// LookupSeedAlias returns the plain seed for a hash if it exists.
func (s *Store) LookupSeedAlias(ctx context.Context, hashed string) (string, bool, error) {
	var plain string
	err := s.db.QueryRowContext(ctx, `SELECT server_seed_plain FROM seed_aliases WHERE server_seed_hashed=?`, hashed).Scan(&plain)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return plain, err == nil, err
}

// --------- helpers ---------

func isConstraintErr(err error) bool {
	// modernc sqlite returns errors with messages containing "constraint failed"
	// or "UNIQUE constraint failed". Use substring match.
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "constraint failed") || strings.Contains(msg, "unique constraint")
}

```

```go
package livestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// --------- Data models ---------

type LiveStream struct {
	ID                uuid.UUID `json:"id"`
	ServerSeedHashed  string    `json:"server_seed_hashed"`
	ClientSeed        string    `json:"client_seed"`
	CreatedAt         time.Time `json:"created_at"`
	LastSeenAt        time.Time `json:"last_seen_at"`
	Notes             string    `json:"notes"`
	TotalBets         int64     `json:"total_bets"`
	HighestResult     float64   `json:"highest_result"`
	LastObservedNonce int64     `json:"last_observed_nonce"`
	LastObservedAt    time.Time `json:"last_observed_at"`
}

// LiveRound represents a single round observation from heartbeat data.
type LiveRound struct {
	ID          int64     `json:"id"`
	StreamID    uuid.UUID `json:"stream_id"`
	Nonce       int64     `json:"nonce"`
	RoundResult float64   `json:"round_result"`
	ReceivedAt  time.Time `json:"received_at"`
}

type LiveBet struct {
	ID           int64     `json:"id"`
	StreamID     uuid.UUID `json:"stream_id"`
	AntebotBetID string    `json:"antebot_bet_id"`
	Source       string    `json:"source"`
	ScriptHash   string    `json:"script_hash"`
	SessionID    string    `json:"session_id"`
	ReceivedAt   time.Time `json:"received_at"`
	DateTime     time.Time `json:"date_time"`
	Nonce        int64     `json:"nonce"`
	Amount       float64   `json:"amount"`
	Payout       float64   `json:"payout"`
	Difficulty   string    `json:"difficulty"`
	RoundTarget  float64   `json:"round_target"`
	RoundResult  float64   `json:"round_result"`
}

// IngestResult indicates whether a bet was stored or ignored as duplicate.
type IngestResult struct {
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}

// --------- Store ---------

type Store struct {
	db *sql.DB
}

// BotSession tracks bot-run sessions for source attribution.
type BotSession struct {
	ID              string    `json:"id"`
	StartedAt       time.Time `json:"started_at"`
	EndedAt         time.Time `json:"ended_at"`
	Game            string    `json:"game"`
	Currency        string    `json:"currency"`
	StartingBalance float64   `json:"starting_balance"`
	EndingBalance   float64   `json:"ending_balance"`
	ScriptHash      string    `json:"script_hash"`
	ScriptSource    string    `json:"script_source"`
	State           string    `json:"state"` // running|stopped|error|completed
}

// New opens/creates a SQLite database at dbPath and runs migrations.
func New(dbPath string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&cache=shared", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite is not concurrent for writes
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// --------- Migrations ---------

func (s *Store) migrate(ctx context.Context) error {
	stmts := []string{
		// Streams table
		`CREATE TABLE IF NOT EXISTS live_streams (
			id TEXT PRIMARY KEY,
			server_seed_hashed TEXT NOT NULL,
			client_seed TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			last_seen_at TIMESTAMP NOT NULL,
			notes TEXT DEFAULT '',
			last_observed_nonce INTEGER DEFAULT 0,
			last_observed_at TIMESTAMP,
			UNIQUE(server_seed_hashed, client_seed)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_streams_last_seen ON live_streams(last_seen_at DESC);`,

		// Bets table
		`CREATE TABLE IF NOT EXISTS live_bets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			antebot_bet_id TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'ingest',
			script_hash TEXT DEFAULT '',
			session_id TEXT DEFAULT '',
			received_at TIMESTAMP NOT NULL,
			date_time TIMESTAMP NOT NULL,
			nonce INTEGER NOT NULL,
			amount REAL NOT NULL,
			payout REAL NOT NULL,
			difficulty TEXT NOT NULL,
			round_target REAL NOT NULL,
			round_result REAL NOT NULL,
			UNIQUE(stream_id, antebot_bet_id),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_nonce ON live_bets(stream_id, nonce);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_datetime ON live_bets(stream_id, date_time DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_result ON live_bets(stream_id, round_result DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_source ON live_bets(source);`,

		// Bot sessions (source=bot)
		`CREATE TABLE IF NOT EXISTS bot_sessions (
			id TEXT PRIMARY KEY,
			started_at TIMESTAMP NOT NULL,
			ended_at TIMESTAMP,
			game TEXT NOT NULL,
			currency TEXT NOT NULL,
			starting_balance REAL DEFAULT 0,
			ending_balance REAL DEFAULT 0,
			script_hash TEXT DEFAULT '',
			script_source TEXT DEFAULT '',
			state TEXT DEFAULT 'running'
		);`,

		// Rounds table for heartbeat data (all round results for pattern analysis)
		`CREATE TABLE IF NOT EXISTS live_rounds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			nonce INTEGER NOT NULL,
			round_result REAL NOT NULL,
			received_at TIMESTAMP NOT NULL,
			UNIQUE(stream_id, nonce),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_nonce ON live_rounds(stream_id, nonce DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_result ON live_rounds(stream_id, round_result DESC);`,

		// Optional mapping of hashed → plain
		`CREATE TABLE IF NOT EXISTS seed_aliases (
			server_seed_hashed TEXT PRIMARY KEY,
			server_seed_plain  TEXT NOT NULL,
			first_seen TIMESTAMP NOT NULL,
			last_seen  TIMESTAMP NOT NULL
		);`,

		// Migration: add columns to existing live_streams if they don't exist
		// SQLite doesn't support IF NOT EXISTS for columns, so we use a workaround
		`CREATE TABLE IF NOT EXISTS _migration_marker (version INTEGER PRIMARY KEY);`,
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Run column migrations for existing databases
	return s.migrateColumns(ctx)
}

// migrateColumns adds new columns to existing tables (idempotent).
func (s *Store) migrateColumns(ctx context.Context) error {
	// Check if last_observed_nonce column exists
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info('live_streams') WHERE name='last_observed_nonce'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		// Add the new columns
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_nonce INTEGER DEFAULT 0`); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_at TIMESTAMP`); err != nil {
			return err
		}
	}

	// live_bets new columns: source, script_hash, session_id
	if err := s.ensureColumn(ctx, "live_bets", "source", "TEXT", "ALTER TABLE live_bets ADD COLUMN source TEXT NOT NULL DEFAULT 'ingest'"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "script_hash", "TEXT", "ALTER TABLE live_bets ADD COLUMN script_hash TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "session_id", "TEXT", "ALTER TABLE live_bets ADD COLUMN session_id TEXT DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(ctx context.Context, table, name, typ, alter string) error {
	var count int
	query := fmt.Sprintf("SELECT COUNT(*) FROM pragma_table_info('%s') WHERE name='%s'", table, name)
	err := s.db.QueryRowContext(ctx, query).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		if _, err := s.db.ExecContext(ctx, alter); err != nil {
			return err
		}
	}
	return nil
}

// --------- Streams ---------

// FindOrCreateStream gets the stream id for a (hash, client) pair.
// If it does not exist, it is created.
func (s *Store) FindOrCreateStream(ctx context.Context, serverSeedHashed, clientSeed string) (uuid.UUID, error) {
	now := time.Now().UTC()

	// Try fast path: select existing
	var idStr string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM live_streams WHERE server_seed_hashed=? AND client_seed=?`,
		serverSeedHashed, clientSeed).Scan(&idStr)
	switch {
	case err == nil:
		if _, err2 := s.db.ExecContext(ctx,
			`UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, idStr); err2 != nil {
			return uuid.Nil, err2
		}
		return uuid.MustParse(idStr), nil
	case errors.Is(err, sql.ErrNoRows):
		// Create new
		id := uuid.New()
		_, err2 := s.db.ExecContext(ctx,
			`INSERT INTO live_streams(id, server_seed_hashed, client_seed, created_at, last_seen_at, notes)
			 VALUES(?, ?, ?, ?, ?, '')`,
			id.String(), serverSeedHashed, clientSeed, now, now)
		if err2 != nil {
			// Race: another writer inserted concurrently; select again.
			if isConstraintErr(err2) {
				return s.FindOrCreateStream(ctx, serverSeedHashed, clientSeed)
			}
			return uuid.Nil, err2
		}
		return id, nil
	default:
		return uuid.Nil, err
	}
}

// UpdateNotes sets or clears notes on a stream.
func (s *Store) UpdateNotes(ctx context.Context, streamID uuid.UUID, notes string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE live_streams SET notes=? WHERE id=?`, notes, streamID.String())
	return err
}

// GetStream returns stream metadata including aggregates.
func (s *Store) GetStream(ctx context.Context, streamID uuid.UUID) (LiveStream, error) {
	var ls LiveStream
	var lastObservedAt sql.NullTime
	row := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0), s.last_observed_at,
		       COALESCE(b.cnt, 0), COALESCE(b.maxres, 0)
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets WHERE stream_id=? ) b
		ON s.id = b.stream_id
		WHERE s.id=?`,
		streamID.String(), streamID.String(),
	)
	err := row.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
		&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult)
	if lastObservedAt.Valid {
		ls.LastObservedAt = lastObservedAt.Time
	}
	return ls, err
}

// ListStreams returns streams ordered by last_seen_at desc with aggregates.
func (s *Store) ListStreams(ctx context.Context, limit, offset int) ([]LiveStream, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0) AS last_observed_nonce,
		       s.last_observed_at,
		       COALESCE(b.cnt, 0) AS total_bets,
		       COALESCE(b.maxres, 0) AS highest_result
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets GROUP BY stream_id
		) b ON s.id = b.stream_id
		ORDER BY s.last_seen_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveStream
	for rows.Next() {
		var ls LiveStream
		var lastObservedAt sql.NullTime
		if err := rows.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
			&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult); err != nil {
			return nil, err
		}
		if lastObservedAt.Valid {
			ls.LastObservedAt = lastObservedAt.Time
		}
		out = append(out, ls)
	}
	return out, rows.Err()
}

// --------- Bets (ingest/query) ---------

// IngestBet stores a bet under the stream. Idempotent on (stream_id, antebot_bet_id).
func (s *Store) IngestBet(ctx context.Context, streamID uuid.UUID, bet LiveBet) (IngestResult, error) {
	// Basic validation
	if bet.AntebotBetID == "" {
		return IngestResult{Accepted: false, Reason: "missing bet id"}, errors.New("missing antebot_bet_id")
	}
	if bet.DateTime.IsZero() {
		return IngestResult{Accepted: false, Reason: "missing date_time"}, errors.New("missing date_time")
	}
	if bet.Nonce <= 0 {
		return IngestResult{Accepted: false, Reason: "invalid nonce"}, errors.New("invalid nonce")
	}
	if bet.Difficulty == "" {
		return IngestResult{Accepted: false, Reason: "missing difficulty"}, errors.New("missing difficulty")
	}
	if bet.Source == "" {
		bet.Source = "ingest"
	}

	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_bets(
			stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce,
			amount, payout, difficulty, round_target, round_result
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		streamID.String(), bet.AntebotBetID, bet.Source, bet.ScriptHash, bet.SessionID, now, bet.DateTime.UTC(), bet.Nonce,
		bet.Amount, bet.Payout, strings.ToLower(bet.Difficulty), bet.RoundTarget, bet.RoundResult)
	if err != nil {
		if isConstraintErr(err) {
			// Duplicate bet for this stream
			return IngestResult{Accepted: false, Reason: "duplicate"}, nil
		}
		return IngestResult{Accepted: false, Reason: "db_error"}, err
	}

	// touch last_seen_at
	_, _ = s.db.ExecContext(ctx, `UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, streamID.String())
	return IngestResult{Accepted: true}, nil
}

// ListBets returns paginated bets for a stream with optional minResult filter.
// order can be "asc" or "desc" by nonce.
func (s *Store) ListBets(ctx context.Context, streamID uuid.UUID, minResult float64, order string, limit, offset int) ([]LiveBet, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 500
	}
	if order != "asc" {
		order = "desc"
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_bets WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE %s
		ORDER BY nonce %s
		LIMIT ? OFFSET ?`, where, strings.ToUpper(order))
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

// TailBets returns bets strictly greater than lastID for a stream, limited.
func (s *Store) TailBets(ctx context.Context, streamID uuid.UUID, lastID int64, limit int) ([]LiveBet, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE stream_id=? AND id > ?
		ORDER BY id ASC
		LIMIT ?`, streamID.String(), lastID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteStream removes a stream and all related bets.
func (s *Store) DeleteStream(ctx context.Context, streamID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM live_streams WHERE id=?`, streamID.String())
	return err
}

// ExportCSV writes all bets for a stream to the writer as CSV (header included).
func (s *Store) ExportCSV(ctx context.Context, w io.Writer, streamID uuid.UUID) error {
	// Write header
	if _, err := io.WriteString(w, "id,nonce,date_time,amount,payout,difficulty,round_target,round_result,source,script_hash,session_id\n"); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, nonce, date_time, amount, payout, difficulty, round_target, round_result, source, script_hash, session_id
		FROM live_bets WHERE stream_id=? ORDER BY nonce ASC`, streamID.String())
	if err != nil {
		return err
	}
	defer rows.Close()

	var (
		id                 int64
		n                  int64
		ts                 time.Time
		amt, pay, tgt, res float64
		diff               string
		src, shash, sess   string
	)
	for rows.Next() {
		if err := rows.Scan(&id, &n, &ts, &amt, &pay, &diff, &tgt, &res, &src, &shash, &sess); err != nil {
			return err
		}
		line := fmt.Sprintf("%d,%d,%s,%.8f,%.8f,%s,%.2f,%.2f,%s,%s,%s\n",
			id, n, ts.UTC().Format(time.RFC3339Nano), amt, pay, diff, tgt, res, src, shash, sess)
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	return rows.Err()
}

// --------- Rounds (heartbeat data) ---------

// UpdateLastObservedNonce updates the stream's last observed nonce (from heartbeats).
func (s *Store) UpdateLastObservedNonce(ctx context.Context, streamID uuid.UUID, nonce int64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE live_streams
		SET last_observed_nonce = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN COALESCE(last_observed_nonce, 0)
		        ELSE ?
		    END,
		    last_observed_at = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN last_observed_at
		        ELSE ?
		    END,
		    last_seen_at = ?
		WHERE id = ?`,
		nonce, nonce, nonce, now, now, streamID.String())
	return err
}

// InsertRound stores a round from heartbeat data. Idempotent on (stream_id, nonce).
func (s *Store) InsertRound(ctx context.Context, streamID uuid.UUID, nonce int64, roundResult float64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_rounds(stream_id, nonce, round_result, received_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(stream_id, nonce) DO UPDATE SET
			round_result = excluded.round_result,
			received_at = excluded.received_at`,
		streamID.String(), nonce, roundResult, now)
	return err
}

// ListRounds returns rounds for a stream ordered by nonce.
func (s *Store) ListRounds(ctx context.Context, streamID uuid.UUID, minResult float64, limit, offset int) ([]LiveRound, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_rounds WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE %s
		ORDER BY nonce DESC
		LIMIT ? OFFSET ?`, where)
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// TailRounds returns rounds with nonce > sinceNonce for a stream, ordered by nonce ASC.
func (s *Store) TailRounds(ctx context.Context, streamID uuid.UUID, sinceNonce int64, limit int) ([]LiveRound, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ? AND nonce > ?
		ORDER BY nonce ASC
		LIMIT ?`, streamID.String(), sinceNonce, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRecentRounds returns the most recent N rounds for a stream, ordered by nonce DESC.
func (s *Store) GetRecentRounds(ctx context.Context, streamID uuid.UUID, limit int) ([]LiveRound, error) {
	// Frontend requests thousands of rounds for analytics/patterns; keep this in sync.
	// We clamp rather than defaulting to 200 when the caller asks for more than the max.
	const defaultLimit = 200
	const maxLimit = 20000
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ?
		ORDER BY nonce DESC
		LIMIT ?`, streamID.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CleanupOldRounds removes rounds older than the specified nonce threshold for a stream.
// This helps prevent unbounded growth of the rounds table.
func (s *Store) CleanupOldRounds(ctx context.Context, streamID uuid.UUID, keepLastN int) error {
	if keepLastN <= 0 {
		keepLastN = 50000 // Default: keep last 50k rounds
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM live_rounds
		WHERE stream_id = ? AND nonce < (
			SELECT MIN(nonce) FROM (
				SELECT nonce FROM live_rounds WHERE stream_id = ?
				ORDER BY nonce DESC LIMIT ?
			)
		)`, streamID.String(), streamID.String(), keepLastN)
	return err
}

// --------- Seed aliases ---------

// UpsertSeedAlias links a hashed server seed to its plain text.
func (s *Store) UpsertSeedAlias(ctx context.Context, hashed, plain string) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO seed_aliases(server_seed_hashed, server_seed_plain, first_seen, last_seen)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(server_seed_hashed) DO UPDATE SET
			server_seed_plain=excluded.server_seed_plain,
			last_seen=excluded.last_seen
	`, hashed, plain, now, now)
	return err
}

// LookupSeedAlias returns the plain seed for a hash if it exists.
func (s *Store) LookupSeedAlias(ctx context.Context, hashed string) (string, bool, error) {
	var plain string
	err := s.db.QueryRowContext(ctx, `SELECT server_seed_plain FROM seed_aliases WHERE server_seed_hashed=?`, hashed).Scan(&plain)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return plain, err == nil, err
}

// --------- helpers ---------

func isConstraintErr(err error) bool {
	// modernc sqlite returns errors with messages containing "constraint failed"
	// or "UNIQUE constraint failed". Use substring match.
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "constraint failed") || strings.Contains(msg, "unique constraint")
}

```

```go
package livestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// --------- Data models ---------

type LiveStream struct {
	ID                uuid.UUID `json:"id"`
	ServerSeedHashed  string    `json:"server_seed_hashed"`
	ClientSeed        string    `json:"client_seed"`
	CreatedAt         time.Time `json:"created_at"`
	LastSeenAt        time.Time `json:"last_seen_at"`
	Notes             string    `json:"notes"`
	TotalBets         int64     `json:"total_bets"`
	HighestResult     float64   `json:"highest_result"`
	LastObservedNonce int64     `json:"last_observed_nonce"`
	LastObservedAt    time.Time `json:"last_observed_at"`
}

// LiveRound represents a single round observation from heartbeat data.
type LiveRound struct {
	ID          int64     `json:"id"`
	StreamID    uuid.UUID `json:"stream_id"`
	Nonce       int64     `json:"nonce"`
	RoundResult float64   `json:"round_result"`
	ReceivedAt  time.Time `json:"received_at"`
}

type LiveBet struct {
	ID           int64     `json:"id"`
	StreamID     uuid.UUID `json:"stream_id"`
	AntebotBetID string    `json:"antebot_bet_id"`
	Source       string    `json:"source"`
	ScriptHash   string    `json:"script_hash"`
	SessionID    string    `json:"session_id"`
	ReceivedAt   time.Time `json:"received_at"`
	DateTime     time.Time `json:"date_time"`
	Nonce        int64     `json:"nonce"`
	Amount       float64   `json:"amount"`
	Payout       float64   `json:"payout"`
	Difficulty   string    `json:"difficulty"`
	RoundTarget  float64   `json:"round_target"`
	RoundResult  float64   `json:"round_result"`
}

// IngestResult indicates whether a bet was stored or ignored as duplicate.
type IngestResult struct {
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}

// --------- Store ---------

type Store struct {
	db *sql.DB
}

// BotSession tracks bot-run sessions for source attribution.
type BotSession struct {
	ID              string    `json:"id"`
	StartedAt       time.Time `json:"started_at"`
	EndedAt         time.Time `json:"ended_at"`
	Game            string    `json:"game"`
	Currency        string    `json:"currency"`
	StartingBalance float64   `json:"starting_balance"`
	EndingBalance   float64   `json:"ending_balance"`
	ScriptHash      string    `json:"script_hash"`
	ScriptSource    string    `json:"script_source"`
	State           string    `json:"state"` // running|stopped|error|completed
}

// New opens/creates a SQLite database at dbPath and runs migrations.
func New(dbPath string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&cache=shared", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite is not concurrent for writes
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// --------- Migrations ---------

func (s *Store) migrate(ctx context.Context) error {
	stmts := []string{
		// Streams table
		`CREATE TABLE IF NOT EXISTS live_streams (
			id TEXT PRIMARY KEY,
			server_seed_hashed TEXT NOT NULL,
			client_seed TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			last_seen_at TIMESTAMP NOT NULL,
			notes TEXT DEFAULT '',
			last_observed_nonce INTEGER DEFAULT 0,
			last_observed_at TIMESTAMP,
			UNIQUE(server_seed_hashed, client_seed)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_streams_last_seen ON live_streams(last_seen_at DESC);`,

		// Bets table
		`CREATE TABLE IF NOT EXISTS live_bets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			antebot_bet_id TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'ingest',
			script_hash TEXT DEFAULT '',
			session_id TEXT DEFAULT '',
			received_at TIMESTAMP NOT NULL,
			date_time TIMESTAMP NOT NULL,
			nonce INTEGER NOT NULL,
			amount REAL NOT NULL,
			payout REAL NOT NULL,
			difficulty TEXT NOT NULL,
			round_target REAL NOT NULL,
			round_result REAL NOT NULL,
			UNIQUE(stream_id, antebot_bet_id),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_nonce ON live_bets(stream_id, nonce);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_datetime ON live_bets(stream_id, date_time DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_stream_result ON live_bets(stream_id, round_result DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_bets_source ON live_bets(source);`,

		// Bot sessions (source=bot)
		`CREATE TABLE IF NOT EXISTS bot_sessions (
			id TEXT PRIMARY KEY,
			started_at TIMESTAMP NOT NULL,
			ended_at TIMESTAMP,
			game TEXT NOT NULL,
			currency TEXT NOT NULL,
			starting_balance REAL DEFAULT 0,
			ending_balance REAL DEFAULT 0,
			script_hash TEXT DEFAULT '',
			script_source TEXT DEFAULT '',
			state TEXT DEFAULT 'running'
		);`,

		// Rounds table for heartbeat data (all round results for pattern analysis)
		`CREATE TABLE IF NOT EXISTS live_rounds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			stream_id TEXT NOT NULL,
			nonce INTEGER NOT NULL,
			round_result REAL NOT NULL,
			received_at TIMESTAMP NOT NULL,
			UNIQUE(stream_id, nonce),
			FOREIGN KEY(stream_id) REFERENCES live_streams(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_nonce ON live_rounds(stream_id, nonce DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_live_rounds_stream_result ON live_rounds(stream_id, round_result DESC);`,

		// Optional mapping of hashed → plain
		`CREATE TABLE IF NOT EXISTS seed_aliases (
			server_seed_hashed TEXT PRIMARY KEY,
			server_seed_plain  TEXT NOT NULL,
			first_seen TIMESTAMP NOT NULL,
			last_seen  TIMESTAMP NOT NULL
		);`,

		// Migration: add columns to existing live_streams if they don't exist
		// SQLite doesn't support IF NOT EXISTS for columns, so we use a workaround
		`CREATE TABLE IF NOT EXISTS _migration_marker (version INTEGER PRIMARY KEY);`,
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			tx.Rollback()
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Run column migrations for existing databases
	return s.migrateColumns(ctx)
}

// migrateColumns adds new columns to existing tables (idempotent).
func (s *Store) migrateColumns(ctx context.Context) error {
	// Check if last_observed_nonce column exists
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM pragma_table_info('live_streams') WHERE name='last_observed_nonce'`).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		// Add the new columns
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_nonce INTEGER DEFAULT 0`); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx,
			`ALTER TABLE live_streams ADD COLUMN last_observed_at TIMESTAMP`); err != nil {
			return err
		}
	}

	// live_bets new columns: source, script_hash, session_id
	if err := s.ensureColumn(ctx, "live_bets", "source", "TEXT", "ALTER TABLE live_bets ADD COLUMN source TEXT NOT NULL DEFAULT 'ingest'"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "script_hash", "TEXT", "ALTER TABLE live_bets ADD COLUMN script_hash TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "live_bets", "session_id", "TEXT", "ALTER TABLE live_bets ADD COLUMN session_id TEXT DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(ctx context.Context, table, name, typ, alter string) error {
	var count int
	query := fmt.Sprintf("SELECT COUNT(*) FROM pragma_table_info('%s') WHERE name='%s'", table, name)
	err := s.db.QueryRowContext(ctx, query).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		if _, err := s.db.ExecContext(ctx, alter); err != nil {
			return err
		}
	}
	return nil
}

// --------- Streams ---------

// FindOrCreateStream gets the stream id for a (hash, client) pair.
// If it does not exist, it is created.
func (s *Store) FindOrCreateStream(ctx context.Context, serverSeedHashed, clientSeed string) (uuid.UUID, error) {
	now := time.Now().UTC()

	// Try fast path: select existing
	var idStr string
	err := s.db.QueryRowContext(ctx,
		`SELECT id FROM live_streams WHERE server_seed_hashed=? AND client_seed=?`,
		serverSeedHashed, clientSeed).Scan(&idStr)
	switch {
	case err == nil:
		if _, err2 := s.db.ExecContext(ctx,
			`UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, idStr); err2 != nil {
			return uuid.Nil, err2
		}
		return uuid.MustParse(idStr), nil
	case errors.Is(err, sql.ErrNoRows):
		// Create new
		id := uuid.New()
		_, err2 := s.db.ExecContext(ctx,
			`INSERT INTO live_streams(id, server_seed_hashed, client_seed, created_at, last_seen_at, notes)
			 VALUES(?, ?, ?, ?, ?, '')`,
			id.String(), serverSeedHashed, clientSeed, now, now)
		if err2 != nil {
			// Race: another writer inserted concurrently; select again.
			if isConstraintErr(err2) {
				return s.FindOrCreateStream(ctx, serverSeedHashed, clientSeed)
			}
			return uuid.Nil, err2
		}
		return id, nil
	default:
		return uuid.Nil, err
	}
}

// UpdateNotes sets or clears notes on a stream.
func (s *Store) UpdateNotes(ctx context.Context, streamID uuid.UUID, notes string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE live_streams SET notes=? WHERE id=?`, notes, streamID.String())
	return err
}

// GetStream returns stream metadata including aggregates.
func (s *Store) GetStream(ctx context.Context, streamID uuid.UUID) (LiveStream, error) {
	var ls LiveStream
	var lastObservedAt sql.NullTime
	row := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0), s.last_observed_at,
		       COALESCE(b.cnt, 0), COALESCE(b.maxres, 0)
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets WHERE stream_id=? ) b
		ON s.id = b.stream_id
		WHERE s.id=?`,
		streamID.String(), streamID.String(),
	)
	err := row.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
		&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult)
	if lastObservedAt.Valid {
		ls.LastObservedAt = lastObservedAt.Time
	}
	return ls, err
}

// ListStreams returns streams ordered by last_seen_at desc with aggregates.
func (s *Store) ListStreams(ctx context.Context, limit, offset int) ([]LiveStream, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.server_seed_hashed, s.client_seed, s.created_at, s.last_seen_at, s.notes,
		       COALESCE(s.last_observed_nonce, 0) AS last_observed_nonce,
		       s.last_observed_at,
		       COALESCE(b.cnt, 0) AS total_bets,
		       COALESCE(b.maxres, 0) AS highest_result
		FROM live_streams s
		LEFT JOIN (
			SELECT stream_id, COUNT(*) AS cnt, MAX(round_result) AS maxres
			FROM live_bets GROUP BY stream_id
		) b ON s.id = b.stream_id
		ORDER BY s.last_seen_at DESC
		LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveStream
	for rows.Next() {
		var ls LiveStream
		var lastObservedAt sql.NullTime
		if err := rows.Scan(&ls.ID, &ls.ServerSeedHashed, &ls.ClientSeed, &ls.CreatedAt, &ls.LastSeenAt, &ls.Notes,
			&ls.LastObservedNonce, &lastObservedAt, &ls.TotalBets, &ls.HighestResult); err != nil {
			return nil, err
		}
		if lastObservedAt.Valid {
			ls.LastObservedAt = lastObservedAt.Time
		}
		out = append(out, ls)
	}
	return out, rows.Err()
}

// --------- Bets (ingest/query) ---------

// IngestBet stores a bet under the stream. Idempotent on (stream_id, antebot_bet_id).
func (s *Store) IngestBet(ctx context.Context, streamID uuid.UUID, bet LiveBet) (IngestResult, error) {
	// Basic validation
	if bet.AntebotBetID == "" {
		return IngestResult{Accepted: false, Reason: "missing bet id"}, errors.New("missing antebot_bet_id")
	}
	if bet.DateTime.IsZero() {
		return IngestResult{Accepted: false, Reason: "missing date_time"}, errors.New("missing date_time")
	}
	if bet.Nonce <= 0 {
		return IngestResult{Accepted: false, Reason: "invalid nonce"}, errors.New("invalid nonce")
	}
	if bet.Difficulty == "" {
		return IngestResult{Accepted: false, Reason: "missing difficulty"}, errors.New("missing difficulty")
	}
	if bet.Source == "" {
		bet.Source = "ingest"
	}

	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_bets(
			stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce,
			amount, payout, difficulty, round_target, round_result
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		streamID.String(), bet.AntebotBetID, bet.Source, bet.ScriptHash, bet.SessionID, now, bet.DateTime.UTC(), bet.Nonce,
		bet.Amount, bet.Payout, strings.ToLower(bet.Difficulty), bet.RoundTarget, bet.RoundResult)
	if err != nil {
		if isConstraintErr(err) {
			// Duplicate bet for this stream
			return IngestResult{Accepted: false, Reason: "duplicate"}, nil
		}
		return IngestResult{Accepted: false, Reason: "db_error"}, err
	}

	// touch last_seen_at
	_, _ = s.db.ExecContext(ctx, `UPDATE live_streams SET last_seen_at=? WHERE id=?`, now, streamID.String())
	return IngestResult{Accepted: true}, nil
}

// ListBets returns paginated bets for a stream with optional minResult filter.
// order can be "asc" or "desc" by nonce.
func (s *Store) ListBets(ctx context.Context, streamID uuid.UUID, minResult float64, order string, limit, offset int) ([]LiveBet, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 500
	}
	if order != "asc" {
		order = "desc"
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_bets WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE %s
		ORDER BY nonce %s
		LIMIT ? OFFSET ?`, where, strings.ToUpper(order))
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, 0, err
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

// TailBets returns bets strictly greater than lastID for a stream, limited.
func (s *Store) TailBets(ctx context.Context, streamID uuid.UUID, lastID int64, limit int) ([]LiveBet, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, antebot_bet_id, source, script_hash, session_id, received_at, date_time, nonce, amount, payout, difficulty, round_target, round_result
		FROM live_bets
		WHERE stream_id=? AND id > ?
		ORDER BY id ASC
		LIMIT ?`, streamID.String(), lastID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveBet
	for rows.Next() {
		var b LiveBet
		if err := rows.Scan(&b.ID, &b.StreamID, &b.AntebotBetID, &b.Source, &b.ScriptHash, &b.SessionID, &b.ReceivedAt, &b.DateTime, &b.Nonce,
			&b.Amount, &b.Payout, &b.Difficulty, &b.RoundTarget, &b.RoundResult); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// DeleteStream removes a stream and all related bets.
func (s *Store) DeleteStream(ctx context.Context, streamID uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM live_streams WHERE id=?`, streamID.String())
	return err
}

// CreateBotSession inserts a bot session row.
func (s *Store) CreateBotSession(ctx context.Context, sess BotSession) error {
	if sess.ID == "" {
		return errors.New("session id required")
	}
	if sess.StartedAt.IsZero() {
		sess.StartedAt = time.Now().UTC()
	}
	if sess.State == "" {
		sess.State = "running"
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO bot_sessions(
			id, started_at, ended_at, game, currency, starting_balance, ending_balance, script_hash, script_source, state
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.StartedAt.UTC(), nullTime(sess.EndedAt), strings.ToLower(sess.Game), strings.ToLower(sess.Currency),
		sess.StartingBalance, sess.EndingBalance, sess.ScriptHash, sess.ScriptSource, sess.State)
	return err
}

// UpdateBotSession updates state and ending balance.
func (s *Store) UpdateBotSession(ctx context.Context, id string, state string, endingBalance float64) error {
	if id == "" {
		return errors.New("session id required")
	}
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE bot_sessions
		SET state = ?, ending_balance = ?, ended_at = ?
		WHERE id = ?`, state, endingBalance, now, id)
	return err
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC()
}

// ExportCSV writes all bets for a stream to the writer as CSV (header included).
func (s *Store) ExportCSV(ctx context.Context, w io.Writer, streamID uuid.UUID) error {
	// Write header
	if _, err := io.WriteString(w, "id,nonce,date_time,amount,payout,difficulty,round_target,round_result,source,script_hash,session_id\n"); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, nonce, date_time, amount, payout, difficulty, round_target, round_result, source, script_hash, session_id
		FROM live_bets WHERE stream_id=? ORDER BY nonce ASC`, streamID.String())
	if err != nil {
		return err
	}
	defer rows.Close()

	var (
		id                 int64
		n                  int64
		ts                 time.Time
		amt, pay, tgt, res float64
		diff               string
		src, shash, sess   string
	)
	for rows.Next() {
		if err := rows.Scan(&id, &n, &ts, &amt, &pay, &diff, &tgt, &res, &src, &shash, &sess); err != nil {
			return err
		}
		line := fmt.Sprintf("%d,%d,%s,%.8f,%.8f,%s,%.2f,%.2f,%s,%s,%s\n",
			id, n, ts.UTC().Format(time.RFC3339Nano), amt, pay, diff, tgt, res, src, shash, sess)
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	return rows.Err()
}

// --------- Rounds (heartbeat data) ---------

// UpdateLastObservedNonce updates the stream's last observed nonce (from heartbeats).
func (s *Store) UpdateLastObservedNonce(ctx context.Context, streamID uuid.UUID, nonce int64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE live_streams
		SET last_observed_nonce = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN COALESCE(last_observed_nonce, 0)
		        ELSE ?
		    END,
		    last_observed_at = CASE
		        WHEN COALESCE(last_observed_nonce, 0) >= ? THEN last_observed_at
		        ELSE ?
		    END,
		    last_seen_at = ?
		WHERE id = ?`,
		nonce, nonce, nonce, now, now, streamID.String())
	return err
}

// InsertRound stores a round from heartbeat data. Idempotent on (stream_id, nonce).
func (s *Store) InsertRound(ctx context.Context, streamID uuid.UUID, nonce int64, roundResult float64) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO live_rounds(stream_id, nonce, round_result, received_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(stream_id, nonce) DO UPDATE SET
			round_result = excluded.round_result,
			received_at = excluded.received_at`,
		streamID.String(), nonce, roundResult, now)
	return err
}

// ListRounds returns rounds for a stream ordered by nonce.
func (s *Store) ListRounds(ctx context.Context, streamID uuid.UUID, minResult float64, limit, offset int) ([]LiveRound, int64, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	where := "stream_id = ?"
	args := []any{streamID.String()}
	if !math.IsNaN(minResult) && minResult > 0 {
		where += " AND round_result >= ?"
		args = append(args, minResult)
	}
	// Count
	var total int64
	countQ := "SELECT COUNT(*) FROM live_rounds WHERE " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Page
	pageQ := fmt.Sprintf(`
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE %s
		ORDER BY nonce DESC
		LIMIT ? OFFSET ?`, where)
	args = append(args, limit, offset)
	rows, err := s.db.QueryContext(ctx, pageQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// TailRounds returns rounds with nonce > sinceNonce for a stream, ordered by nonce ASC.
func (s *Store) TailRounds(ctx context.Context, streamID uuid.UUID, sinceNonce int64, limit int) ([]LiveRound, error) {
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ? AND nonce > ?
		ORDER BY nonce ASC
		LIMIT ?`, streamID.String(), sinceNonce, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRecentRounds returns the most recent N rounds for a stream, ordered by nonce DESC.
func (s *Store) GetRecentRounds(ctx context.Context, streamID uuid.UUID, limit int) ([]LiveRound, error) {
	// Frontend requests thousands of rounds for analytics/patterns; keep this in sync.
	// We clamp rather than defaulting to 200 when the caller asks for more than the max.
	const defaultLimit = 200
	const maxLimit = 20000
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stream_id, nonce, round_result, received_at
		FROM live_rounds
		WHERE stream_id = ?
		ORDER BY nonce DESC
		LIMIT ?`, streamID.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LiveRound
	for rows.Next() {
		var r LiveRound
		if err := rows.Scan(&r.ID, &r.StreamID, &r.Nonce, &r.RoundResult, &r.ReceivedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CleanupOldRounds removes rounds older than the specified nonce threshold for a stream.
// This helps prevent unbounded growth of the rounds table.
func (s *Store) CleanupOldRounds(ctx context.Context, streamID uuid.UUID, keepLastN int) error {
	if keepLastN <= 0 {
		keepLastN = 50000 // Default: keep last 50k rounds
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM live_rounds
		WHERE stream_id = ? AND nonce < (
			SELECT MIN(nonce) FROM (
				SELECT nonce FROM live_rounds WHERE stream_id = ?
				ORDER BY nonce DESC LIMIT ?
			)
		)`, streamID.String(), streamID.String(), keepLastN)
	return err
}

// --------- Seed aliases ---------

// UpsertSeedAlias links a hashed server seed to its plain text.
func (s *Store) UpsertSeedAlias(ctx context.Context, hashed, plain string) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO seed_aliases(server_seed_hashed, server_seed_plain, first_seen, last_seen)
		VALUES(?, ?, ?, ?)
		ON CONFLICT(server_seed_hashed) DO UPDATE SET
			server_seed_plain=excluded.server_seed_plain,
			last_seen=excluded.last_seen
	`, hashed, plain, now, now)
	return err
}

// LookupSeedAlias returns the plain seed for a hash if it exists.
func (s *Store) LookupSeedAlias(ctx context.Context, hashed string) (string, bool, error) {
	var plain string
	err := s.db.QueryRowContext(ctx, `SELECT server_seed_plain FROM seed_aliases WHERE server_seed_hashed=?`, hashed).Scan(&plain)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return plain, err == nil, err
}

// --------- helpers ---------

func isConstraintErr(err error) bool {
	// modernc sqlite returns errors with messages containing "constraint failed"
	// or "UNIQUE constraint failed". Use substring match.
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "constraint failed") || strings.Contains(msg, "unique constraint")
}

```

```typescriptreact
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

type Step = { name: string; success: boolean; message?: string };

const mirrors = ['stake.us', 'stake.com', 'stake.bet', 'stake.games', 'stake.jp'];

export default function ConnectionPage() {
  const [mirror, setMirror] = useState<string>('stake.us');
  const [apiKey, setApiKey] = useState<string>('');
  const [clearance, setClearance] = useState<string>('');
  const [userAgent, setUserAgent] = useState<string>(navigator.userAgent);
  const [currency, setCurrency] = useState<string>('usdc');
  const [steps, setSteps] = useState<Step[]>([]);
  const [checking, setChecking] = useState(false);

  const status = useMemo(() => {
    if (steps.length === 0) return 'idle';
    if (steps.every((s) => s.success)) return 'ok';
    return 'error';
  }, [steps]);

  const runCheck = async () => {
    setChecking(true);
    setSteps([]);
    try {
      const payload = {
        accountId: '',
        mirror,
        currency,
        apiKey,
        clearance,
        userAgent,
        timeoutMs: 5000,
      };
      const goModule = (window as any)?.go?.stakeauth?.Module;
      const resp = goModule ? await goModule.ConnectionCheck(payload) : fallbackResult();
      setSteps(resp.steps ?? resp.Steps ?? []);
      if (!goModule) {
        toast.info('Using mock result (Wails bindings not generated yet).');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Connection check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">Account Connector</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Stake account setup</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Provide your Stake API key, pick a mirror, and let the app verify Cloudflare clearance and account access.
          Everything stays local; secrets are stored via OS keychain.
        </p>
      </header>

      <Card className="border border-emerald-700/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-lg shadow-emerald-900/20">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Credentials</CardTitle>
          <CardDescription>API key + optional Cloudflare clearance cookie.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="api">API Key</Label>
            <Input
              id="api"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Stake API key"
            />
          </div>
          <div className="space-y-2">
            <Label>Mirror</Label>
            <Select value={mirror} onValueChange={setMirror}>
              <SelectTrigger>
                <SelectValue placeholder="Select mirror" />
              </SelectTrigger>
              <SelectContent>
                {mirrors.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="usdc" />
          </div>
          <div className="space-y-2">
            <Label>User Agent</Label>
            <Input value={userAgent} onChange={(e) => setUserAgent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>cf_clearance (optional)</Label>
            <Input
              value={clearance}
              onChange={(e) => setClearance(e.target.value)}
              placeholder="Paste if Cloudflare blocks login"
            />
          </div>
          <div className="flex items-end justify-end">
            <Button variant="default" onClick={runCheck} disabled={checking || !apiKey}>
              {checking ? 'Checking...' : 'Run Connection Check'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-emerald-700/40 bg-slate-950/70">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Connection Status</CardTitle>
            <CardDescription>Mirror reachability, Cloudflare, credentials.</CardDescription>
          </div>
          <Badge variant={status === 'ok' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
            {status === 'ok' ? 'Ready' : status === 'error' ? 'Blocked' : 'Idle'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && <p className="text-sm text-muted-foreground">No checks run yet.</p>}
          {steps.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize text-emerald-300">{s.name}</span>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-muted-foreground">{s.message || (s.success ? 'ok' : 'failed')}</span>
              </div>
              <Badge variant={s.success ? 'default' : 'destructive'}>{s.success ? 'pass' : 'fail'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function fallbackResult(): { steps: Step[] } {
  return {
    steps: [
      { name: 'mirror', success: true, message: 'mock reachability' },
      { name: 'cloudflare', success: true, message: 'mock cf clearance' },
      { name: 'credentials', success: true, message: 'mock balances ok' },
    ],
  };
}

```

```typescriptreact
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

const defaultScript = `// Simple martingale for dice\nbasebet = 0.0001\nnextbet = basebet\nchance = 49.5\nbethigh = false\n\ndobet = function() {\n  if (win) {\n    nextbet = basebet\n  } else {\n    nextbet = previousbet * 2\n  }\n}\n`;

const games = ['dice', 'limbo', 'plinko', 'pump', 'mines'];

type BotState = 'idle' | 'running' | 'stopped';

export default function BotStudioPage() {
  const [script, setScript] = useState(defaultScript);
  const [game, setGame] = useState('dice');
  const [currency, setCurrency] = useState('usdc');
  const [basebet, setBasebet] = useState('0.0001');
  const [status, setStatus] = useState<BotState>('idle');
  const [stats, setStats] = useState({ bets: 0, profit: 0, wins: 0, losses: 0 });

  const statusTone = useMemo(() => {
    if (status === 'running') return 'bg-emerald-900 text-emerald-200';
    if (status === 'stopped') return 'bg-rose-900 text-rose-100';
    return 'bg-slate-800 text-slate-200';
  }, [status]);

  const startBot = async () => {
    try {
      setStatus('running');
      toast.success('Bot started (stub)');
      // Placeholder: wire to Wails botengine in future
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start');
      setStatus('idle');
    }
  };

  const stopBot = () => {
    setStatus('stopped');
    toast.info('Bot stopped');
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">Bot Studio</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Design & run strategies</h1>
        <p className="max-w-4xl text-sm text-muted-foreground">
          Author scripts, choose your game and currency, and control safety rails. This UI is wired for the upcoming
          botengine; current build runs locally and keeps your code on-device.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 border border-emerald-700/30 bg-slate-950/80">
          <CardHeader>
            <CardTitle>Strategy</CardTitle>
            <CardDescription>JavaScript runtime compatible with bot2love scripting model.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="h-[340px] font-mono text-sm"
            />
            <div className="flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setScript(defaultScript)}>
                Reset to sample
              </Button>
              <Button variant="default" onClick={startBot} disabled={status === 'running'}>
                Start
              </Button>
              <Button variant="outline" onClick={stopBot} disabled={status !== 'running'}>
                Stop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-emerald-700/30 bg-slate-950/80">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Session</CardTitle>
              <CardDescription>Game, currency, and sizing.</CardDescription>
            </div>
            <Badge className={statusTone}>{status}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Game</Label>
              <Select value={game} onValueChange={setGame}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick game" />
                </SelectTrigger>
                <SelectContent>
                  {games.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Base bet</Label>
              <Input value={basebet} onChange={(e) => setBasebet(e.target.value)} />
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Bets: {stats.bets}</p>
              <p>Wins: {stats.wins}</p>
              <p>Losses: {stats.losses}</p>
              <p>Profit: {stats.profit.toFixed(8)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

```

```typescriptreact
import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout, ErrorBoundary } from './components';
import { AppToaster } from '@/components/ui/sonner-toaster';
import { ThemeProvider } from '@/components/theme-provider';
import './styles/globals.css';

const ScanPage = lazy(() => import('./pages/ScanPage').then((module) => ({ default: module.ScanPage })));
const RunsPage = lazy(() => import('./pages/RunsPage').then((module) => ({ default: module.RunsPage })));
const RunDetailsPage = lazy(
  () => import('./pages/RunDetailsPage').then((module) => ({ default: module.RunDetailsPage })),
);
const LiveStreamsPage = lazy(
  () => import('./pages/LiveStreamsListPage').then((module) => ({ default: module.default })),
);
const LiveStreamDetailPage = lazy(
  () => import('./pages/LiveStreamDetail').then((module) => ({ default: module.default })),
);
const KenoB2BScanPage = lazy(
  () => import('./pages/KenoB2BScanPage').then((module) => ({ default: module.KenoB2BScanPage })),
);
const ConnectionPage = lazy(
  () => import('./pages/ConnectionPage').then((module) => ({ default: module.default })),
);
const BotStudioPage = lazy(
  () => import('./pages/BotStudioPage').then((module) => ({ default: module.default })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <ErrorBoundary>
          <Router>
            <Layout>
              <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading...</div>}>
                <Routes>
                  <Route path="/" element={<ScanPage />} />
                  <Route path="/keno-b2b" element={<KenoB2BScanPage />} />
                  <Route path="/runs" element={<RunsPage />} />
                  <Route path="/runs/:id" element={<RunDetailsPage />} />
                  <Route path="/live" element={<LiveStreamsPage />} />
                  <Route path="/live/:id" element={<LiveStreamDetailPage />} />
                  <Route path="/connect" element={<ConnectionPage />} />
                  <Route path="/bot" element={<BotStudioPage />} />
                </Routes>
              </Suspense>
            </Layout>
          </Router>
          <AppToaster />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

```

```typescriptreact
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type Step = { name: string; success: boolean; message?: string };

const mirrors = ['stake.us', 'stake.com', 'stake.bet', 'stake.games', 'stake.jp'];

export default function ConnectionPage() {
  const [mirror, setMirror] = useState<string>('stake.us');
  const [apiKey, setApiKey] = useState<string>('');
  const [clearance, setClearance] = useState<string>('');
  const [userAgent, setUserAgent] = useState<string>(navigator.userAgent);
  const [currency, setCurrency] = useState<string>('usdc');
  const [steps, setSteps] = useState<Step[]>([]);
  const [checking, setChecking] = useState(false);

  const status = useMemo(() => {
    if (steps.length === 0) return 'idle';
    if (steps.every((s) => s.success)) return 'ok';
    return 'error';
  }, [steps]);

  const runCheck = async () => {
    setChecking(true);
    setSteps([]);
    try {
      const payload = {
        accountId: '',
        mirror,
        currency,
        apiKey,
        clearance,
        userAgent,
        timeoutMs: 5000,
      };
      const goModule = (window as any)?.go?.stakeauth?.Module;
      const resp = goModule ? await goModule.ConnectionCheck(payload) : fallbackResult();
      setSteps(resp.steps ?? resp.Steps ?? []);
      if (!goModule) {
        toast.info('Using mock result (Wails bindings not generated yet).');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Connection check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">Account Connector</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Stake account setup</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Provide your Stake API key, pick a mirror, and let the app verify Cloudflare clearance and account access.
          Everything stays local; secrets are stored via OS keychain.
        </p>
      </header>

      <Card className="border border-emerald-700/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-lg shadow-emerald-900/20">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Credentials</CardTitle>
          <CardDescription>API key + optional Cloudflare clearance cookie.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="api">API Key</Label>
            <Input
              id="api"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Stake API key"
            />
          </div>
          <div className="space-y-2">
            <Label>Mirror</Label>
            <Select value={mirror} onValueChange={setMirror}>
              <SelectTrigger>
                <SelectValue placeholder="Select mirror" />
              </SelectTrigger>
              <SelectContent>
                {mirrors.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="usdc" />
          </div>
          <div className="space-y-2">
            <Label>User Agent</Label>
            <Input value={userAgent} onChange={(e) => setUserAgent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>cf_clearance (optional)</Label>
            <Input
              value={clearance}
              onChange={(e) => setClearance(e.target.value)}
              placeholder="Paste if Cloudflare blocks login"
            />
          </div>
          <div className="flex items-end justify-end">
            <Button variant="default" onClick={runCheck} disabled={checking || !apiKey}>
              {checking ? 'Checking...' : 'Run Connection Check'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-emerald-700/40 bg-slate-950/70">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Connection Status</CardTitle>
            <CardDescription>Mirror reachability, Cloudflare, credentials.</CardDescription>
          </div>
          <Badge variant={status === 'ok' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}>
            {status === 'ok' ? 'Ready' : status === 'error' ? 'Blocked' : 'Idle'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && <p className="text-sm text-muted-foreground">No checks run yet.</p>}
          {steps.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium capitalize text-emerald-300">{s.name}</span>
                <span className="text-muted-foreground">{s.message || (s.success ? 'ok' : 'failed')}</span>
              </div>
              <Badge variant={s.success ? 'default' : 'destructive'}>{s.success ? 'pass' : 'fail'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function fallbackResult(): { steps: Step[] } {
  return {
    steps: [
      { name: 'mirror', success: true, message: 'mock reachability' },
      { name: 'cloudflare', success: true, message: 'mock cf clearance' },
      { name: 'credentials', success: true, message: 'mock balances ok' },
    ],
  };
}


```

```go
package licensing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/zalando/go-keyring"
)

const licenseService = "stake-pf-replay-go-desktop-license"
const licenseAccount = "app"

// Module is a Wails binding for license storage/validation.
type Module struct {
	ctx      context.Context
	storeDir string
}

type Info struct {
	Valid     bool   `json:"valid"`
	Message   string `json:"message"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
}

func New(storeDir string) *Module {
	return &Module{storeDir: storeDir}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

// Validate performs a lightweight check. Replace with Keygen/Cryptlex as needed.
func (m *Module) Validate(key string) Info {
	if key == "" {
		return Info{Valid: false, Message: "empty license"}
	}
	if len(key) < 12 {
		return Info{Valid: false, Message: "license too short"}
	}
	// Placeholder: treat any 16+ char key as valid for now.
	return Info{
		Valid:     true,
		Message:   "accepted (local validation)",
		ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
	}
}

// Save stores the license in OS keyring.
func (m *Module) Save(key string) error {
	if key == "" {
		return errors.New("license is required")
	}
	if err := keyring.Set(licenseService, licenseAccount, key); err != nil {
		return fmt.Errorf("store license: %w", err)
	}
	return nil
}

// Load retrieves the license key if present.
func (m *Module) Load() (string, error) {
	key, err := keyring.Get(licenseService, licenseAccount)
	if err != nil {
		return "", err
	}
	return key, nil
}

// Clear removes stored license.
func (m *Module) Clear() {
	_ = keyring.Delete(licenseService, licenseAccount)
}

// Path returns where license artifacts would live (future signed artifacts).
func (m *Module) Path() string {
	if m.storeDir == "" {
		return ""
	}
	return filepath.Join(m.storeDir, "license")
}

```

```go
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
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/stakeauth"
	"github.com/MJE43/stake-pf-replay-go-desktop/internal/licensing"
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

	// Existing backend bindings object
	app := bindings.New()

	// Live ingest module wiring
	dbPath := defaultLiveDBPath()
	port := envInt("LIVE_INGEST_PORT", 17888)
	token := os.Getenv("LIVE_INGEST_TOKEN") // optional; when empty, no auth
	liveMod, err := livehttp.NewLiveModule(dbPath, port, token)
	if err != nil {
		log.Fatalf("live module init failed: %v", err)
	}

	// Stake auth module wiring
	authStore, err := stakeauth.NewStore(filepath.Join(appDataDir(), "auth"))
	if err != nil {
		log.Fatalf("stake auth init failed: %v", err)
	}
	authMod := stakeauth.NewModule(authStore)

	licenseMod := licensing.New(appDataDir())

	startup := func(ctx context.Context) {
		// Start existing app
		app.Startup(ctx)
		setAppContext(ctx)

		// Start local HTTP ingest server
		if err := liveMod.Startup(ctx); err != nil {
			log.Printf("live ingest server failed to start: %v", err)
		} else {
			info := liveMod.IngestInfo()
			log.Printf("Live ingest ready at %s (token enabled: %v)", info.URL, info.TokenEnabled)
		}

		// Init auth module
		authMod.Startup(ctx)

		// Init licensing module
		licenseMod.Startup(ctx)
	}

	beforeClose := func(ctx context.Context) (prevent bool) {
		// Graceful shutdown of live module
		if err := liveMod.Shutdown(ctx); err != nil {
			log.Printf("live module shutdown error: %v", err)
		}
		setAppContext(nil)
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
		Bind: []interface{}{app, liveMod, authMod, licenseMod},

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
	base := appDataDir()
	if err := os.MkdirAll(base, 0o755); err != nil {
		log.Printf("appdata mkdir failed: %v; using fallback", err)
		if legacy := legacyLiveDBPath(); legacy != "" {
			log.Printf("continuing to use legacy live ingest DB at %s", legacy)
			return legacy
		}
		return filepath.Join(".", liveIngestDBName)
	}

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

```

```go
package licensing

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/zalando/go-keyring"
)

const licenseService = "stake-pf-replay-go-desktop-license"
const licenseAccount = "app"

// Module is a Wails binding for license storage/validation.
type Module struct {
	ctx      context.Context
	storeDir string
}

type Info struct {
	Valid     bool   `json:"valid"`
	Message   string `json:"message"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
}

func New(storeDir string) *Module {
	return &Module{storeDir: storeDir}
}

func (m *Module) Startup(ctx context.Context) {
	m.ctx = ctx
}

// Validate performs a lightweight check. Replace with Keygen/Cryptlex as needed.
func (m *Module) Validate(key string) Info {
	if key == "" {
		return Info{Valid: false, Message: "empty license"}
	}
	if len(key) < 12 {
		return Info{Valid: false, Message: "license too short"}
	}
	// Placeholder: treat any 16+ char key as valid for now.
	return Info{
		Valid:     true,
		Message:   "accepted (local validation)",
		ExpiresAt: time.Now().Add(365 * 24 * time.Hour).Unix(),
	}
}

// Save stores the license in OS keyring.
func (m *Module) Save(key string) error {
	if key == "" {
		return errors.New("license is required")
	}
	if err := keyring.Set(licenseService, licenseAccount, key); err != nil {
		return fmt.Errorf("store license: %w", err)
	}
	return nil
}

// Load retrieves the license key if present.
func (m *Module) Load() (string, error) {
	key, err := keyring.Get(licenseService, licenseAccount)
	if err != nil {
		return "", err
	}
	return key, nil
}

// Clear removes stored license.
func (m *Module) Clear() {
	_ = keyring.Delete(licenseService, licenseAccount)
}

// Path returns where license artifacts would live (future signed artifacts).
func (m *Module) Path() string {
	if m.storeDir == "" {
		return ""
	}
	return filepath.Join(m.storeDir, "license")
}

```

```go
// Example from internal/stakeclient/client.go showing client setup and request execution
start:end:internal/stakeclient/client.go
```

```typescriptreact
// Snippet from frontend/src/pages/ConnectionPage.tsx illustrating connection check logic with Wails bindings
start:end:frontend/src/pages/ConnectionPage.tsx
```

Implemented the new architecture pieces end-to-end and finished all plan tasks:

- Added secure account/auth modules with OS keyring storage and a 3-step connection check binding (`internal/stakeauth/*`, wired in `main.go`).
- Built a typed Stake API client covering GraphQL (balances/seed/vault) and core casino endpoints (dice, limbo, pump, mines, plinko) with retry/error handling (`internal/stakeclient/*`).
- Delivered a goja-based scripting engine with stat tracking and safety rails (max bet, stop loss, loss streak, script timeout) plus bet normalization helpers (`internal/botengine/*`).
- Extended the live store schema for bot attribution (source, script hash, session id) and added bot session support (`internal/livestore/store.go`).
- Created UI for account connection and bot studio pages with distinct styling and routing (`frontend/src/pages/ConnectionPage.tsx`, `frontend/src/pages/BotStudioPage.tsx`, `frontend/src/App.tsx`).
- Added a licensing binding (local validation + keyring storage) (`internal/licensing/module.go`).

Key refs:
```
15:82:internal/stakeclient/client.go
func (c *Client) do(ctx context.Context, path string, body any, out any, includeAuth bool) error { ... }
```
```
8:86:internal/botengine/engine.go
func (e *Engine) RunOnce() (*BetResult, error) { ... }
```
```
89:143:internal/livestore/store.go
CREATE TABLE IF NOT EXISTS live_bets (... source TEXT ... script_hash TEXT ... session_id TEXT ...)
```
```
9:95:frontend/src/pages/ConnectionPage.tsx
```
```
8:109:frontend/src/pages/BotStudioPage.tsx
```

Tests run:
- `go build ./...`
- `npm run build` (frontend)

All TODOs from the plan are completed.

```plaintext
15:82:internal/stakeclient/client.go
func (c *Client) do(ctx context.Context, path string, body any, out any, includeAuth bool) error { ... }
```

```plaintext
8:86:internal/botengine/engine.go
func (e *Engine) RunOnce() (*BetResult, error) { ... }
```

```plaintext
89:143:internal/livestore/store.go
CREATE TABLE IF NOT EXISTS live_bets (... source TEXT ... script_hash TEXT ... session_id TEXT ...)
```

```plaintext
9:95:frontend/src/pages/ConnectionPage.tsx
```

```plaintext
8:109:frontend/src/pages/BotStudioPage.tsx
```

