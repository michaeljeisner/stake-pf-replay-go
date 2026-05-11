# Stake API: Authentication and Utilities

This document extracts authentication, session management, and utility patterns from the bot2love extension and translates them into a desktop-safe design. The extension succeeds because it runs inside Stake's browser session; the desktop app must reproduce that property with a persistent embedded browser profile instead of assuming a detached Go HTTP client will survive Cloudflare.

---

## 1. Authentication

### Product Architecture Requirement

The product authentication model has two independent gates:

1. **Stake account identity:** a user-authorized Stake API key or session credential proves the account.
2. **Cloudflare/browser trust:** a real browser profile proves the client has completed Stake/Cloudflare browser flows from the user's environment.

The supported desktop flow is:

1. User creates a Stake account record with mirror/domain and API key.
2. The app stores the API key in OS secret storage.
3. The app creates a persistent embedded browser profile for that account.
4. User logs in normally through the embedded browser.
5. The app runs a connection check before enabling balance reads or betting calls.
6. Stake API calls use the connected browser profile as the primary request authority.

The app must not rely on automated Cloudflare bypasses or headless login. If Cloudflare/session trust fails, open the embedded browser and let the user complete the normal site flow.

### Connection Check

Every account selection and app startup should run these checks:

| Check | Purpose | Pass Condition | Failure Handling |
|-------|---------|----------------|------------------|
| Mirror reachability | Confirms the selected Stake mirror is reachable | Basic browser request reaches the mirror without network/DNS failure | Show mirror/domain error and allow edit |
| Browser session health | Confirms the persistent profile has usable browser trust/session state | Lightweight request from the embedded browser context returns expected JSON or a normal authenticated redirect, not a challenge/block page | Mark `needs_browser_repair` and open the embedded browser |
| Account credentials | Confirms the API key/session can read account data | Harmless account call such as balances/user info returns the expected shape | Mark `credential_failed` and prompt for updated credentials |

Betting calls must be disabled unless the account state is `connected`.

### Request Authority

The default transport should execute Stake requests from the embedded browser context that owns the session. The Go side should receive a narrow capability API, for example:

```typescript
interface StakeBrowserBridge {
  graphql<T>(operationName: string, variables: unknown, query: string): Promise<T>;
  casino<T>(path: string, body: unknown): Promise<T>;
}
```

The bridge should:

- Use the selected account's mirror/domain.
- Attach the same headers/cookies the browser context naturally has.
- Return structured JSON to Go/Wails.
- Redact secrets before logging.
- Surface Cloudflare/session failures as `needs_browser_repair`, not generic retryable betting errors.

A direct Go `http.Client` transport populated from browser cookies is a fallback only. It is valid for internal experiments or platforms where it demonstrably works, but the roadmap should not depend on it as the primary Cloudflare-compatible path.

### Session Token Extraction

The extension uses browser cookies to obtain the session token:

```javascript
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

var tokenapi = getCookie("session");
```

**Go Implementation Notes:**
- Cookie name: `session`
- Extract from `document.cookie` in browser context
- For desktop product code: prefer browser-context requests over exposing the raw session token to Go.
- For fallback Go-client experiments: obtain session state from the selected persistent browser profile, not from user DevTools instructions.
- Token is opaque string, no known expiry format

### x-access-token Header

ALL API requests require the `x-access-token` header:

```javascript
headers: {
    'Content-Type': 'application/json',
    'x-access-token': tokenapi
}
```

**Required Headers for All Requests:**
```
Content-Type: application/json
x-access-token: <session-cookie-value>
```

### Token Refresh/Expiry

**No explicit token refresh mechanism observed.**

The extension does not implement:
- Token refresh endpoints
- Expiry detection
- Automatic re-authentication

**Implications for desktop product code:**
- There is no reliable standalone token refresh endpoint.
- On session failures, move the account to `needs_browser_repair` and open the embedded browser for user-driven repair.
- Avoid "retry forever" behavior on 401/403 because those statuses may mean expired credentials, missing Cloudflare trust, account restrictions, or rate limiting.

### Supported Stake Domain Mirrors

The extension uses dynamic domain detection:

```javascript
var mirror = window.location.host
```

All API calls construct URLs as:
```javascript
`https://${mirror}/_api/...`
```

**Known Stake domains** (from community knowledge, not explicitly in code):
- `stake.com` (main)
- `stake.us` (US version)
- `stake.bet`
- Various mirror domains

**Desktop Implementation:**
- Accept domain as configuration parameter
- Default to `stake.com`
- Allow override for mirrors/regional variants
- Store the chosen mirror per account record

---

## 2. Session/Account Operations

### 2.1 Balance Queries

**GraphQL Query:** `UserBalances`

```javascript
function userBalances(newbal) {
    var body = {
        operationName: "UserBalances",
        variables: {},
        query: "query UserBalances {\n  user {\n    id\n    balances {\n      available {\n        amount\n        currency\n        __typename\n      }\n      vault {\n        amount\n        currency\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
    }

    fetch('https://' + mirror + '/_api/graphql', {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'x-access-token': tokenapi }
    })
    .then(res => res.json())
    .then(json => outbals(json, newbal))
}
```

**Response Processing:**
```javascript
function outbals(json, newbal) {
    balance = 0
    current_balance = 0

    for (var i = 0; i < json.data.user.balances.length; i++) {
        if (json.data.user.balances[i].available.currency == currency) {
            current_balance = json.data.user.balances[i].available.amount;
            balance = current_balance;
        }
    }
}
```

**Response Format:**
```json
{
  "data": {
    "user": {
      "id": "...",
      "balances": [
        {
          "available": {
            "amount": 123.456,
            "currency": "btc",
            "__typename": "Amount"
          },
          "vault": {
            "amount": 789.012,
            "currency": "btc",
            "__typename": "Amount"
          },
          "__typename": "Balance"
        }
      ],
      "__typename": "User"
    }
  }
}
```

**Desktop Implementation:**
- Endpoint: `POST https://{domain}/_api/graphql`
- Execute through the connected request authority.
- Filter balances array by desired currency.
- Return both `available` and `vault` amounts.
- Use this as the account credential pass/fail check.

### 2.2 Vault Deposit

**GraphQL Mutation:** `CreateVaultDeposit`

```javascript
function vault(e) {
    var body = {
        operationName: "CreateVaultDeposit",
        variables: {
            "currency": currency,  // e.g., "btc", "eth", "ltc", "usdc", "trx"
            "amount": e
        },
        query: "mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {\n  createVaultDeposit(currency: $currency, amount: $amount) {\n    id\n    amount\n    currency\n    user {\n      id\n      balances {\n        available {\n          amount\n          currency\n          __typename\n        }\n        vault {\n          amount\n          currency\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
    }

    fetch('https://' + mirror + '/_api/graphql', {
        method: 'post',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'x-access-token': tokenapi }
    })
}
```

**Response Processing:**
```javascript
function outvault(json) {
    if(json.errors != undefined) {
        log(json.errors[0].errorType);
    } else {
        log("Deposited " + json.data.createVaultDeposit.amount.toFixed(10) + " to vault.")
    }
}
```

**Note:** No vault withdrawal function observed in the code. May require separate GraphQL mutation `CreateVaultWithdrawal` (untested).

### 2.3 Seed Rotation

**GraphQL Mutation:** `RotateSeedPair`

```javascript
function resetseed(client = randomString(10)) {
    const body = {
        operationName: "RotateSeedPair",
        variables: { seed: client },  // New client seed
        query: `mutation RotateSeedPair($seed: String!) {
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
        }`
    };

    makeRequest(body, outseed);
}
```

**Response Processing:**
```javascript
function outseed(json) {
    if (json?.errors) {
        log(json.errors[0].errorType);
        log(json.errors[0].message);
    } else {
        log("Seed has been reset.");
    }
}
```

**Default client seed:** Random 10-character string from `randomString(10)`

**Response Format:**
```json
{
  "data": {
    "rotateSeedPair": {
      "clientSeed": {
        "user": {
          "id": "...",
          "activeClientSeed": {
            "id": "...",
            "seed": "new_client_seed",
            "__typename": "ClientSeed"
          },
          "activeServerSeed": {
            "id": "...",
            "nonce": 0,
            "seedHash": "sha256_of_server_seed",
            "nextSeedHash": "sha256_of_next_server_seed",
            "__typename": "ServerSeed"
          },
          "__typename": "User"
        },
        "__typename": "ClientSeed"
      },
      "__typename": "RotateSeedPairPayload"
    }
  }
}
```

### 2.4 Active Bet Queries

For games with multi-step gameplay (HiLo, Mines, Blackjack), check for active bets:

**HiLo Active Bet:**
```javascript
fetch('https://' + mirror + '/_api/casino/active-bet/hilo', {
    method: 'post',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json', 'x-access-token': tokenapi }
})
```

**Mines Active Bet:**
```
POST /_api/casino/active-bet/mines
```

**Blackjack Active Bet:**
```
POST /_api/casino/active-bet/blackjack
```

**Response Format (HiLo example):**
```json
{
  "user": {
    "activeCasinoBet": {
      "state": {
        "startCard": {"rank": "A", "suit": "H"},
        "rounds": [
          {
            "card": {"rank": "K", "suit": "D"},
            "guess": "high",
            "payoutMultiplier": 1.25
          }
        ]
      }
    }
  }
}
```

If `activeCasinoBet` is `null`, no active game.

---

## 3. Error Handling

### 3.1 Error Response Format

All errors follow GraphQL standard:

```json
{
  "errors": [
    {
      "errorType": "insufficientBalance",
      "message": "Insufficient balance for this bet"
    }
  ]
}
```

**Access pattern:**
```javascript
if (json.errors != null) {
    log(json.errors[0].errorType);
    log(json.errors[0].message);
}
```

### 3.2 Common Error Types

From code analysis:

| Error Type | Description | Handling |
|-----------|-------------|----------|
| `parallelCasinoBet` | Bet placed while another is processing | Silently ignore, retry |
| `existingGame` | Active game already exists | Resume existing game |
| `notFound` | Game/bet not found | Treat as cashout complete |
| `insignificantBet` | Bet amount too small | Treat as cashout complete |
| `insufficientBalance` | Not enough funds | Stop betting, log error |

**Error Handling Pattern:**
```javascript
if (json.errors != null) {
    // Don't log parallel bet errors (they're transient)
    if (!json.errors[0].errorType.includes("parallelCasinoBet")) {
        log(json.errors[0].errorType + ". " + json.errors[0].message)
        errorgame = true
    }

    // Resume existing game
    if (json.errors[0].errorType.includes("existingGame")) {
        if (game === "hilo") {
            activeBet();  // Fetch current state
        }
        if (game === "mines") {
            activeBetMines()
        }
        if (game === "blackjack") {
            activeBetBJ();
        }
    }

    // Cashout already done
    if (json.errors[0].errorType.includes("notFound")) {
        cashout_done = true
    }

    if (json.errors[0].errorType.includes("insignificantBet")) {
        cashout_done = true
    }
}
```

### 3.3 HTTP Status Code Handling

**Status 403 (Forbidden):**
```javascript
.catch(err => {
    if (err.status === 403) {
        setTimeout(() => {
            // Retry bet after 2 second delay
            // (Likely rate limit or temporary restriction)
        }, 2000);
    }
}
```

**Other Errors:**
```javascript
else {
    setTimeout(() => {
        // Generic retry with same parameters
        betRequest({ url, body, retryParams, retryDelay });
    }, 2000);
}
```

### 3.4 Retry Logic Pattern

The `betRequest` function implements automatic retry:

```javascript
function betRequest({ url, body, retryParams = [], retryDelay = 1000 }) {
    fetch(`https://${mirror}/${url}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
            'x-access-token': tokenapi
        }
    })
    .then(res => {
        if (!res.ok) {
            throw { status: res.status };
        }
        return res.json();
    })
    .then(json => data(json))
    .catch(err => {
        if (running) {
            if (err.status === 403) {
                setTimeout(() => {
                    // Re-invoke original bet function
                    gameFunctions[game]();
                }, 2000);
            } else {
                setTimeout(() => {
                    // Retry same request
                    betRequest({ url, body, retryParams, retryDelay });
                }, 2000);
            }
        }
    });
}
```

**Key Features:**
- Retry delay configurable (default 1000ms, often 2000ms)
- `retryParams` allows re-invoking bet with same parameters
- Only retries if `running` flag is true (allows stopping)

**Go Implementation:**
- Implement exponential backoff (start 1s, max 5s)
- Max retry attempts (e.g., 3-5)
- Respect user stop signal
- Different handling for 403 vs other errors
- Before retrying a 401/403, classify whether this is a session/Cloudflare failure. If yes, stop betting and mark the account `needs_browser_repair`.

### 3.5 Rate Limiting Indicators

**No explicit rate limit detection observed.**

Assumptions:
- 403 status likely indicates rate limit or anti-bot measure
- 2-second retry delay appears to be sufficient
- No Retry-After header parsing

---

## 4. Utility Functions

### 4.1 Random String Generation

Used for bet identifiers (prevents replay attacks):

```javascript
function randomString(length) {
    var chars = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
    var result = '';
    for (var i = length; i > 0; --i) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}
```

**Charset:** `_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-` (64 characters)

**Usage:**
- Bet identifiers: `randomString(21)` (21 characters)
- Default client seed: `randomString(10)` (10 characters)

**Go Implementation:**
```go
const charset = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"

func randomString(length int) string {
    b := make([]byte, length)
    for i := range b {
        b[i] = charset[rand.Intn(len(charset))]
    }
    return string(b)
}
```

### 4.2 Currency Handling

**Supported Currencies:**
From code variables:
- `btc` (Bitcoin)
- `eth` (Ethereum)
- `ltc` (Litecoin)
- `usdc` (USD Coin)
- `trx` (Tron)
- And others (extensible via GraphQL enum)

**Currency Format:**
- Lowercase string identifier
- Amounts as float64
- Display precision: 8 decimal places (`.toFixed(8)`)

**Go Implementation:**
- Define `CurrencyEnum` type
- Use `decimal.Decimal` for amounts (avoid float64 precision issues)
- Format with 8 decimals for display

### 4.3 No Crypto/Hashing Utilities

**The extension does NOT implement:**
- Client-side RNG verification
- HMAC-SHA256 calculation
- Seed hash verification

All game outcomes are trusted from server responses.

**For replay verification (separate concern):**
- Implement HMAC-SHA256(serverSeed, clientSeed:nonce) in Go backend
- Server seed is ASCII string (not hex)
- See main replay engine in `backend/internal/engine/rng.go`

---

## 5. Request Infrastructure

### 5.1 Base URL Construction

Pattern:
```javascript
`https://${mirror}/${url}`
```

Examples:
- `https://stake.com/_api/graphql`
- `https://stake.com/_api/casino/dice/roll`
- `https://stake.com/_api/casino/hilo/bet`

**URL Structure:**
- GraphQL endpoint: `/_api/graphql`
- Casino games: `/_api/casino/{game}/{action}`

### 5.2 Common Request Headers

**All requests:**
```javascript
headers: {
    'Content-Type': 'application/json',
    'x-access-token': tokenapi
}
```

**No other headers observed** (User-Agent, Origin, Referer not set explicitly)

**Fallback Go HTTP implementation:**
```go
req.Header.Set("Content-Type", "application/json")
req.Header.Set("x-access-token", sessionToken)
// Any additional headers must come from the selected browser profile/session,
// not from hard-coded header spoofing.
```

The primary browser-context implementation should let the browser attach cookies, user-agent, and other site-required request metadata naturally.

### 5.3 Request Method

**All API calls use POST**, even for queries:

```javascript
fetch(url, {
    method: 'POST',  // or 'post'
    body: JSON.stringify(body),
    headers: { ... }
})
```

**Including GraphQL queries** (not just mutations).

### 5.4 The betRequest() Function Pattern

Core betting abstraction:

```javascript
function betRequest({ url, body, retryParams = [], retryDelay = 1000 }) {
    fetch(`https://${mirror}/${url}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
            'x-access-token': tokenapi
        }
    })
    .then(res => {
        if (!res.ok) {
            throw { status: res.status };
        }
        return res.json();
    })
    .then(json => data(json))  // Global response handler
    .catch(err => {
        // Retry logic (see section 3.4)
    });
}
```

**Used by all game bet functions:**

**Dice:**
```javascript
function DiceBet(amount, chance, bethigh) {
    let target = bethigh ? (100 - chance) : chance;
    let cond = bethigh ? "above" : "below";

    betRequest({
        url: '_api/casino/dice/roll',
        body: {
            target,
            condition: cond,
            identifier: randomString(21),
            amount,
            currency
        },
        retryDelay: 2000,
        retryParams: [amount, chance, bethigh]
    });
}
```

**Limbo:**
```javascript
function LimboBet(amount, target_multi) {
    betRequest({
        url: '_api/casino/limbo/bet',
        body: {
            multiplierTarget: target_multi,
            identifier: randomString(21),
            amount,
            currency
        },
        retryDelay: 2000,
        retryParams: [amount, target_multi]
    });
}
```

**HiLo (bet):**
```javascript
function hiloBet(betsize, startcard) {
    betRequest({
        url: '_api/casino/hilo/bet',
        body: {
            identifier: randomString(21),
            currency,
            amount: betsize,
            startCard: startcard  // {rank: "A", suit: "H"}
        },
        retryParams: [betsize, startcard]
    });
}
```

**HiLo (next card):**
```javascript
function hiloNext(guessed) {
    betRequest({
        url: '_api/casino/hilo/next',
        body: { guess: guessed },  // "high", "low", "skip"
        retryParams: [guessed]
    });
}
```

**HiLo (cashout):**
```javascript
function hiloCash() {
    betRequest({
        url: '_api/casino/hilo/cashout',
        body: { identifier: randomString(21) }
    });
}
```

**Mines (start):**
```javascript
function minesbet(betsize, fields, mines) {
    betRequest({
        url: '_api/casino/mines/bet',
        body: {
            amount: betsize,
            currency,
            identifier: randomString(21),
            minesCount: mines,
            fields  // Array of revealed field indices
        }
    });
}
```

**Keno:**
```javascript
function kenobet(betsize, selected, risk) {
    betRequest({
        url: '_api/casino/keno/bet',
        body: {
            amount: betsize,
            currency,
            identifier: randomString(21),
            risk,  // "low", "medium", "high"
            numbers: selected  // Array of selected numbers
        }
    });
}
```

**Blackjack (bet):**
```javascript
function blackjackBet(betsize) {
    betRequest({
        url: '_api/casino/blackjack/bet',
        body: {
            identifier: randomString(21),
            currency,
            amount: betsize
        },
        retryParams: [betsize]
    });
}
```

**Blackjack (next action):**
```javascript
function blackjackNext(nextaction) {
    betRequest({
        url: '_api/casino/blackjack/next',
        body: {
            action: nextaction,  // "stand", "hit", "double", "split", "insurance", "noInsurance"
            identifier: randomString(21)
        },
        retryParams: [nextaction]
    });
}
```

**Baccarat:**
```javascript
function baccaratbet(tie, player, banker) {
    betRequest({
        url: '_api/casino/baccarat/bet',
        body: {
            currency,
            identifier: randomString(21),
            tie,     // Bet amount on tie
            player,  // Bet amount on player
            banker   // Bet amount on banker
        }
    });
}
```

---

## 6. Client Implementation Recommendations

### 6.1 Request Facade

```go
type StakeClient struct {
    accountID string
    mirror    string
    currency  string
    transport StakeTransport
}

type StakeTransport interface {
    GraphQL(ctx context.Context, operationName string, variables any, query string, result any) error
    Casino(ctx context.Context, path string, body any, result any) error
}

func NewStakeClient(accountID, mirror, currency string, transport StakeTransport) *StakeClient {
    return &StakeClient{
        accountID: accountID,
        mirror:    mirror,
        currency:  currency,
        transport: transport,
    }
}
```

`StakeTransport` should have two implementations:

- `BrowserProfileTransport`: primary implementation; executes through the selected embedded browser profile.
- `CookieJarHTTPTransport`: fallback implementation; uses cookies/headers from the browser profile only after the connection manager verifies it works.

### 6.2 Betting Preflight

```go
func (c *StakeClient) RequireConnected(state AccountConnectionState) error {
    if state != AccountConnected {
        return fmt.Errorf("stake account %s is not connected: %s", c.accountID, state)
    }
    return nil
}
```

### 6.3 Error Type Handling

```go
type StakeError struct {
    ErrorType string `json:"errorType"`
    Message   string `json:"message"`
}

type StakeResponse struct {
    Errors []StakeError       `json:"errors,omitempty"`
    Data   json.RawMessage    `json:"data,omitempty"`
}

func (r *StakeResponse) HasError() bool {
    return len(r.Errors) > 0
}

func (r *StakeResponse) FirstError() *StakeError {
    if r.HasError() {
        return &r.Errors[0]
    }
    return nil
}
```

### 6.4 Retry Logic

```go
func (c *StakeClient) doRequestWithRetry(ctx context.Context, path string, body interface{}, result interface{}, maxRetries int) error {
    var lastErr error

    for attempt := 0; attempt <= maxRetries; attempt++ {
        err := c.doRequest(ctx, path, body, result)
        if err == nil {
            return nil
        }

        // Check if error is retryable
        if httpErr, ok := err.(*HTTPError); ok {
            if httpErr.StatusCode == 401 || httpErr.StatusCode == 403 {
                return ErrNeedsBrowserRepair
            }
            if httpErr.StatusCode >= 500 {
                delay := time.Duration(math.Min(float64(2<<attempt), 5)) * time.Second
                select {
                case <-time.After(delay):
                    continue
                case <-ctx.Done():
                    return ctx.Err()
                }
            }
        }

        return err
    }

    return lastErr
}
```

### 6.5 Random String Generator

```go
const charset = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"

func randomString(length int) string {
    b := make([]byte, length)
    for i := range b {
        b[i] = charset[rand.Intn(len(charset))]
    }
    return string(b)
}

func betIdentifier() string {
    return randomString(21)
}

func defaultClientSeed() string {
    return randomString(10)
}
```

---

## 7. Summary Checklist

**Authentication:**
- [x] Extract session token from `session` cookie
- [x] Include `x-access-token` header in all requests
- [x] Handle domain mirrors dynamically
- [x] Use persistent embedded browser profile as primary session authority
- [x] Run mirror/session/credential connection checks before betting
- [ ] No standalone token refresh mechanism; repair through user-driven embedded browser login

**Account Operations:**
- [x] Query user balances (GraphQL: `UserBalances`)
- [x] Vault deposit (GraphQL: `CreateVaultDeposit`)
- [ ] Vault withdrawal (not implemented in extension)
- [x] Seed rotation (GraphQL: `RotateSeedPair`)
- [x] Active bet queries (HiLo, Mines, Blackjack)

**Error Handling:**
- [x] Parse GraphQL error format (`errors[0].errorType`, `errors[0].message`)
- [x] Handle common errors: `parallelCasinoBet`, `existingGame`, `notFound`, `insufficientBalance`, `insignificantBet`
- [x] HTTP 403 retry logic
- [x] Generic retry with exponential backoff

**Utilities:**
- [x] Random string generation for identifiers (21 chars)
- [x] Random client seed generation (10 chars)
- [x] Currency enum support
- [ ] No client-side RNG verification

**Request Infrastructure:**
- [x] Base URL: `https://{domain}/_api/...`
- [x] All requests use POST method
- [x] Standard headers: `Content-Type`, `x-access-token`
- [x] `betRequest()` pattern for all game bets
- [x] Automatic retry on failure
- [x] Browser-profile transport is primary; direct Go HTTP is fallback only

---

## Appendix: Complete Game Endpoints

| Game | Endpoint | Body Parameters |
|------|----------|----------------|
| Dice | `_api/casino/dice/roll` | `target`, `condition`, `identifier`, `amount`, `currency` |
| Limbo | `_api/casino/limbo/bet` | `multiplierTarget`, `identifier`, `amount`, `currency` |
| HiLo (bet) | `_api/casino/hilo/bet` | `identifier`, `currency`, `amount`, `startCard` |
| HiLo (next) | `_api/casino/hilo/next` | `guess` |
| HiLo (cashout) | `_api/casino/hilo/cashout` | `identifier` |
| Mines (bet) | `_api/casino/mines/bet` | `amount`, `currency`, `identifier`, `minesCount`, `fields` |
| Keno | `_api/casino/keno/bet` | `amount`, `currency`, `identifier`, `risk`, `numbers` |
| Blackjack (bet) | `_api/casino/blackjack/bet` | `identifier`, `currency`, `amount` |
| Blackjack (next) | `_api/casino/blackjack/next` | `action`, `identifier` |
| Baccarat | `_api/casino/baccarat/bet` | `currency`, `identifier`, `tie`, `player`, `banker` |

**Note:** This list is not exhaustive. The extension supports many more games (Plinko, Wheel, Roulette, Dragon Tower, etc.) with similar patterns.
