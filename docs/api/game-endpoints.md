# Stake Casino Game API Endpoints

Comprehensive documentation of REST API endpoints for Stake casino games, extracted from bot2love extension analysis.

## Table of Contents

- [Authentication](#authentication)
- [Common Request/Response Patterns](#common-requestresponse-patterns)
- [Error Handling](#error-handling)
- [Dice](#dice)
- [Limbo](#limbo)
- [HiLo](#hilo)
- [Mines](#mines)
- [Keno](#keno)
- [Baccarat](#baccarat)
- [Blackjack](#blackjack)
- [Active Bet Endpoints](#active-bet-endpoints)

---

## Authentication

All API requests require authentication via the `x-access-token` header, but the product must not assume a detached Go HTTP client can satisfy Stake/Cloudflare on its own. Betting calls should execute only after the account connector reports `connected`.

The supported desktop request path is:

1. User selects a Stake account.
2. The account connector verifies mirror reachability, browser session health, and account credentials.
3. The typed game client sends requests through the connected browser-profile transport.
4. Results are persisted to the ledger before the UI or bot engine treats the bet as complete.

Direct Go HTTP with copied cookies/headers is a fallback transport, not the primary product plan.

### Headers

```typescript
interface RequestHeaders {
  'Content-Type': 'application/json';
  'x-access-token': string; // User's API token
}
```

### Base URL Pattern

```
https://{mirror}/_api/casino/{game}/{action}
```

Where `{mirror}` is the Stake domain (e.g., `stake.com`).

---

## Common Request/Response Patterns

### Common Request Fields

```typescript
interface CommonRequestFields {
  identifier: string;    // Random 21-character string: [_-0-9a-zA-Z]
  currency: string;      // e.g., "btc", "eth", "usdc", "ltc"
  amount?: number;       // Bet amount (when applicable)
}
```

### Common Response Structure

#### Success Response

```typescript
interface SuccessResponse<T> {
  [gameType: string]: T; // e.g., "diceRoll", "limboBet", "hiloBet"
}

// Alternative wrapper format
interface DataWrapper<T> {
  data: {
    [gameType: string]: T;
  };
}
```

#### Bet Response Common Fields

```typescript
interface BaseBetResponse {
  id: string;
  active: boolean;
  amount: number;
  currency: string;
  payoutMultiplier: number;
  payout: number;
  user: {
    name: string;
    activeCasinoBet?: CasinoBet | null;
  };
  state: any; // Game-specific state
}
```

---

## Error Handling

### Error Response Structure

```typescript
interface ErrorResponse {
  errors: Array<{
    errorType: string;
    message: string;
  }>;
}
```

### Common Error Types

- `parallelCasinoBet` - Trying to place multiple bets simultaneously
- `existingGame` - Active game already exists for user
- `notFound` - Bet/game not found (e.g., trying to cashout non-existent bet)
- `insignificantBet` - Bet amount too small or invalid cashout attempt
- `403` - Authentication/authorization failure

### Error Handling Pattern

```typescript
if (response.status === 403) {
  // Stop the betting session and ask the account connector to repair/check the browser session.
} else {
  // Retry only if the error is classified as transient and the user/session is still running.
}
```

`401` and `403` must be classified by the account connector before retrying. A Cloudflare challenge, expired browser session, or invalid credential should move the account to a repair state and stop automated betting.

---

## Dice

### Roll Dice

**Endpoint:** `POST /_api/casino/dice/roll`

**Request Body:**

```typescript
interface DiceRollRequest extends CommonRequestFields {
  target: number;        // Target number (0-100)
  condition: "above" | "below";
}
```

**Request Example:**

```json
{
  "target": 50.5,
  "condition": "above",
  "identifier": "aB3-xY9_zW2qP4mN5kL6j",
  "amount": 0.00001000,
  "currency": "btc"
}
```

**Implementation Note:**

```typescript
// Converting from chance and bethigh to target/condition
if (bethigh) {
  target = 100 - chance;
  condition = "above";
} else {
  target = chance;
  condition = "below";
}
```

**Response Body:**

```typescript
interface DiceRollResponse extends BaseBetResponse {
  state: {
    result: number;      // Actual roll result (0-100)
    target: number;      // Target number
    condition: "above" | "below";
  };
}
```

**Response Example:**

```json
{
  "diceRoll": {
    "id": "bet_abc123",
    "active": false,
    "amount": 0.00001000,
    "currency": "btc",
    "payoutMultiplier": 1.98,
    "payout": 0.00001980,
    "user": {
      "name": "username"
    },
    "state": {
      "result": 75.42,
      "target": 50.5,
      "condition": "above"
    }
  }
}
```

---

## Limbo

### Place Limbo Bet

**Endpoint:** `POST /_api/casino/limbo/bet`

**Request Body:**

```typescript
interface LimboBetRequest extends CommonRequestFields {
  multiplierTarget: number; // Target multiplier (e.g., 2.00, 10.00, 100.00)
}
```

**Request Example:**

```json
{
  "multiplierTarget": 2.00,
  "identifier": "xY3-zA9_bW2qP4mN5kL6j",
  "amount": 0.00001000,
  "currency": "btc"
}
```

**Response Body:**

```typescript
interface LimboBetResponse extends BaseBetResponse {
  state: {
    result: number;           // Actual multiplier result
    multiplierTarget: number; // Target multiplier
  };
}
```

**Response Example:**

```json
{
  "limboBet": {
    "id": "bet_xyz789",
    "active": false,
    "amount": 0.00001000,
    "currency": "btc",
    "payoutMultiplier": 0,
    "payout": 0,
    "user": {
      "name": "username"
    },
    "state": {
      "result": 1.85,
      "multiplierTarget": 2.00
    }
  }
}
```

**Notes:**

- Win condition: `result >= multiplierTarget`
- Chance calculation: `99 / multiplierTarget`
- Retry delay: 2000ms

---

## HiLo

### Start HiLo Game

**Endpoint:** `POST /_api/casino/hilo/bet`

**Request Body:**

```typescript
interface HiloBetRequest extends CommonRequestFields {
  startCard: Card;
}

interface Card {
  rank: "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
  suit: "H" | "D" | "C" | "S"; // Hearts, Diamonds, Clubs, Spades
}
```

**Request Example:**

```json
{
  "identifier": "pQ3-mN9_xY2zA4bW5cV6d",
  "currency": "usdc",
  "amount": 0.003,
  "startCard": {
    "rank": "A",
    "suit": "H"
  }
}
```

**Response Body:**

```typescript
interface HiloBetResponse extends BaseBetResponse {
  active: true; // Always true for initial bet
  state: {
    startCard: Card;
    rounds: Array<{
      card: Card;
      guess: GuessType;
      payoutMultiplier: number;
    }>;
  };
}
```

**Response Example:**

```json
{
  "hiloBet": {
    "id": "bet_hilo123",
    "active": true,
    "amount": 0.003,
    "currency": "usdc",
    "payoutMultiplier": 1.0,
    "payout": 0.003,
    "user": {
      "name": "username"
    },
    "state": {
      "startCard": {
        "rank": "A",
        "suit": "H"
      },
      "rounds": []
    }
  }
}
```

### Next HiLo Card

**Endpoint:** `POST /_api/casino/hilo/next`

**Request Body:**

```typescript
type GuessType = "lower" | "higher" | "equal" | "lowerEqual" | "higherEqual" | "skip";

interface HiloNextRequest {
  guess: GuessType;
}
```

**Request Example:**

```json
{
  "guess": "higher"
}
```

**Response Body:**

```typescript
interface HiloNextResponse extends BaseBetResponse {
  active: boolean; // true if game continues, false if lost
  state: {
    startCard: Card;
    rounds: Array<{
      card: Card;
      guess: GuessType;
      payoutMultiplier: number; // >= 0.98 = win round, < 0.98 = lose round
    }>;
  };
}
```

**Response Example (Win Round):**

```json
{
  "hiloNext": {
    "id": "bet_hilo123",
    "active": true,
    "amount": 0.003,
    "currency": "usdc",
    "payoutMultiplier": 1.25,
    "payout": 0.00375,
    "user": {
      "name": "username"
    },
    "state": {
      "startCard": {
        "rank": "A",
        "suit": "H"
      },
      "rounds": [
        {
          "card": {
            "rank": "K",
            "suit": "D"
          },
          "guess": "higher",
          "payoutMultiplier": 1.25
        }
      ]
    }
  }
}
```

**Response Example (Lose Round):**

```json
{
  "hiloNext": {
    "id": "bet_hilo123",
    "active": false,
    "amount": 0.003,
    "currency": "usdc",
    "payoutMultiplier": 0,
    "payout": 0,
    "user": {
      "name": "username"
    },
    "state": {
      "startCard": {
        "rank": "A",
        "suit": "H"
      },
      "rounds": [
        {
          "card": {
            "rank": "5",
            "suit": "C"
          },
          "guess": "higher",
          "payoutMultiplier": 0
        }
      ]
    }
  }
}
```

### Cash Out HiLo

**Endpoint:** `POST /_api/casino/hilo/cashout`

**Request Body:**

```typescript
interface HiloCashoutRequest {
  identifier: string; // Random 21-character string
}
```

**Request Example:**

```json
{
  "identifier": "rS3-tU9_vW2xY4zA5bC6d"
}
```

**Response Body:**

```typescript
interface HiloCashoutResponse extends BaseBetResponse {
  active: false; // Always false after cashout
  state: {
    startCard: Card;
    rounds: Array<{
      card: Card;
      guess: GuessType;
      payoutMultiplier: number;
    }>;
  };
}
```

**Response Example:**

```json
{
  "hiloCashout": {
    "id": "bet_hilo123",
    "active": false,
    "amount": 0.003,
    "currency": "usdc",
    "payoutMultiplier": 2.5,
    "payout": 0.0075,
    "user": {
      "name": "username"
    },
    "state": {
      "startCard": {
        "rank": "A",
        "suit": "H"
      },
      "rounds": [
        {
          "card": {
            "rank": "K",
            "suit": "D"
          },
          "guess": "higher",
          "payoutMultiplier": 1.25
        },
        {
          "card": {
            "rank": "Q",
            "suit": "S"
          },
          "guess": "lower",
          "payoutMultiplier": 2.5
        }
      ]
    }
  }
}
```

**Error Cases:**

- `notFound` - No active bet to cashout
- `insignificantBet` - Bet amount too small to cashout

---

## Mines

### Start Mines Game (Without Fields)

**Endpoint:** `POST /_api/casino/mines/bet`

**Request Body (Start Only):**

```typescript
interface MinesBetStartRequest extends CommonRequestFields {
  minesCount: number; // Number of mines (1-24)
  // fields: not included when just starting
}
```

**Request Example:**

```json
{
  "amount": 0.001,
  "currency": "btc",
  "minesCount": 3
}
```

### Place Mines Bet (With Fields)

**Request Body (With Selections):**

```typescript
interface MinesBetRequest extends CommonRequestFields {
  minesCount: number; // Number of mines (1-24)
  fields: number[];   // Selected field indices (0-24)
}
```

**Request Example:**

```json
{
  "amount": 0.001,
  "currency": "btc",
  "identifier": "eF3-gH9_iJ2kL4mN5oP6q",
  "minesCount": 3,
  "fields": [0, 5, 12]
}
```

**Response Body:**

```typescript
interface MinesBetResponse extends BaseBetResponse {
  active: boolean; // true if game continues, false if hit mine or cashed out
  state: {
    minesCount: number;
    mines: number[];    // Mine positions (only revealed when game ends)
    rounds: Array<{
      field: number;
      payoutMultiplier: number;
    }>;
  };
}
```

**Response Example (Active Game):**

```json
{
  "minesBet": {
    "id": "bet_mines456",
    "active": false,
    "amount": 0.001,
    "currency": "btc",
    "payoutMultiplier": 0,
    "payout": 0,
    "user": {
      "name": "username"
    },
    "state": {
      "minesCount": 3,
      "mines": [2, 7, 18],
      "rounds": [
        {
          "field": 0,
          "payoutMultiplier": 1.1
        },
        {
          "field": 5,
          "payoutMultiplier": 1.25
        },
        {
          "field": 12,
          "payoutMultiplier": 1.45
        }
      ]
    }
  }
}
```

### Select Next Mine Field

**Endpoint:** `POST /_api/casino/mines/next`

**Request Body:**

```typescript
interface MinesNextRequest {
  fields: number[]; // Array of selected field index (0-24)
}
```

**Request Example:**

```json
{
  "fields": [8]
}
```

**Response Body:**

Same as `MinesBetResponse`.

**Response Example (Hit Mine):**

```json
{
  "minesNext": {
    "id": "bet_mines456",
    "active": false,
    "amount": 0.001,
    "currency": "btc",
    "payoutMultiplier": 0,
    "payout": 0,
    "user": {
      "name": "username"
    },
    "state": {
      "minesCount": 3,
      "mines": [2, 7, 18],
      "rounds": [
        {
          "field": 0,
          "payoutMultiplier": 1.1
        },
        {
          "field": 7,
          "payoutMultiplier": 0
        }
      ]
    }
  }
}
```

### Cash Out Mines

**Endpoint:** `POST /_api/casino/mines/cashout`

**Request Body:**

```typescript
interface MinesCashoutRequest {
  identifier: string; // Random 21-character string
}
```

**Request Example:**

```json
{
  "identifier": "wX3-yZ9_aB2cD4eF5gH6i"
}
```

**Response Body:**

Same as `MinesBetResponse` with `active: false`.

**Response Example:**

```json
{
  "minesCashout": {
    "id": "bet_mines456",
    "active": false,
    "amount": 0.001,
    "currency": "btc",
    "payoutMultiplier": 1.45,
    "payout": 0.00145,
    "user": {
      "name": "username"
    },
    "state": {
      "minesCount": 3,
      "mines": [2, 7, 18],
      "rounds": [
        {
          "field": 0,
          "payoutMultiplier": 1.1
        },
        {
          "field": 5,
          "payoutMultiplier": 1.25
        },
        {
          "field": 12,
          "payoutMultiplier": 1.45
        }
      ]
    }
  }
}
```

---

## Keno

### Place Keno Bet

**Endpoint:** `POST /_api/casino/keno/bet`

**Request Body:**

```typescript
type KenoRisk = "low" | "classic" | "high";

interface KenoBetRequest extends CommonRequestFields {
  risk: KenoRisk;
  numbers: number[]; // Selected numbers (0-39), array length 1-10
}
```

**Request Example:**

```json
{
  "amount": 0.005,
  "currency": "usdc",
  "identifier": "jK3-lM9_nO2pQ4rS5tU6v",
  "risk": "classic",
  "numbers": [5, 12, 18, 23, 31, 37]
}
```

**Response Body:**

```typescript
interface KenoBetResponse extends BaseBetResponse {
  state: {
    risk: KenoRisk;
    selectedNumbers: number[]; // Numbers player selected (0-39)
    drawnNumbers: number[];    // Numbers drawn by game (0-39)
  };
}
```

**Response Example:**

```json
{
  "kenoBet": {
    "id": "bet_keno789",
    "active": false,
    "amount": 0.005,
    "currency": "usdc",
    "payoutMultiplier": 2.5,
    "payout": 0.0125,
    "user": {
      "name": "username"
    },
    "state": {
      "risk": "classic",
      "selectedNumbers": [5, 12, 18, 23, 31, 37],
      "drawnNumbers": [5, 8, 12, 15, 18, 22, 23, 29, 33, 37]
    }
  }
}
```

**Notes:**

- Hit count: `selectedNumbers.filter(n => drawnNumbers.includes(n)).length`
- Payout based on hit count, risk level, and number of selected numbers

---

## Baccarat

### Place Baccarat Bet

**Endpoint:** `POST /_api/casino/baccarat/bet`

**Request Body:**

```typescript
interface BaccaratBetRequest extends CommonRequestFields {
  tie: number;    // Bet amount on tie
  player: number; // Bet amount on player
  banker: number; // Bet amount on banker
}
```

**Request Example:**

```json
{
  "currency": "usdc",
  "identifier": "wX3-yZ9_aB2cD4eF5gH6i",
  "tie": 0,
  "player": 0.003,
  "banker": 0.001
}
```

**Response Body:**

```typescript
type BaccaratWinner = "player" | "banker" | "tie";

interface BaccaratBetResponse extends BaseBetResponse {
  state: {
    winner: BaccaratWinner;
    playerCards?: Card[];
    bankerCards?: Card[];
    playerScore?: number;
    bankerScore?: number;
  };
}
```

**Response Example:**

```json
{
  "baccaratBet": {
    "id": "bet_baccarat012",
    "active": false,
    "amount": 0.004,
    "currency": "usdc",
    "payoutMultiplier": 1.0,
    "payout": 0.004,
    "user": {
      "name": "username"
    },
    "state": {
      "winner": "player"
    }
  }
}
```

**Notes:**

- Total bet amount = `tie + player + banker`
- Payout depends on which bet(s) won and their respective odds

---

## Blackjack

### Start Blackjack Game

**Endpoint:** `POST /_api/casino/blackjack/bet`

**Request Body:**

```typescript
interface BlackjackBetRequest extends CommonRequestFields {
  // amount and currency inherited from CommonRequestFields
}
```

**Request Example:**

```json
{
  "identifier": "cD3-eF9_gH2iJ4kL5mN6o",
  "currency": "btc",
  "amount": 0.0001
}
```

**Response Body:**

```typescript
interface BlackjackBetResponse extends BaseBetResponse {
  active: boolean; // true if player needs to make decisions
  state: {
    playerHands?: Hand[][];
    dealerHand?: Card[];
    actions?: BlackjackAction[];
  };
}

interface Hand {
  cards: Card[];
  value: number;
  status?: "active" | "stand" | "bust" | "blackjack";
}

type BlackjackAction =
  | "BLACKJACK_HIT"
  | "BLACKJACK_STAND"
  | "BLACKJACK_DOUBLE"
  | "BLACKJACK_SPLIT"
  | "BLACKJACK_INSURANCE"
  | "BLACKJACK_NOINSURANCE";
```

**Response Example:**

```json
{
  "blackjackBet": {
    "id": "bet_bj345",
    "active": true,
    "amount": 0.0001,
    "currency": "btc",
    "payoutMultiplier": 1.0,
    "payout": 0.0001,
    "user": {
      "name": "username"
    },
    "state": {
      "playerHands": [
        [
          {
            "rank": "K",
            "suit": "H"
          },
          {
            "rank": "7",
            "suit": "D"
          }
        ]
      ],
      "dealerHand": [
        {
          "rank": "9",
          "suit": "C"
        }
      ],
      "actions": ["BLACKJACK_HIT", "BLACKJACK_STAND", "BLACKJACK_DOUBLE"]
    }
  }
}
```

### Next Blackjack Action

**Endpoint:** `POST /_api/casino/blackjack/next`

**Request Body:**

```typescript
type BlackjackActionType = "hit" | "stand" | "double" | "split" | "insurance" | "noInsurance";

interface BlackjackNextRequest extends Partial<CommonRequestFields> {
  action: BlackjackActionType;
  identifier: string;
}
```

**Request Example:**

```json
{
  "action": "hit",
  "identifier": "pQ3-rS9_tU2vW4xY5zA6b"
}
```

**Response Body:**

Same as `BlackjackBetResponse`.

**Response Example (Continue):**

```json
{
  "blackjackNext": {
    "id": "bet_bj345",
    "active": true,
    "amount": 0.0001,
    "currency": "btc",
    "payoutMultiplier": 1.0,
    "payout": 0.0001,
    "user": {
      "name": "username"
    },
    "state": {
      "playerHands": [
        [
          {
            "rank": "K",
            "suit": "H"
          },
          {
            "rank": "7",
            "suit": "D"
          },
          {
            "rank": "3",
            "suit": "S"
          }
        ]
      ],
      "dealerHand": [
        {
          "rank": "9",
          "suit": "C"
        }
      ],
      "actions": ["BLACKJACK_HIT", "BLACKJACK_STAND"]
    }
  }
}
```

**Response Example (Game End - Win):**

```json
{
  "blackjackNext": {
    "id": "bet_bj345",
    "active": false,
    "amount": 0.0001,
    "currency": "btc",
    "payoutMultiplier": 2.0,
    "payout": 0.0002,
    "user": {
      "name": "username"
    },
    "state": {
      "playerHands": [
        [
          {
            "rank": "K",
            "suit": "H"
          },
          {
            "rank": "7",
            "suit": "D"
          },
          {
            "rank": "3",
            "suit": "S"
          }
        ]
      ],
      "dealerHand": [
        {
          "rank": "9",
          "suit": "C"
        },
        {
          "rank": "K",
          "suit": "D"
        }
      ]
    }
  }
}
```

**Error Cases:**

- `existingGame` - User already has active blackjack game
- `insignificantBet` - Bet amount too small

---

## Active Bet Endpoints

These endpoints retrieve the current active bet for a user in specific games that support multi-round gameplay.

### Get Active HiLo Bet

**Endpoint:** `POST /_api/casino/active-bet/hilo`

**Request Body:**

```typescript
interface ActiveBetRequest {
  // Empty body
}
```

**Request Example:**

```json
{}
```

**Response Body:**

```typescript
interface ActiveBetResponse {
  user: {
    name: string;
    activeCasinoBet: HiloBetResponse | null;
  };
}
```

**Response Example:**

```json
{
  "user": {
    "name": "username",
    "activeCasinoBet": {
      "id": "bet_hilo123",
      "active": true,
      "amount": 0.003,
      "currency": "usdc",
      "payoutMultiplier": 1.25,
      "payout": 0.00375,
      "state": {
        "startCard": {
          "rank": "A",
          "suit": "H"
        },
        "rounds": [
          {
            "card": {
              "rank": "K",
              "suit": "D"
            },
            "guess": "higher",
            "payoutMultiplier": 1.25
          }
        ]
      }
    }
  }
}
```

### Get Active Mines Bet

**Endpoint:** `POST /_api/casino/active-bet/mines`

**Request Body:**

```typescript
interface ActiveBetRequest {
  // Empty body
}
```

**Request Example:**

```json
{}
```

**Response Body:**

```typescript
interface ActiveBetResponse {
  user: {
    name: string;
    activeCasinoBet: MinesBetResponse | null;
  };
}
```

**Response Example:**

```json
{
  "user": {
    "name": "username",
    "activeCasinoBet": {
      "id": "bet_mines456",
      "active": true,
      "amount": 0.001,
      "currency": "btc",
      "payoutMultiplier": 1.25,
      "payout": 0.00125,
      "state": {
        "minesCount": 3,
        "rounds": [
          {
            "field": 0,
            "payoutMultiplier": 1.1
          },
          {
            "field": 5,
            "payoutMultiplier": 1.25
          }
        ]
      }
    }
  }
}
```

### Get Active Blackjack Bet

**Endpoint:** `POST /_api/casino/active-bet/blackjack`

**Request Body:**

```typescript
interface ActiveBetRequest {
  // Empty body
}
```

**Request Example:**

```json
{}
```

**Response Body:**

```typescript
interface ActiveBetResponse {
  user: {
    name: string;
    activeCasinoBet: BlackjackBetResponse | null;
  };
}
```

**Response Example:**

```json
{
  "user": {
    "name": "username",
    "activeCasinoBet": {
      "id": "bet_bj345",
      "active": true,
      "amount": 0.0001,
      "currency": "btc",
      "payoutMultiplier": 1.0,
      "payout": 0.0001,
      "state": {
        "playerHands": [
          [
            {
              "rank": "K",
              "suit": "H"
            },
            {
              "rank": "7",
              "suit": "D"
            }
          ]
        ],
        "dealerHand": [
          {
            "rank": "9",
            "suit": "C"
          }
        ],
        "actions": ["BLACKJACK_HIT", "BLACKJACK_STAND", "BLACKJACK_DOUBLE"]
      }
    }
  }
}
```

**Notes:**

- Used to recover game state when `existingGame` error occurs
- Returns `null` for `activeCasinoBet` if no active game exists
- All three active-bet endpoints use POST method with empty body
- Same authentication headers required

---

## HTTP Method

All endpoints use **POST** method, even for retrieving active bets.

## Rate Limiting & Retry Logic

- Default retry delay: **1000ms**
- Dice and Limbo retry delay: **2000ms**
- On HTTP 401/403: Stop betting and run account/session repair unless the connector explicitly classifies the response as transient
- On other errors: Automatic retry if bot is still running
- All betting requests must be serialized per account; never run parallel casino actions for the same account/session

## Identifier Generation

Identifiers are random 21-character strings using charset: `_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-`

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

---

## Additional Notes

### Crash Game

While variables like `crash_bet_placed` and `crash_game_ran` exist in the codebase, **no REST API endpoints for Crash game were found** in the analyzed code. Crash may use WebSocket/GraphQL exclusively.

### Game State Management

- **HiLo, Mines, Blackjack**: Support multi-round gameplay with active state
- **Dice, Limbo, Keno, Baccarat**: Single-round games that complete immediately
- Active games can be recovered using `/_api/casino/active-bet/{game}` endpoints
- Before automated sessions start, active-state games must run recovery checks so a stale active game is resumed, cashed out, or explicitly abandoned by the user.
- Dice and Limbo should be the first productized betting endpoints because they complete in one request and prove the account connector, request bridge, and ledger path with the smallest state surface.

### Win/Loss Detection

- **Dice/Limbo**: Compare result values to targets
- **HiLo**: `payoutMultiplier >= 0.98` = win round
- **Mines**: `payoutMultiplier > 0` = safe tile
- **Blackjack**: `active: false` and `payoutMultiplier >= 1` = win

### Currency Support

Common currencies: `btc`, `eth`, `ltc`, `usdc`, `doge`, and others supported by Stake.

---

## Summary Table

| Game | Bet Endpoint | Next/Action Endpoint | Cashout Endpoint | Active Bet Endpoint |
|------|-------------|---------------------|------------------|---------------------|
| Dice | `/dice/roll` | - | - | - |
| Limbo | `/limbo/bet` | - | - | - |
| HiLo | `/hilo/bet` | `/hilo/next` | `/hilo/cashout` | `/active-bet/hilo` |
| Mines | `/mines/bet` | `/mines/next` | `/mines/cashout` | `/active-bet/mines` |
| Keno | `/keno/bet` | - | - | - |
| Baccarat | `/baccarat/bet` | - | - | - |
| Blackjack | `/blackjack/bet` | `/blackjack/next` | - | `/active-bet/blackjack` |

---

**Document Version:** 1.0
**Last Updated:** 2025-12-14
**Source:** bot2love extension (index.js) analysis
