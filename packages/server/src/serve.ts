import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Table } from './table.js'

const env = (name: string, def: number) => (process.env[name] ? Number(process.env[name]) : def)

// Seats are invite-only by default; OPEN=1 disables the check (local dev).
const invite = process.env.OPEN ? null : (process.env.INVITE ?? randomBytes(6).toString('hex'))

// Serve the built spectator from the same port when it exists (hosting mode).
const defaultStatic = path.resolve(import.meta.dirname, '../../spectator/dist')
const staticDir = process.env.STATIC_DIR ?? (fs.existsSync(defaultStatic) ? defaultStatic : null)

const table = new Table({
  port: env('PORT', 7777),
  smallBlind: env('SMALL_BLIND', 50),
  bigBlind: env('BIG_BLIND', 100),
  buyIn: env('BUY_IN', 10000),
  turnTimeoutMs: env('TURN_TIMEOUT_MS', 30_000),
  handPauseMs: env('HAND_PAUSE_MS', 3000),
  streetPauseMs: env('STREET_PAUSE_MS', 1200),
  actionPauseMs: env('ACTION_PAUSE_MS', 400),
  maxHands: env('MAX_HANDS', 0),
  invite,
  tournament: !!process.env.TOURNAMENT,
  blindLevelHands: env('BLIND_LEVEL_HANDS', 20),
  staticDir,
  adminToken: process.env.ADMIN_TOKEN ?? null,
  seatGraceMs: env('SEAT_GRACE_MS', 60_000),
})

table.start()
const cfg = table.config
// PUBLIC_URL=wss://poker.example.com makes printed links match the hosted address.
const base = process.env.PUBLIC_URL ?? `ws://localhost:${cfg.port}`
const httpBase = base.replace(/^ws/, 'http')
console.log(`[table] listening on ${base}${cfg.tournament ? ' (TOURNAMENT)' : ''}`)
console.log(`[table] blinds ${cfg.smallBlind}/${cfg.bigBlind}, buy-in ${cfg.buyIn}`)
if (invite) {
  console.log(`[table] seats are invite-only — give your bot this link:`)
  console.log(`[table]   ${base}/?invite=${invite}`)
} else {
  console.log('[table] open table: anyone can take a seat')
}
console.log(`[table] api: ${httpBase}/api/leaderboard`)
if (staticDir) console.log(`[table] spectator UI: ${httpBase}/`)
console.log('[table] game is WAITING — start it with the control API')
if (process.env.ADMIN_TOKEN) {
  console.log(`[table] controls: curl -X POST ${httpBase}/api/start -H 'x-admin-token: <ADMIN_TOKEN>' (also /api/pause, /api/reset)`)
} else {
  console.log('[table] controls DISABLED — set ADMIN_TOKEN to enable /api/start|pause|reset')
}

process.on('SIGINT', () => {
  console.log('\n[table] final stats:')
  for (const s of table.stats()) {
    console.log(`  ${s.name} (seat ${s.seat}): net ${s.net}, hands ${s.hands}, bb/100 ${s.bb100}`)
  }
  table.stop()
  process.exit(0)
})
