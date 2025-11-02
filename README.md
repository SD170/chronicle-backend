# Chronicle Backend - Supermemory Integration

A comprehensive backend system for managing player personas across multiple games, genres, and platforms using Supermemory API for persistent storage.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Data Models](#data-models)
- [API Endpoints](#api-endpoints)
- [Persona Scopes](#persona-scopes)
- [Trait Computation](#trait-computation)
- [Setup & Configuration](#setup--configuration)
- [Usage Examples](#usage-examples)
- [Testing](#testing)

## Overview

This system captures player gameplay data, computes personality traits, and stores them as personas in Supermemory. Personas are maintained at multiple scopes:

- **Global**: Across all games
- **Game**: Specific to a game
- **Genre**: Across games in the same genre
- **Platform**: Across games on the same platform

Traits are automatically blended when new gameplay data is received, creating evolving player profiles.

## Architecture

```
Game Client
    ↓ (POST /sm/save)
Express Server (server.ts)
    ↓
SupermemoryStore (memory/SupermemoryStore.ts)
    ↓
traitEngine (traitEngine.ts)
    ↓
Supermemory API (v3)
    ↓
Persona Documents
```

### Key Components

1. **server.ts**: Express server with API routes
2. **SupermemoryStore.ts**: Handles all Supermemory API interactions
3. **traitEngine.ts**: Computes traits from gameplay stats
4. **types.ts**: Zod schemas and TypeScript types

## Data Models

### ServerInput

The primary input format sent from game clients to the backend. This represents a complete gameplay run/session.

**Purpose:** Captures all gameplay data needed to compute player traits and update personas across different scopes (global, game, genre, platform).

**When to send:** After each completed gameplay run or session.

```typescript
type ServerInput = {
  // Metadata
  schema_version: string;              // Version of the schema (e.g., "1.0")
  player_id: string;                   // Unique player identifier
  session_id: string;                  // Groups runs in one play session
  run_index: number;                   // Sequential run number (1, 2, 3...)
  completed_at: string;                // ISO 8601 timestamp when run completed

  // Game Context
  game_context?: {
    game_id?: string;                  // Canonical game identifier
    game_title?: string;               // Human-readable game name
    genre_ids?: string[];              // Array of genre identifiers
    platform_ids?: string[];           // Array of platform identifiers
    build_version?: string;            // Game build version
  };

  // Run Outcome
  run_outcome: {
    result: "win" | "loss";            // Run result
    path: "combat" | "puzzle" | "exploration";  // Primary playstyle path
  };

  // Gameplay Statistics
  stats: {
    time_s: number;                    // Total time in seconds
    deaths: number;                    // Number of deaths
    retries: number;                   // Number of retries
    distance_traveled: number;         // Distance traveled (units)
    jumps: number;                     // Number of jumps
    hint_offers: number;               // Number of hints offered
    hints_used: number;                // Number of hints actually used
    riddles_attempted: number;         // Total riddles attempted
    riddles_correct: number;           // Number of riddles solved correctly
    combats_initiated: number;         // Number of combat encounters started
    combats_won: number;               // Number of combats won
    collectibles_found: number;        // Number of collectibles collected
  };

  // Configuration
  config_used: {
    mode: "fun" | "challenge";         // Game mode
    knobs: {
      enemy_count: number;
      enemy_speed: number;
      puzzle_gate_ratio: number;
      collectible_density: number;
      hint_delay_ms: number;
      breadcrumb_brightness: number;
    };
    layout_seed: string;               // Random seed for level generation
  };

  // Optional fields
  events_digest?: Array<{              // Event frequency summary
    type: string;                      // Event type identifier (e.g., "combat.start")
    count: number;                     // Number of times this event occurred
  }>;
  performance_summary?: unknown;        // Additional performance metrics (future use)
};
```

**Field Descriptions:**

- **`schema_version`**: Version of the data schema. Currently `"1.0"`. Used for future schema migrations.
- **`player_id`**: Unique identifier for the player. Used to group all personas for a single player.
- **`session_id`**: Groups multiple runs that occur in the same play session. Can be any unique string per session.
- **`run_index`**: Sequential number of this run (1, 2, 3...). Used for ordering runs and tracking progress.
- **`completed_at`**: ISO 8601 timestamp when the run completed. Used for chronological ordering.

**Game Context:**
- **`game_id`**: Identifier for the game being played. Enables game-specific personas.
- **`genre_ids`**: Array of genre identifiers. Only the **first** genre is used for persona creation.
- **`platform_ids`**: Array of platform identifiers. Only the **first** platform is used for persona creation.
- **`game_title`**: Human-readable game name (optional, for display purposes).
- **`build_version`**: Game build version (optional, for tracking).

**Run Outcome:**
- **`result`**: Whether the player won (`"win"`) or lost (`"loss"`).
- **`path`**: Primary playstyle path taken: `"combat"`, `"puzzle"`, or `"exploration"`.

**Stats (All Required):**
These numbers feed directly into trait computation. All must be provided (use `0` if not applicable):
- **`time_s`**: Total time in seconds (used for goal_focus and resilience).
- **`deaths`**: Number of deaths (lowers stealth, affects resilience).
- **`retries`**: Number of retries (affects resilience and goal_focus).
- **`distance_traveled`**: Distance covered (used for curiosity computation).
- **`jumps`**: Number of jumps (optional metric, currently not used in trait computation).
- **`mashing_intensity`**: Button mashing speed/intensity (0.0-1.0, optional). Higher values indicate faster, more intense button pressing. Affects `aggression` and `goal_focus` traits.
- **`hint_offers`**: Number of hints offered to player (used with hints_used for independence).
- **`hints_used`**: Number of hints actually used (lowers independence trait).
- **`riddles_attempted`**: Total riddles encountered (used for puzzle_affinity).
- **`riddles_correct`**: Riddles solved correctly (primary input for puzzle_affinity).
- **`combats_initiated`**: Combat encounters started (primary input for aggression).
- **`combats_won`**: Combats won (contributes to aggression, affects resilience).
- **`collectibles_found`**: Collectibles collected (primary input for curiosity).

**Configuration:**
- **`mode`**: Game difficulty mode (`"fun"` or `"challenge"`).
- **`knobs`**: Game configuration parameters (currently stored but not used in trait computation).
- **`layout_seed`**: Random seed for level generation (used for reproducibility).

**Example with Real Data:**
```json
{
  "schema_version": "1.0",
  "player_id": "user_1234",
  "session_id": "sess_abc123",
  "run_index": 3,
  "completed_at": "2025-11-01T19:13:00Z",
  "game_context": {
    "game_id": "skyline_runner",
    "game_title": "Skyline Runner",
    "genre_ids": ["platformer", "action"],
    "platform_ids": ["pc"],
    "build_version": "v1.2.0"
  },
  "run_outcome": {
    "result": "win",
    "path": "combat"
  },
  "stats": {
    "time_s": 215,
    "deaths": 2,
    "retries": 2,
    "distance_traveled": 610,
    "jumps": 21,
    "hint_offers": 2,
    "hints_used": 0,
    "riddles_attempted": 3,
    "riddles_correct": 2,
    "combats_initiated": 8,
    "combats_won": 6,
    "collectibles_found": 5
  },
  "config_used": {
    "mode": "challenge",
    "knobs": {
      "enemy_count": 3,
      "enemy_speed": 1.3,
      "puzzle_gate_ratio": 0.4,
      "collectible_density": 0.25,
      "hint_delay_ms": 12000,
      "breadcrumb_brightness": 0.35
    },
    "layout_seed": "seed_6d83da"
  },
  "events_digest": [
    { "type": "combat.start", "count": 8 },
    { "type": "combat.win", "count": 6 },
    { "type": "death", "count": 2 },
    { "type": "fail.retry", "count": 2 }
  ]
}
```

### Stats

Core gameplay statistics used for trait computation.

```typescript
type Stats = {
  time_s: number;                      // Time spent in seconds (required)
  deaths: number;                      // Death count (required)
  retries: number;                     // Retry count (required)
  distance_traveled: number;           // Distance traveled (required)
  jumps: number;                       // Jump count (required)
  hint_offers: number;                 // Hints offered (required)
  hints_used: number;                  // Hints used (required)
  riddles_attempted: number;           // Riddles attempted (required)
  riddles_correct: number;             // Riddles solved correctly (required)
  combats_initiated: number;           // Combats started (required)
  combats_won: number;                 // Combats won (required)
  collectibles_found: number;          // Collectibles found (required)
  mashing_intensity?: number;          // Button mashing speed (0.0-1.0, optional)
};
```

### Traits

Normalized personality traits (0.0 to 1.0) computed from gameplay stats.

```typescript
type Traits = {
  aggression: number;                  // Combat preference (0.0-1.0)
  stealth: number;                     // Avoidance preference (0.0-1.0)
  curiosity: number;                   // Exploration tendency (0.0-1.0)
  puzzle_affinity: number;             // Puzzle-solving preference (0.0-1.0)
  independence: number;                // Hint usage aversion (0.0-1.0)
  resilience: number;                  // Failure recovery (0.0-1.0)
  goal_focus: number;                  // Completion efficiency (0.0-1.0)
};
```

### PersonaSnapshot

Complete persona representation stored in Supermemory.

```typescript
type PersonaSnapshot = {
  player_id: string;                   // Player identifier
  traits: Traits;                      // Computed traits
  persona_text: string;                // Human-readable description (1-3 sentences)
  top_signals: string[];               // Top 3 gameplay signals (e.g., "Solved 5 riddle(s)")
  updated_at: string;                  // ISO 8601 timestamp of last update
};
```

### API Response Types

#### Save Response

```typescript
type SaveResponse = {
  user_node: string;                   // User node identifier
  memories_created: number;            // Total number of trait memories created
  batch_result: {
    results: Array<{
      id: string;                      // Supermemory document ID
      status: "queued" | "done" | "failed";
    }>;
    failed: number;
    success: number;
  };
  trait_explanations: string[];        // Array of explanations showing how stats affected each trait
  // Example: [
  //   "Aggression: increased from 0.50 to 0.42. Affected by: Started 1 combat(s), won 1 combat(s).",
  //   "Curiosity: decreased from 0.50 to 0.31. Affected by: traveled 300 units.",
  //   "Goal Focus: increased from 0.50 to 0.59. Affected by: fast completion (143s), no retries needed.",
  //   ...
  // ]
  // Each explanation shows: trait name, change direction, previous value, new value, and contributing stats
};
```

#### Fetch Response

```typescript
type FetchResponse = {
  total: number;                       // Total matching documents
  items: Array<{
    id: string;                        // Supermemory document ID
    metadata: {
      type: "persona";
      persona_scope: "global" | "game" | "genre" | "platform";
      player_id: string;
      updated_at: string;
      run_index: number;               // Latest run index
      run_result: "win" | "loss";
      run_path: "combat" | "puzzle" | "exploration";
      game_id?: string;
      genre_id?: string;
      platform_id?: string;
      completed_at: string;
      build_version?: string;
      game_title?: string;
    };
    persona: PersonaSnapshot | null;   // null if includeContent=false
  }>;
};
```

## API Endpoints

### GET /health

Health check endpoint to verify the server is running.

**Request:**
```http
GET /health
```

**Response:** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2025-11-02T11:01:52.855Z"
}
```

### POST /sm/save

Saves gameplay data and updates/creates personas.

**Request:**
```http
POST /sm/save
Content-Type: application/json

{
  "serverInput": ServerInput
}
```

**Request Body:**

The `serverInput` field must contain a complete `ServerInput` object. See [Data Models - ServerInput](#serverinput) section for full structure.

**Minimal Example:**
```json
{
  "serverInput": {
    "schema_version": "1.0",
    "player_id": "player_123",
    "session_id": "sess_abc",
    "run_index": 1,
    "completed_at": "2025-11-02T10:00:00.000Z",
    "game_context": {
      "game_id": "test_game",
      "genre_ids": ["platformer"],
      "platform_ids": ["pc"]
    },
    "run_outcome": {
      "result": "win",
      "path": "combat"
    },
    "stats": {
      "time_s": 900,
      "deaths": 0,
      "retries": 0,
      "distance_traveled": 100,
      "jumps": 10,
      "hint_offers": 0,
      "hints_used": 0,
      "riddles_attempted": 1,
      "riddles_correct": 1,
      "combats_initiated": 5,
      "combats_won": 5,
      "collectibles_found": 3
    },
    "config_used": {
      "mode": "challenge",
      "knobs": {
        "enemy_count": 3,
        "enemy_speed": 1.0,
        "puzzle_gate_ratio": 0.5,
        "collectible_density": 0.3,
        "hint_delay_ms": 10000,
        "breadcrumb_brightness": 0.5
      },
      "layout_seed": "seed_123"
    }
  }
}
```

**Key Points:**
- `game_context` is optional but recommended. If provided, it enables game/genre/platform-specific personas.
- Only the **first** genre from `genre_ids` array and **first** platform from `platform_ids` array are used.
- All fields in `stats` are required and must be numbers (can be 0).
- The system will automatically:
  - Fetch existing personas for trait blending
  - Create/update personas for: global, game, genre (first only), platform (first only)
  - Compute traits from stats using the trait engine
  - Store personas in Supermemory with proper metadata and container tags

**Response:** `200 OK`
```json
{
  "global": {
    "results": [{"id": "doc_id_1", "status": "queued"}],
    "failed": 0,
    "success": 1
  },
  "game": {
    "results": [{"id": "doc_id_2", "status": "queued"}],
    "failed": 0,
    "success": 1
  },
  "genres": [
    {
      "results": [{"id": "doc_id_3", "status": "queued"}],
      "failed": 0,
      "success": 1
    }
  ],
  "platforms": [
    {
      "results": [{"id": "doc_id_4", "status": "queued"}],
      "failed": 0,
      "success": 1
    }
  ]
}
```

**Behavior:**
- Creates/updates 4 personas: global, game, genre (first only), platform (first only)
- Fetches existing personas and blends traits (60% previous, 40% new)
- If no existing persona, creates new one with computed traits

**Error Responses:**
- `400 Bad Request`: Missing `serverInput` in body
- `502 Bad Gateway`: Supermemory API error

### GET /sm/personas

Fetches personas with optional filtering.

**Request:**
```http
GET /sm/personas?player_id=<id>&scope=<scope>&game_id=<id>&genre_id=<id>&platform_id=<id>&limit=<n>
```

**Query Parameters:**
- `player_id` (required): Player identifier
- `scope` (optional): `"global" | "game" | "genre" | "platform" | "any"` (default: `"any"`)
- `game_id` (optional): Filter by game ID
- `genre_id` (optional): Filter by genre ID
- `platform_id` (optional): Filter by platform ID
- `limit` (optional): Maximum results (default: 10)

**Response:** `200 OK`
```json
{
  "total": 4,
  "items": [
    {
      "id": "doc_id_1",
      "metadata": {
        "type": "persona",
        "persona_scope": "global",
        "player_id": "player_123",
        "updated_at": "2025-11-02T10:00:00.000Z",
        "run_index": 3,
        "run_result": "win",
        "run_path": "combat",
        "game_id": "test_game",
        "completed_at": "2025-11-02T10:00:00.000Z"
      },
      "persona": {
        "player_id": "player_123",
        "traits": {
          "aggression": 0.85,
          "stealth": 0.3,
          "curiosity": 0.6,
          "puzzle_affinity": 0.4,
          "independence": 0.9,
          "resilience": 0.7,
          "goal_focus": 0.8
        },
        "persona_text": "Shows combat-inclined, exploration-oriented; goal focus 80%.",
        "top_signals": [
          "Solved 5 riddle(s)",
          "Started 10 combat(s), won 10",
          "Found 12 collectible(s)"
        ],
        "updated_at": "2025-11-02T10:00:00.000Z"
      }
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request`: Missing `player_id`
- `502 Bad Gateway`: Supermemory API error

**Note:** Results may be empty immediately after save due to Supermemory indexing delays (10-15 seconds). The client should implement retry logic.

### GET /sm/doc/:id

Fetches a specific document by ID.

**Request:**
```http
GET /sm/doc/{document_id}
```

**Response:** `200 OK`
```json
{
  "id": "doc_id_1",
  "content": "# Persona Snapshot\n\n**Player:** player_123\n...",
  "metadata": {
    "type": "persona",
    "persona_scope": "global",
    "player_id": "player_123",
    ...
  },
  "containerTags": ["persona_global_player_123"],
  "status": "done",
  "createdAt": "2025-11-02T10:00:00.000Z",
  "updatedAt": "2025-11-02T10:00:00.000Z"
}
```

**Error Responses:**
- `502 Bad Gateway`: Supermemory API error or document not found

## Persona Scopes

### Global Scope

Applies across all games. Updated with every run.

- **Container Tag**: `persona_global_{player_id}`
- **Metadata**: `persona_scope: "global"`

### Game Scope

Specific to a single game. Updated only when runs are for that game.

- **Container Tag**: `persona_game_{game_id}_player_{player_id}`
- **Metadata**: `persona_scope: "game"`, `game_id: {game_id}`

### Genre Scope

Applies across games in the same genre. Only the first genre from `genre_ids` array is used.

- **Container Tag**: `persona_genre_{genre_id}_player_{player_id}`
- **Metadata**: `persona_scope: "genre"`, `genre_id: {genre_id}`

### Platform Scope

Applies across games on the same platform. Only the first platform from `platform_ids` array is used.

- **Container Tag**: `persona_platform_{platform_id}_player_{player_id}`
- **Metadata**: `persona_scope: "platform"`, `platform_id: {platform_id}`

## Trait Computation

Traits are computed from `Stats` using weighted formulas, then normalized to 0.0-1.0 range.

### Attribute Mapping

Each trait is calculated from specific gameplay attributes:

| Trait | Attributes Used | Description |
|-------|----------------|-------------|
| **Aggression** | `combats_initiated`, `combats_won`, `mashing_intensity` | Measures combat preference. Higher if player starts and wins more combats, or shows high button mashing intensity. |
| **Stealth** | `combats_initiated`, `deaths` | Measures avoidance preference. Lower if player engages in combat or dies. |
| **Curiosity** | `collectibles_found`, `distance_traveled` | Measures exploration tendency. Higher if player finds collectibles and travels more. |
| **Puzzle Affinity** | `riddles_correct`, `riddles_attempted` | Measures puzzle-solving preference. Higher if player solves more riddles correctly. |
| **Independence** | `hints_used`, `hint_offers` | Measures hint usage aversion. Perfect score (1.0) if hints offered but none used. Lower if player uses hints. |
| **Resilience** | `retries`, `deaths`, `time_s` | Measures failure recovery. Higher if player retries after failure. Lower if they complete too quickly (might indicate avoiding challenges). |
| **Goal Focus** | `time_s`, `retries`, `mashing_intensity` | Measures completion efficiency. Higher if player completes quickly, without retries, or shows high button mashing intensity (indicating focused effort). |

**Note:** The `jumps` attribute is currently not used in any trait calculation.

**Mashing Intensity:** Button mashing speed (0.0-1.0) affects `aggression` and `goal_focus`. High mashing intensity (>.5) indicates aggressive, focused gameplay and adds a bonus to both traits.

### Trait Formulas

```typescript
// Aggression: Combat preference
// Attributes: combats_initiated (weight: 1.0), combats_won (weight: 0.5), mashing_intensity (bonus: up to 0.3)
// Mashing intensity adds up to 0.3 bonus (min(mashing_intensity, 1) * 0.3)
aggression = (combats_initiated * 1.0 + combats_won * 0.5 + mashing_bonus) / 5

// Stealth: Avoidance preference
// Attributes: combats_initiated (penalty: -0.6 if > 0), deaths (penalty: -0.2 if > 0)
stealth = 1 - (combats_initiated > 0 ? 0.6 : 0) - (deaths > 0 ? 0.2 : 0)

// Curiosity: Exploration tendency
// Attributes: collectibles_found (weight: 0.7), distance_traveled (weight: 0.3, normalized by 500)
curiosity = (collectibles_found * 0.7 + min(distance_traveled/500, 1) * 0.3) / 5

// Puzzle Affinity: Puzzle-solving preference
// Attributes: riddles_correct (weight: 1.0), riddles_attempted (partial credit: 0.2 per wrong)
puzzle_affinity = (riddles_correct * 1.0 + (riddles_attempted - riddles_correct) * 0.2) / 3

// Independence: Hint usage aversion
// Attributes: hints_used (penalty: -0.5 per hint), hint_offers (checks if > 0)
// Perfect score (1.0) if hints offered but none used
independence = (hint_offers > 0 && hints_used === 0) ? 1 : max(0, 1 - hints_used * 0.5)

// Resilience: Failure recovery
// Attributes: retries (weight: +0.8), deaths (weight: +0.4), time_s (penalty: -0.2, normalized by 600s)
// Note: Very fast completion (< 600s) reduces resilience (might indicate avoiding challenges)
resilience = (retries * 0.8 + deaths * 0.4 - min(time_s/600, 1) * 0.2) / 3

// Goal Focus: Completion efficiency
// Attributes: time_s (bonus if < 180s, penalty if > 180s), retries (bonus: +0.2 if 0), mashing_intensity (bonus: up to 0.3)
// Mashing intensity adds up to 0.3 bonus (min(mashing_intensity, 1) * 0.3) indicating focused effort
goal_focus = (time_s < 180 ? 1 : max(0, 1 - (time_s-180)/300)) + (retries === 0 ? 0.2 : 0) + mashing_bonus
goal_focus = goal_focus / 1.4
```

### Calculation Examples

**Example 1: Aggression**
- Player starts 3 combats, wins 2
- Raw: (3 × 1.0 + 2 × 0.5) = 4.0
- Normalized: 4.0 / 5 = 0.80

**Example 2: Independence**
- Hints offered: 2, Hints used: 1
- Calculation: max(0, 1 - 1 × 0.5) = 0.5
- If hints offered but none used → 1.0 (perfect independence)

**Example 3: Goal Focus**
- Completion time: 75s, Retries: 0
- Raw: (1.0 + 0.2) = 1.2
- Normalized: 1.2 / 1.4 = 0.86

### Trait Blending

When updating an existing persona, traits are blended with previous values:

```typescript
blended_trait = 0.6 * previous_trait + 0.4 * new_trait
```

This creates a weighted average that preserves history (60%) while incorporating new behavior (40%). Traits evolve gradually over time.

**First Save:** If no previous persona exists, the system blends with default traits (all 0.5) instead of using raw values. This ensures consistent behavior from the first game session.

### Persona Text Generation

Human-readable description based on trait thresholds:

- `puzzle_affinity > 0.6` → "puzzle-leaning"
- `curiosity > 0.6` → "exploration-oriented"
- `aggression > 0.5` → "combat-inclined"
- `independence > 0.6` → "rarely uses hints"
- `resilience > 0.6` → "bounces back after failures"
- Default → "balanced playstyle"

Includes goal focus percentage: `"goal focus {Math.round(goal_focus * 100)}%"`

### Top Signals

Top 3 gameplay signals extracted from stats:

- `"Solved {riddles_correct} riddle(s)"` (if riddles_correct > 0)
- `"Started {combats_initiated} combat(s), won {combats_won}"` (if combats_initiated > 0)
- `"Found {collectibles_found} collectible(s)"` (if collectibles_found > 0)
- `"Used {hints_used} hint(s)"` (if hints_used > 0)
- `"Retried {retries} time(s)"` (if retries > 0)

## Setup & Configuration

### Environment Variables

Create a `.env` file:

```bash
# MongoDB (currently optional, not used for personas)
MONGO_URI=mongodb://localhost:27017

# Supermemory API
SUPERMEMORY_BASE_URL=https://api.supermemory.ai
SUPERMEMORY_API_KEY=your_api_key_here

# Game Configuration
GAME_ID=default_game_id  # Optional, can be overridden in requests

# API Keys (comma-separated list for authenticating requests)
# Generate a key: npm run generate:api-key
API_KEYS=chk_your_api_key_here,chk_another_key_here
```

### API Key Authentication

All API endpoints (except `/health`) require API key authentication.

**Generate an API Key:**
```bash
npm run generate:api-key
```

This will output a secure API key. Add it to your `.env` file:
```bash
API_KEYS=chk_generated_key_here
```

**Multiple API Keys:**
You can add multiple keys (comma-separated) for different clients:
```bash
API_KEYS=chk_key1,chk_key2,chk_key3
```

**Using API Keys in Requests:**
Provide the API key in one of these ways:
- `X-API-Key` header (preferred)
- `Authorization: Bearer <key>` header

Example:
```bash
curl -X GET http://localhost:7769/sm/personas?player_id=user1 \
  -H "X-API-Key: chk_your_api_key_here"
```

Or:
```bash
curl -X GET http://localhost:7769/sm/personas?player_id=user1 \
  -H "Authorization: Bearer chk_your_api_key_here"
```

### Installation

```bash
npm install
```

### Running the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

Server runs on `http://localhost:7769` by default.

### Dependencies

- **express**: Web server framework
- **tsx**: TypeScript execution
- **zod**: Schema validation
- **dotenv**: Environment variable management
- **supermemory**: Supermemory SDK (optional, currently using direct API calls)

## Usage Examples

### Example 1: Save Run Data

```bash
curl -X POST http://localhost:7769/sm/save \
  -H "Content-Type: application/json" \
  -H "X-API-Key: chk_your_api_key_here" \
  -d '{
    "serverInput": {
      "schema_version": "1.0",
      "player_id": "player_123",
      "session_id": "sess_abc",
      "run_index": 1,
      "completed_at": "2025-11-02T10:00:00.000Z",
      "game_context": {
        "game_id": "skyline_runner",
        "genre_ids": ["platformer"],
        "platform_ids": ["pc"]
      },
      "run_outcome": {
        "result": "win",
        "path": "combat"
      },
      "stats": {
        "time_s": 900,
        "deaths": 0,
        "retries": 0,
        "distance_traveled": 500,
        "jumps": 20,
        "hint_offers": 0,
        "hints_used": 0,
        "riddles_attempted": 2,
        "riddles_correct": 2,
        "combats_initiated": 5,
        "combats_won": 5,
        "collectibles_found": 3
      },
      "config_used": {
        "mode": "challenge",
        "knobs": {
          "enemy_count": 3,
          "enemy_speed": 1.0,
          "puzzle_gate_ratio": 0.5,
          "collectible_density": 0.3,
          "hint_delay_ms": 10000,
          "breadcrumb_brightness": 0.5
        },
        "layout_seed": "seed_123"
      }
    }
  }'
```

### Example 2: Fetch All Personas

```bash
curl -X GET "http://localhost:7769/sm/personas?player_id=player_123" \
  -H "X-API-Key: chk_your_api_key_here"
```

### Example 2b: Fetch with Filters

```bash
curl -X GET "http://localhost:7769/sm/personas?player_id=player_123&limit=10" \
  -H "X-API-Key: chk_your_api_key_here"
```

### Example 3: Fetch Global Persona Only

```bash
curl -X GET "http://localhost:7769/sm/personas?player_id=player_123&scope=global&limit=1" \
  -H "X-API-Key: chk_your_api_key_here"
```

### Example 4: Fetch Platform Persona

```bash
curl -X GET "http://localhost:7769/sm/personas?player_id=player_123&scope=platform&platform_id=pc&limit=1" \
  -H "X-API-Key: chk_your_api_key_here"
```

### Example 5: Fetch Game Persona

```bash
curl -X GET "http://localhost:7769/sm/personas?player_id=player_123&scope=game&game_id=skyline_runner&limit=1" \
  -H "X-API-Key: chk_your_api_key_here"
```

### Example 6: Fetch Document by ID

```bash
curl -X GET "http://localhost:7769/sm/doc/doc_id_here" \
  -H "X-API-Key: chk_your_api_key_here"
```

## Testing

### Using the Test Script

The `supermemory.test.ts` script provides CLI commands for testing.

**Save data:**
```bash
npm run test:supermemory -- save --player user_test --game test_game --genres platformer --platforms pc
```

**Fetch all:**
```bash
npm run test:supermemory fetch user_test 10
```

**Fetch filtered:**
```bash
npm run test:supermemory -- fetch --player user_test --scope platform --platform pc --limit 5
```

**Fetch by document ID:**
```bash
npm run test:supermemory doc <document_id>
```

**Full workflow test:**
```bash
npm run test:supermemory test-workflow user_test
```

See `TEST_COMMANDS.txt` for comprehensive examples.

### Important Notes

1. **Indexing Delays**: Supermemory may take 10-15 seconds to index new documents. The fetch command includes automatic retry logic.

2. **Single Genre/Platform**: Only the first genre and first platform from arrays are used when creating personas.

3. **Trait Blending**: Traits are automatically blended (60% previous, 40% new) when updating existing personas.

4. **npm Script Arguments**: When using named arguments with npm scripts, use `--` separator:
   ```bash
   npm run test:supermemory -- fetch --player <id> --scope <scope>
   ```

## Supermemory API Integration

### Document Structure

Personas are stored as markdown documents in Supermemory with the following structure:

```markdown
# Persona Snapshot

**Player:** {player_id}
**Game:** {game_id} (or **Scope:** Global)
**Updated At:** {iso_timestamp}

## Traits
- Aggression: {0.0-1.0}
- Stealth: {0.0-1.0}
- Curiosity: {0.0-1.0}
- Puzzle Affinity: {0.0-1.0}
- Independence: {0.0-1.0}
- Resilience: {0.0-1.0}
- Goal Focus: {0.0-1.0}

## Persona Text
{human_readable_description}

## Top Signals
- {signal_1}
- {signal_2}
- {signal_3}

## Full Persona JSON
```json
{
  "player_id": "...",
  "traits": {...},
  "persona_text": "...",
  "top_signals": [...],
  "updated_at": "..."
}
```
```

### Metadata

Each document includes metadata:

```json
{
  "type": "persona",
  "persona_scope": "global" | "game" | "genre" | "platform",
  "player_id": "...",
  "updated_at": "ISO_timestamp",
  "run_index": number,
  "run_result": "win" | "loss",
  "run_path": "combat" | "puzzle" | "exploration",
  "game_id": "...",        // optional
  "genre_id": "...",       // optional
  "platform_id": "...",    // optional
  "completed_at": "ISO_timestamp",
  "build_version": "...",  // optional
  "game_title": "..."      // optional
}
```

### Container Tags

Documents are organized using container tags:
- Global: `persona_global_{player_id}`
- Game: `persona_game_{game_id}_player_{player_id}`
- Genre: `persona_genre_{genre_id}_player_{player_id}`
- Platform: `persona_platform_{platform_id}_player_{player_id}`

## Error Handling

### Common Errors

**400 Bad Request**
- Missing required fields
- Invalid data types

**502 Bad Gateway**
- Supermemory API errors
- Network issues
- Document not found (for GET /sm/doc/:id)

**Indexing Delays**
- New documents may not appear immediately
- Implement retry logic with exponential backoff
- Wait 10-15 seconds after save before fetch

### Retry Logic

The fetch endpoint includes automatic retry:
- 3 retries with increasing delays (3s, 5s, 7s)
- Total possible wait: ~15 seconds
- Only retries on 0 results or server errors (404, 500)

## License

ISC

