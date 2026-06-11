import { spawn } from 'node:child_process'

const child = spawn('npx', ['tsx', 'packages/mcp/src/server.ts'], {
  env: { ...process.env, URL: 'ws://localhost:7799', NAME: 'Claude-MCP' },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buf = ''
const pending = new Map()
child.stdout.on('data', (d) => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const lineRaw = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!lineRaw.trim()) continue
    const msg = JSON.parse(lineRaw)
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

let nextId = 1
function rpc(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 40000)
  })
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

const init = await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
})
console.log('SERVER:', init.result.serverInfo.name, init.result.serverInfo.version)
notify('notifications/initialized')

const tools = await rpc('tools/list', {})
console.log('TOOLS:', tools.result.tools.map((t) => t.name).join(', '))

const parse = (resp) => JSON.parse(resp.result.content[0].text)

let snap = parse(await rpc('tools/call', { name: 'wait_for_turn', arguments: { maxWaitSec: 20 } }))
console.log('SEATED AS:', JSON.stringify(snap.you?.seat), 'HOLE:', JSON.stringify(snap.you?.holeCards))
for (let i = 0; i < 3 && !snap.yourTurn; i++) {
  snap = parse(await rpc('tools/call', { name: 'wait_for_turn', arguments: { maxWaitSec: 20 } }))
}
if (!snap.yourTurn) throw new Error('never got a turn')
console.log('TURN:', JSON.stringify(snap.yourTurn))

await rpc('tools/call', { name: 'say', arguments: { text: 'I joined via MCP without a single line of transport code.' } })

const move = snap.yourTurn.validMoves.includes('check') ? 'check' : 'call'
const acted = parse(
  await rpc('tools/call', {
    name: 'act',
    arguments: { move, reasoning: `Smoke test: playing ${move} through the MCP adapter.` },
  }),
)
console.log('ACT RESULT:', acted.result)
console.log('EVENTS TAIL:', JSON.stringify(acted.recentEvents?.slice(-3), null, 1))
console.log('SMOKE_OK')
child.kill()
process.exit(0)
