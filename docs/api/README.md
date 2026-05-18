# Stake API Documentation - Master Index

Comprehensive reverse-engineered documentation of the Stake.com casino API, extracted from the bot2love browser extension. This documentation provides everything needed to implement a complete Stake API client in Go.

## Table of Contents

1. [Overview](#overview)
2. [Quick Reference](#quick-reference)
3. [Architecture](#architecture)
4. [Document Index](#document-index)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Key Insights](#key-insights)

---

## Overview

This documentation is the result of comprehensive reverse engineering of the bot2love browser extension, which provides automated betting on Stake.com. The extension's JavaScript code has been analyzed to extract:

- All API endpoints (GraphQL and REST)
- Request/response structures
- Authentication mechanisms
- Error handling patterns
- Multi-round game state management
- Scripting engine specifications

**Source**: bot2love extension (index.js) - A browser extension that automates betting on Stake.com casino games.

**Purpose**: Provide complete API documentation to implement:
- Native Go API client for Stake.com
- Live bet streaming and analysis
- Automated betting strategies
- Provably fair verification
- Historical bet replay

---

## Quick Reference

### All API Endpoints

| Endpoint | Method | Purpose | Detailed Docs |
|----------|--------|---------|---------------|
| `/_api/graphql` | POST | GraphQL endpoint for all mutations/queries | [GraphQL Operations](./graphql-operations.md) |
| `/_api/casino/dice/roll` | POST | Place dice bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/limbo/bet` | POST | Place limbo bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/hilo/bet` | POST | Start HiLo game | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/hilo/next` | POST | Next HiLo card | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/hilo/cashout` | POST | Cash out HiLo | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/mines/bet` | POST | Start Mines game | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/mines/next` | POST | Reveal next tile | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/mines/cashout` | POST | Cash out Mines | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/keno/bet` | POST | Place keno bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/baccarat/bet` | POST | Place baccarat bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/blackjack/bet` | POST | Start blackjack game | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/blackjack/next` | POST | Next blackjack action | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/active-bet/hilo` | POST | Get active HiLo bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/active-bet/mines` | POST | Get active Mines bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/active-bet/blackjack` | POST | Get active Blackjack bet | [Game Endpoints](./game-endpoints.md) |
| `/_api/casino/plinko/bet` | POST | Place plinko bet | [Extended Games](./extended-game-endpoints.md) |
| `/_api/casino/wheel/bet` | POST | Place wheel bet | [Extended Games](./extended-game-endpoints.md) |
| `/_api/casino/roulette/bet` | POST | Place roulette bet | [Extended Games](./extended-game-endpoints.md) |
| `/_api/casino/dragontower/bet` | POST | Start dragon tower | [Extended Games](./extended-game-endpoints.md) |
| `/_api/casino/videopoker/bet` | POST | Place video poker bet | [Extended Games](./extended-game-endpoints.md) |
| `/_api/casino/bluesamurai/bet` | POST | Start blue samurai | [Extended Games](./extended-game-endpoints.md) |

### GraphQL Operations

| Operation | Type | Purpose | Detailed Docs |
|-----------|------|---------|---------------|
| `RotateSeedPair` | Mutation | Rotate client/server seed | [GraphQL Operations](./graphql-operations.md#graphql-mutations) |
| `CreateVaultDeposit` | Mutation | Deposit to vault | [GraphQL Operations](./graphql-operations.md#graphql-mutations) |
| `UserBalances` | Query | Get user balances | [GraphQL Operations](./graphql-operations.md#graphql-queries) |

---

## Architecture

### GraphQL vs REST

The Stake API uses a hybrid approach:

**GraphQL** (`/_api/graphql`):
- Account operations (balance queries, seed rotation)
- Vault deposits/withdrawals
- User profile data
- Structured query language for complex data fetching

**REST** (`/_api/casino/*`):
- All game betting operations
- Simple POST-based endpoints
- Game-specific paths (dice, limbo, hilo, etc.)
- Consistent request/response patterns

### When Each is Used

**Use GraphQL for:**
- Querying user account state
- Managing seeds (provably fair)
- Vault operations
- Multi-field data retrieval

**Use REST for:**
- Placing bets
- Game actions (hit, stand, reveal, etc.)
- Cashout operations
- Active bet queries

### Authentication

All endpoints require the `x-access-token` header:

```http
Content-Type: application/json
x-access-token: <session-cookie-value>
```

Token is extracted from the `session` cookie in the browser. See [Authentication and Utilities](./authentication-and-utilities.md) for details.

### Base URL Pattern

```
https://{domain}/_api/{endpoint-type}/{...}
```

- `{domain}`: `stake.com`, `stake.us`, or mirror domains
- `{endpoint-type}`: `graphql` or `casino`

---

## Document Index

### Core API Documentation

#### 1. [GraphQL Operations](./graphql-operations.md)
Complete GraphQL API reference including:
- Mutation: RotateSeedPair (seed rotation)
- Mutation: CreateVaultDeposit (vault deposits)
- Query: UserBalances (balance queries)
- Request/response structures
- Error handling

**Use this for**: Account operations, seed management, balance queries

#### 2. [Game Endpoints](./game-endpoints.md)
REST API endpoints for core casino games:
- Dice (single-round)
- Limbo (single-round)
- HiLo (multi-round with cashout)
- Mines (multi-round with cashout)
- Keno (single-round)
- Baccarat (single-round)
- Blackjack (multi-round)
- Active bet recovery endpoints

**Use this for**: Basic game betting implementation

#### 3. [Extended Game Endpoints](./extended-game-endpoints.md)
Placeholder for additional game endpoint extraction.

Expected coverage:
- Plinko
- Wheel
- Roulette
- Dragon Tower
- Video Poker
- Blue Samurai
- And 20+ other games

#### 4. [Authentication and Utilities](./authentication-and-utilities.md)
Authentication, session management, and utility patterns:
- Session token extraction
- Request headers
- Error handling patterns
- Retry logic
- Rate limiting
- Random string generation (identifiers)
- Currency handling
- Active bet recovery

**Use this for**: Building the API client foundation

### Scripting Engine Documentation

#### 5. [Scripting Model](../scripting/scripting-model.md)
Complete specification for the bot2love scripting engine:
- Global variables (balance, nextbet, win, etc.)
- Global functions (dobet(), round(), log(), etc.)
- Script execution lifecycle
- Game-specific configuration
- Example scripts (martingale, streak-based, etc.)

**Use this for**: Implementing a compatible JavaScript/Lua scripting engine in Go

#### 6. [Statistics and State](../scripting/statistics-and-state.md)
Statistics tracking and state management:
- Bet statistics (wins, losses, streaks)
- Profit/loss calculation
- Chart visualization data
- Bet result processing
- State machine (running, stopped, error)
- Multi-round game state handling
- SQLite persistence schema

**Use this for**: Building session tracking, analytics, and replay systems

---

## Implementation Roadmap

Suggested order for implementing Stake API features in Go:

### Phase 1: Authentication & Session Management

**Priority**: Critical
**Estimated Effort**: 1-2 days

- [ ] Implement session token storage
- [ ] Create HTTP client with proper headers
- [ ] Implement retry logic with exponential backoff
- [ ] Handle 403 rate limiting
- [ ] Support domain mirrors (stake.com, stake.us, etc.)
- [ ] Test authentication with UserBalances query

**Files to reference**:
- [Authentication and Utilities](./authentication-and-utilities.md)
- [GraphQL Operations](./graphql-operations.md)

**Success criteria**: Successfully query user balance via GraphQL

---

### Phase 2: Core Game Betting (Dice, Limbo)

**Priority**: High
**Estimated Effort**: 2-3 days

- [ ] Implement request identifier generation (21-char random strings)
- [ ] Create Dice bet endpoint
- [ ] Create Limbo bet endpoint
- [ ] Parse game responses
- [ ] Determine win/loss from payoutMultiplier
- [ ] Track basic statistics (bets, wins, losses)
- [ ] Implement bet retry on failure

**Files to reference**:
- [Game Endpoints](./game-endpoints.md#dice)
- [Game Endpoints](./game-endpoints.md#limbo)
- [Authentication and Utilities](./authentication-and-utilities.md#utility-functions)

**Success criteria**: Place Dice and Limbo bets, correctly identify wins/losses

---

### Phase 3: Multi-Round Games (HiLo, Mines, Blackjack)

**Priority**: Medium
**Estimated Effort**: 3-5 days

- [ ] Implement state tracking for active bets
- [ ] Create HiLo endpoints (bet, next, cashout)
- [ ] Create Mines endpoints (bet, next, cashout)
- [ ] Create Blackjack endpoints (bet, next)
- [ ] Implement active bet recovery
- [ ] Handle `existingGame` error type
- [ ] Track game state (currentBet, cashout_done)
- [ ] Support multi-round decision logic

**Files to reference**:
- [Game Endpoints](./game-endpoints.md#hilo)
- [Game Endpoints](./game-endpoints.md#mines)
- [Game Endpoints](./game-endpoints.md#blackjack)
- [Statistics and State](../scripting/statistics-and-state.md#multi-round-game-handling)

**Success criteria**: Complete a full HiLo game with multiple rounds and cashout

---

### Phase 4: Extended Games

**Priority**: Low
**Estimated Effort**: 2-4 days

- [ ] Implement Keno endpoint
- [ ] Implement Baccarat endpoint
- [ ] Implement Plinko endpoint
- [ ] Implement Wheel endpoint
- [ ] Implement Roulette endpoint
- [ ] Implement remaining 20+ games
- [ ] Test all game-specific parameters

**Files to reference**:
- [Game Endpoints](./game-endpoints.md#keno)
- [Game Endpoints](./game-endpoints.md#baccarat)
- [Extended Game Endpoints](./extended-game-endpoints.md)

**Success criteria**: Successfully bet on all documented games

---

### Phase 5: Scripting Engine

**Priority**: Medium (for desktop app)
**Estimated Effort**: 5-7 days

- [ ] Choose JavaScript VM (goja recommended)
- [ ] Implement global variable injection
- [ ] Implement global functions (log, sleep, stop, resetstats)
- [ ] Create dobet() callback mechanism
- [ ] Create round() callback for multi-round games
- [ ] Sandbox script execution (no network/file access)
- [ ] Handle script errors gracefully
- [ ] Implement statistics tracking
- [ ] Create example scripts
- [ ] Test with martingale, d'Alembert, and streak-based strategies

**Files to reference**:
- [Scripting Model](../scripting/scripting-model.md)
- [Statistics and State](../scripting/statistics-and-state.md)

**Success criteria**: Run a martingale script that places 100 bets automatically

---

### Phase 6: Advanced Features

**Priority**: Low
**Estimated Effort**: Ongoing

- [ ] Implement seed rotation via GraphQL
- [ ] Implement vault deposit/withdrawal
- [ ] Create SQLite persistence for sessions
- [ ] Build bet replay system
- [ ] Implement live bet streaming
- [ ] Create analytics dashboard
- [ ] Build provably fair verification
- [ ] Implement chart visualization
- [ ] Add export functionality (CSV, JSON)

**Files to reference**:
- [GraphQL Operations](./graphql-operations.md)
- [Statistics and State](../scripting/statistics-and-state.md#data-model-for-sqlite-persistence)

**Success criteria**: Full-featured desktop app with replay and analytics

---

## Key Insights

Important discoveries from the reverse engineering process:

### 1. Rate Limiting Behavior

**Observation**: HTTP 403 responses indicate rate limiting.

**Handling**:
- Retry after 2-second delay
- Do not retry more than 3 times consecutively
- Consider backing off if 403s persist

**Code pattern**:
```javascript
if (err.status === 403) {
  setTimeout(() => retryBet(), 2000);
}
```

**Implementation note**: The extension retries indefinitely on 403. A production Go client should implement max retry limits.

---

### 2. Error Handling Patterns

**Common error types**:

| Error Type | Meaning | Handling |
|------------|---------|----------|
| `parallelCasinoBet` | Multiple bets in flight | Silent retry, don't log |
| `existingGame` | Active game already exists | Fetch active bet state |
| `notFound` | Bet/game not found | Treat as complete (cashout done) |
| `insignificantBet` | Bet too small | Treat as complete |
| `insufficientBalance` | Not enough funds | Stop betting, alert user |

**Key pattern**: Errors are returned in `errors` array, not via HTTP status codes:

```json
{
  "errors": [
    {
      "errorType": "existingGame",
      "message": "You already have an active game"
    }
  ]
}
```

**Implementation note**: Always check `json.errors` before processing `json.data`.

---

### 3. Identifier Requirements

**All bet requests require a random identifier**:
- **Length**: 21 characters
- **Charset**: `_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-`
- **Purpose**: Prevents replay attacks, ensures request uniqueness

**Implementation**:
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
```

**Critical**: Generate a new identifier for EVERY bet request.

---

### 4. Multi-Round Game State Management

**Games with multi-round state**: HiLo, Mines, Blackjack

**State tracking requirements**:

1. **Active bet object** (`currentBet`):
   - Contains full game state
   - Updated after each action
   - Persists until game ends

2. **Cashout flag** (`cashout_done`):
   - `false` = game in progress
   - `true` = game complete, process stats

3. **Active bet indicator** (`bet.active`):
   - Server-side state
   - `true` = more actions needed
   - `false` = game ended

**State flow**:
```
Place bet → bet.active=true, cashout_done=false
    ↓
Take action → if bet.active: continue
             if !bet.active: cashout_done=true, process
    ↓
Cashout OR lose → bet.active=false, cashout_done=true
```

**Recovery pattern**:
If `existingGame` error occurs:
1. Call `/_api/casino/active-bet/{game}`
2. Resume from current state
3. Don't count as new bet

**Critical**: Never call `dobet()` callback until `cashout_done=true`.

---

### 5. Win/Loss Determination

**Universal rule**: `payoutMultiplier >= 1.0` = win

**Rationale**:
- Win: `payoutMultiplier > 1` (profit)
- Push: `payoutMultiplier = 1` (break even)
- Loss: `payoutMultiplier < 1` (usually 0)

**Profit calculation**:
```javascript
current_profit = bet.payout - bet.amount
```

Where:
```javascript
bet.payout = bet.amount * bet.payoutMultiplier
```

**Example**:
- Bet: 0.001 BTC
- Win at 2x: payout = 0.002, profit = 0.001
- Loss: payout = 0, profit = -0.001
- Push: payout = 0.001, profit = 0

**Implementation note**: Use `decimal.Decimal` in Go to avoid float precision errors.

---

### 6. Currency Precision

**All amounts use 8 decimal places**:
- Display: `.toFixed(8)`
- Storage: float64 (or decimal.Decimal recommended)
- No scaling to satoshis/wei

**Currency codes**: lowercase strings
- `"btc"`, `"eth"`, `"usdc"`, `"trx"`, `"ltc"`, etc.

**Implementation note**: Use `shopspring/decimal` for accurate financial math:
```go
import "github.com/shopspring/decimal"

amount := decimal.NewFromFloat(0.00000001)
```

---

### 7. Bet Response Structure Inconsistency

**Two response formats exist**:

**Format 1 (REST endpoints)**: Direct game object
```json
{
  "diceRoll": {
    "id": "...",
    "amount": 0.001,
    "payout": 0.002,
    ...
  }
}
```

**Format 2 (GraphQL-style)**: Wrapped in `data`
```json
{
  "data": {
    "diceRoll": {
      "id": "...",
      ...
    }
  }
}
```

**Detection pattern**:
```javascript
const gameType = Object.keys(json)[0] === "data"
  ? Object.keys(json.data)[0]
  : Object.keys(json)[0];
```

**Implementation note**: Your Go client should handle both formats transparently.

---

### 8. HiLo Card Rank Values

**Card ranks**: `"A"`, `"2"` - `"10"`, `"J"`, `"Q"`, `"K"`

**Numeric ordering for HiLo**:
- A = 1 (lowest)
- 2-10 = face value
- J = 11
- Q = 12
- K = 13 (highest)

**Suit values**: `"H"` (hearts), `"D"` (diamonds), `"C"` (clubs), `"S"` (spades)

**Guess types**:
- `"higher"` = next card higher rank
- `"lower"` = next card lower rank
- `"equal"` = next card same rank
- `"higherEqual"` = next card >= current
- `"lowerEqual"` = next card <= current
- `"skip"` = skip current card

**Edge cases**:
- If current = A, "lower" is impossible
- If current = K, "higher" is impossible
- "equal" always low probability (1/13)

---

### 9. No Token Refresh Mechanism

**Critical limitation**: Session tokens expire, but there is NO programmatic refresh mechanism.

**Implications**:
- User must manually provide valid token
- Token extracted from browser cookies
- On authentication failure (401/403):
  - Prompt user to provide fresh token
  - No automatic re-authentication possible

**Mitigation strategies**:
1. Detect token expiry early (test with UserBalances)
2. Show clear error message to user
3. Provide instructions for extracting new token
4. Save token to config file for reuse

**Implementation note**: Desktop app should cache token, but be prepared to re-prompt user.

---

### 10. Mines Field Indexing

**Mines grid**: 5x5 = 25 positions

**Field indices**: 0-24 (zero-indexed)

**Grid layout**:
```
 0  1  2  3  4
 5  6  7  8  9
10 11 12 13 14
15 16 17 18 19
20 21 22 23 24
```

**Request format**:
```json
{
  "fields": [0, 5, 12, 18]
}
```

**Response includes**:
- `state.mines`: Array of mine positions (only revealed when game ends)
- `state.rounds`: Array of revealed positions with multipliers

**Critical**: Never send duplicate fields. Server may reject or treat as hit mine.

---

### 11. Blackjack Action Availability

**Actions vary by game state**:

Server returns `state.actions` array indicating available actions:
```json
{
  "state": {
    "actions": ["BLACKJACK_HIT", "BLACKJACK_STAND", "BLACKJACK_DOUBLE"]
  }
}
```

**Action mapping**:
- `BLACKJACK_HIT` → `"hit"`
- `BLACKJACK_STAND` → `"stand"`
- `BLACKJACK_DOUBLE` → `"double"`
- `BLACKJACK_SPLIT` → `"split"`
- `BLACKJACK_INSURANCE` → `"insurance"`
- `BLACKJACK_NOINSURANCE` → `"noInsurance"`

**Client must**:
1. Check `state.actions` array
2. Only send actions present in array
3. Sending invalid action likely results in error

**Implementation note**: Validate action against available actions before sending.

---

### 12. Statistics Update Timing

**Statistics are updated AFTER each bet completes**, not continuously.

**Update triggers**:
1. Bet response received
2. Win/loss determined
3. Profit calculated
4. Statistics incremented
5. UI updated

**For multi-round games**: Statistics only update when `cashout_done=true`.

**Implication**: During a 10-round HiLo game, statistics don't change until final cashout.

**Implementation note**: Don't update session stats until bet is fully complete.

---

## Additional Resources

### Related Files in Repository

- `C:\Users\Mike\.claude-worktrees\stake-pf-replay-go\ecstatic-darwin\backend\internal\engine\rng.go` - Provably fair RNG implementation (HMAC-SHA256)
- `C:\Users\Mike\.claude-worktrees\stake-pf-replay-go\ecstatic-darwin\backend\internal\games\*` - Game-specific replay logic
- `C:\Users\Mike\.claude-worktrees\stake-pf-replay-go\ecstatic-darwin\internal\livestore\` - SQLite storage for live bets

### External References

- [Stake.com Provably Fair Documentation](https://stake.com/settings/fairness) - Official RNG verification
- [GraphQL Specification](https://graphql.org/learn/) - GraphQL query language
- [goja JavaScript VM](https://github.com/dop251/goja) - Recommended for Go scripting engine

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-14 | Initial documentation extracted from bot2love extension |

---

## Contributing

This documentation is reverse-engineered from a third-party browser extension and may have gaps or inaccuracies.

**To contribute**:
1. Test endpoints with real Stake.com account
2. Document any discrepancies
3. Add missing games or features
4. Submit issues or pull requests

**Note**: This documentation is for educational and development purposes. Use responsibly and in accordance with Stake.com's Terms of Service.

---

## License

This documentation is provided as-is for educational purposes. The Stake API is proprietary to Stake.com. Use of the API must comply with Stake's Terms of Service.

**Disclaimer**: This is NOT official Stake documentation. It is reverse-engineered from a third-party browser extension and may be incomplete or incorrect.

---

## Summary

This master index provides:
- Quick reference to all 30+ API endpoints
- Links to detailed documentation files
- Architecture overview (GraphQL vs REST)
- Phase-by-phase implementation roadmap
- 12+ key insights not obvious from endpoint signatures
- Data models and error handling patterns

**Next steps**:
1. Read [Authentication and Utilities](./authentication-and-utilities.md) to understand the foundation
2. Follow the [Implementation Roadmap](#implementation-roadmap) phase by phase
3. Refer to specific game documentation as needed
4. Use the [Key Insights](#key-insights) to avoid common pitfalls

Good luck with your implementation!
