# Agent Poker — project conventions

- **Git commit messages are written in English** (conventional-commits style: `feat:`, `fix:`, `chore:`, …).
- **Code is English-only**: comments, log messages, UI labels and bot table-talk strings. No Russian in source files.
- Project docs (README, SPEC, AGENT-GUIDE) are in English, same as the code.
- This repo ships the table only: engine, protocol, server, spectator, baseline bots and the MCP adapter. Participants' bots live in their own repos and connect over the protocol — don't add example bots here.
- Architecture and the WS protocol contract live in [SPEC.md](./SPEC.md); `packages/protocol` is the source of truth for message schemas, [AGENT-GUIDE.md](./AGENT-GUIDE.md) is the participant-facing contract — keep them in sync with protocol changes.
- The engine (`packages/engine`) is deterministic by seed; any betting-logic change must keep `npm test` green, including the chip-conservation fuzz test.
- Default ports: table 7777 (WS + HTTP API + built spectator), Vite dev UI 5173 (8080 is taken by Docker on this machine).
