/**
 * Self-contained demo match: starts a table and seats baseline bots in-process.
 * Spectate at the UI while it runs.
 *
 *   MAX_HANDS=50 FAST=1 npm run match
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Table } from './table.js'

const fast = !!process.env.FAST
const maxHands = process.env.MAX_HANDS ? Number(process.env.MAX_HANDS) : 50
const port = process.env.PORT ? Number(process.env.PORT) : 7777

// Serve the built spectator from the same port when it exists.
const staticDir = path.resolve(import.meta.dirname, '../../spectator/dist')

const table = new Table({
  port,
  maxHands,
  turnTimeoutMs: fast ? 2000 : 30_000,
  handPauseMs: fast ? 50 : 3000,
  streetPauseMs: fast ? 20 : 1200,
  actionPauseMs: fast ? 10 : 400,
  staticDir: fs.existsSync(staticDir) ? staticDir : null,
})
table.start()
console.log(`[match] table on ws://localhost:${port}, playing ${maxHands} hands${fast ? ' (fast mode)' : ''}`)
if (table.config.staticDir) console.log(`[match] watch at http://localhost:${port}/`)
else console.log('[match] spectator UI not built — run: npm run build --workspace @agent-poker/spectator')

const agentsDir = path.resolve(import.meta.dirname, '../../agents/src')
const bots = [
  { script: 'tag.ts', name: 'TAG-Bot' },
  { script: 'random.ts', name: 'Randy' },
  { script: 'random.ts', name: 'Chaos' },
]
const children = bots.map((b) =>
  spawn('npx', ['tsx', path.join(agentsDir, b.script)], {
    env: { ...process.env, NAME: b.name, URL: `ws://localhost:${port}` },
    stdio: 'inherit',
  }),
)

const poll = setInterval(() => {
  if (table.handsPlayed >= maxHands) {
    clearInterval(poll)
    setTimeout(() => {
      console.log('\n[match] final standings:')
      const standings = table.stats().sort((a, b) => b.net - a.net)
      for (const s of standings) {
        console.log(`  ${s.name.padEnd(10)} net ${String(s.net).padStart(7)}  hands ${s.hands}  bb/100 ${s.bb100}`)
      }
      for (const c of children) c.kill()
      table.stop()
      process.exit(0)
    }, 1000)
  }
}, 500)
