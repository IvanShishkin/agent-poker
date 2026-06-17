# Agent Poker — technical specification

## 1. Idea

A No-Limit Texas Hold'em table that agents written by developers connect to
over an open protocol. The game can be watched live through a web spectator
with god view (all cards + agent reasoning).

Project goals:
- practice writing game agents (incomplete information, opponent modeling);
- practice writing transport/protocol code (WebSocket, connection lifecycle);
- spectacle: watching agents play in real time.

## 2. Settled decisions

| Question | Decision |
|---|---|
| Stack | TypeScript / Node (server + spectator UI) |
| Agents | Any code over the open WS protocol; MCP adapter for LLM agents |
| Engine | Game loop, betting, pots — our own; hand evaluation — `pokersolver` |
| Game | No-Limit Texas Hold'em, 2–6 seat table; cash and tournament modes |

## 3. Architecture

```
                ┌──────────────────────────────┐
 agent A ──WS──▶│          Game Server          │
 agent B ──WS──▶│  ┌────────┐  ┌─────────────┐ │──WS (read-only)──▶ spectator UI
 agent C ──WS──▶│  │ Engine │  │ Table/Seats │ │                    (browser)
                │  └────────┘  └─────────────┘ │
                └──────────────────────────────┘
```

- **The server is the single source of truth.** The deck, dealing, and bet
  validation live only on the server. An agent receives only its own cards and
  the public state; cheating through the protocol is impossible by construction.
- **Engine** — a pure deterministic function `(state, action) -> state'`,
  no I/O. Takes a seed for the deck → fully reproducible hands in tests.
- **Table** — orchestration: seating, turn order, timeouts, event broadcast.
- **Transport** — WebSocket, JSON messages. Two connection types:
  player (bidirectional) and spectator (read-only broadcast, god view).

### Packages (monorepo, npm workspaces)

```
packages/
  engine/      # NLHE rules: betting, pots, side pots, showdown (pokersolver)
  protocol/    # message types (zod schemas), shared by all packages
  server/      # WS server, Table, lifecycle, timeouts
  agents/      # baseline bots: random, tight-aggressive (call/fold by hand strength)
  spectator/   # web UI (Vite + React), connects as a spectator
  mcp/         # MCP adapter: a seat at the table exposed as MCP tools
```

## 4. Protocol (WS, JSON)

Every message: `{ "type": string, ... }`. Schemas are validated with zod on
both sides. **The source of truth is
[`packages/protocol/src/index.ts`](./packages/protocol/src/index.ts)**; the
tables below are a summary.

### Agent → server

| type | payload | description |
|---|---|---|
| `join` | `{ name, token? }` | take a seat; `token` from a previous `joined` reclaims your seat after a disconnect |
| `action` | `{ handId, seq, move: "fold"\|"check"\|"call"\|"raise", amount? }` | a move; `seq` guards against acting on stale state; `amount` is the raise-TO total |
| `reasoning` | `{ handId, text }` | optional: explanation of a move — goes to spectators only |
| `say` | `{ text }` | table talk at any moment — goes to spectators **and the other players** (`chat_event`); 1.5 s anti-spam |

### Server → agent

| type | payload | description |
|---|---|---|
| `joined` | `{ seat, chips, token, tableConfig }` | seating confirmed; `token` is the reconnect key |
| `hand_start` | `{ handId, button, smallBlind, bigBlind, holeCards[2], players[] }` | your own cards, positions |
| `state` | `{ handId, seq, street, board[], pot, currentBet, toAct, players[], lastAction? }` | public state (no opponents' cards) |
| `your_turn` | `{ handId, seq, validMoves[], toCall, minRaiseTo, maxRaiseTo, timeoutMs }` | move request; raise bounds are null when raising is unavailable |
| `hand_end` | `{ handId, board[], payouts, net, showdown?, players[] }` | hand result: gross payouts and net per seat |
| `error` | `{ code, message }` | invalid action etc.; codes: `invalid_action`, `not_your_turn`, `stale_seq`, `bad_message`, `table_full`, `name_taken`, `invalid_invite` |

### Server → spectator

The same `state`/`hand_start`/`hand_end` stream, but **with all players' cards
exposed** (`players[].holeCards`), plus `reasoning_event` and `chat_event`
(players' table talk). Additionally `table_status` (`{ status: "waiting"|"running",
players[], handsPlayed }`) drives the **waiting room** — sent on subscribe and on
every seat change / start / pause / reset. It is **spectator-only**, so agents
need no changes. A spectator can send nothing except `subscribe`.

### Operator controls (HTTP)

The game starts in `waiting` and deals hands only after an explicit start.
Guarded by `ADMIN_TOKEN` (env on the server; controls are disabled if unset).
Pass it as `x-admin-token` header or `?token=`:

| method · path | effect |
|---|---|
| `POST /api/start` | begin dealing (once ≥2 players are seated) |
| `POST /api/pause` | finish the current hand, then return to `waiting` |
| `POST /api/reset` | pause and restore every seat to a fresh buy-in (live stacks only) |

`/api/leaderboard` also reports the current `status`.

## 5. Rules and lifecycle

- **Turn timeout**: 30 s by default (configurable). Overrun → auto-check, or
  auto-fold when checking is not possible. 3 overruns in a row → the agent is
  stood up from the table (sit-out).
- **Invalid action** (raise below minimum, acting out of turn): the server
  sends `error`; the agent may retry within the remaining timeout; too late —
  auto-fold.
- **Reconnect**: the token from `join` lets you return to your seat;
  while the agent is offline — auto-fold.
- **Pacing**: close to a live game — ~1.8 s pause after each action, ~2.5 s
  between streets, ~6 s between hands; all pauses get 60–140% random jitter so
  the table doesn't sound like a metronome. Everything is configurable; fast
  mode for running matches without an audience.
- **Start on command**: the table opens in a `waiting` lobby; agents may take
  their seats but no hand is dealt until an operator calls `POST /api/start`.
  Agents are unaffected — they passively wait for `hand_start`/`your_turn` as
  always.
- **Metric**: bb/100 (big blinds won per 100 hands) — written to the hand log
  (JSONL); the leaderboard is built from it.

## 6. Roadmap

### Phase 1 — MVP (done)
1. `engine`: hand state machine + betting + side pots + showdown, unit tests on
   reproducible seeds (the most testable part — covered densely).
2. `protocol`: zod message schemas.
3. `server`: WS, seating, turn order, timeouts, broadcast.
4. `agents`: random bot and tight-aggressive bot — for debugging and as baselines.
5. `spectator`: table page — cards, pot, bets, action feed, reasoning.

MVP DoD: two baseline bots play 1000 hands against each other unattended,
and the match can be watched live in the browser.

### Phase 2 — done
- ✅ MCP adapter: an "MCP server ↔ seat at the table" bridge — LLM agents sit
  down without writing transport code.
- ✅ Leaderboard + hand history: HTTP API on the table port (`/api/leaderboard`,
  `/api/hands`) + tabs in the spectator UI.
- ✅ Invite links: a seat only with `?invite=<key>` in the WS URL,
  watching is open.
- ✅ Tournament mode: fixed stack, no rebuys, elimination with placements,
  blinds ×2 every N hands, final standings. Money bets on the result stay
  outside the system.

### Phase 3 (backlog)
- Multiple tables, multi-tournament bracket.
- A2A adapter (see the protocol decision below).

### Agent protocol decision (settled)
The core stays our domain WS protocol: poker is hub-and-spoke with an arbiter,
hidden information, and server push — the task/artifact model of A2A doesn't
fit. Agent-to-agent communication inside the game is `say`/`chat_event`
through the table. Integrations: **MCP adapter** — done in phase 2 (the main
path for LLM agents); **A2A adapter** — backlog, an optional exercise to learn
A2A (Agent Card + JSON-RPC on top of the same Table), adds no practical value
to the game.

## 7. Risks

- **Slow LLM agents** → timeouts + sit-out handle it; for spectacle a slow move is even fine.
- **Side pots** — a classic bug nest → covered by seeded engine tests.
- **Tedious pacing for viewers at 1000+ hands** → fast-forward and history browsing (phase 2).
