/**
 * MCP adapter: exposes a seat at the poker table as MCP tools, so any LLM agent
 * (Claude Code, Claude Desktop, …) can play without writing transport code.
 *
 *   claude mcp add poker -- npx tsx packages/mcp/src/server.ts
 *
 * Env: URL (default ws://localhost:7777), NAME (default LLM-Agent).
 * stdout is reserved for the MCP protocol — all logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { TableClient } from './table-client.js'

const url = process.env.URL ?? 'ws://localhost:7777'
const name = process.env.NAME ?? 'LLM-Agent'

const client = new TableClient(url, name)
client.connect()

const server = new McpServer({ name: 'agent-poker', version: '0.1.0' })

function snapshot() {
  const turn = client.currentTurn
  return {
    connected: client.connected,
    you: client.joined
      ? {
          seat: client.joined.seat,
          name,
          holeCards: client.holeCards,
          chips: client.lastState?.players.find((p) => p.seat === client.joined!.seat)?.chips,
        }
      : 'not seated yet',
    table: client.lastState
      ? {
          handId: client.lastState.handId,
          street: client.lastState.street,
          board: client.lastState.board,
          pot: client.lastState.pot,
          currentBet: client.lastState.currentBet,
          toAct: client.lastState.toAct,
          players: client.lastState.players,
        }
      : 'no hand in progress yet',
    yourTurn: turn
      ? {
          validMoves: turn.validMoves,
          toCall: turn.toCall,
          minRaiseTo: turn.minRaiseTo,
          maxRaiseTo: turn.maxRaiseTo,
          msLeftToAct: Math.max(0, turn.timeoutMs - (Date.now() - turn.receivedAt)),
        }
      : null,
    recentEvents: client.events.slice(-15),
  }
}

const asText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })

server.registerTool(
  'get_table_state',
  {
    description:
      'Current poker table state: your hole cards, board, pot, players, whether it is your turn ' +
      '(with valid moves and raise bounds), and recent events (hand results, table talk).',
  },
  async () => asText(snapshot()),
)

server.registerTool(
  'wait_for_turn',
  {
    description:
      'Block until it is your turn to act (or the timeout passes), then return the table state. ' +
      'Call this in a loop to play. If yourTurn is null after waiting, just call it again.',
    inputSchema: { maxWaitSec: z.number().min(1).max(55).default(25).describe('How long to wait, seconds') },
  },
  async ({ maxWaitSec }) => {
    await client.waitForTurn(maxWaitSec * 1000)
    return asText(snapshot())
  },
)

server.registerTool(
  'act',
  {
    description:
      'Make your move when it is your turn. For raise, amount is the total you raise TO on this street ' +
      '(respect minRaiseTo/maxRaiseTo from the state). Optional reasoning is shown to spectators — ' +
      'explain your thinking, it is the fun part.',
    inputSchema: {
      move: z.enum(['fold', 'check', 'call', 'raise']),
      amount: z.number().int().positive().optional().describe('Raise-to total; required for raise'),
      reasoning: z.string().max(500).optional().describe('Why you are doing this (visible to spectators)'),
    },
  },
  async ({ move, amount, reasoning }) => {
    const result = await client.act(move, amount, reasoning)
    return asText({ result, ...snapshot() })
  },
)

server.registerTool(
  'say',
  {
    description:
      'Table talk: a free-form remark visible to spectators AND other players. ' +
      'Use it to banter, tilt opponents or react to hands. Rate-limited to one message per 1.5s.',
    inputSchema: { text: z.string().min(1).max(200) },
  },
  async ({ text }) => {
    client.say(text)
    return asText({ result: 'said' })
  },
)

await server.connect(new StdioServerTransport())
console.error(`[mcp-bridge] ready: table ${url}, playing as "${name}"`)
