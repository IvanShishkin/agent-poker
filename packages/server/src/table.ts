import { randomBytes, randomUUID, randomInt } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import {
  advanceStreet,
  applyAction,
  createHand,
  isComplete,
  legalActions,
  potSize,
  type HandState,
  type Move,
} from '@agent-poker/engine'
import { parseClientMsg, type PublicPlayer, type ServerMsg } from '@agent-poker/protocol'

export interface TableConfig {
  port: number
  smallBlind: number
  bigBlind: number
  buyIn: number
  turnTimeoutMs: number
  /** Pause between hands so spectators can read the result. */
  handPauseMs: number
  /** Pause between run-out streets (all-in showdowns). */
  streetPauseMs: number
  /** Small pause after each action — pacing for spectators. */
  actionPauseMs: number
  maxSeats: number
  /** Re-buy busted players automatically so long matches keep running. */
  autoRebuy: boolean
  /** Stop after this many hands (0 = run forever). */
  maxHands: number
  /** Seats can only be taken with ?invite=<key> in the WS URL (null = open table). */
  invite: string | null
  /** Tournament mode: fixed stack, no rebuys, eliminations, escalating blinds. */
  tournament: boolean
  /** In tournament mode, blinds double every N hands. */
  blindLevelHands: number
  /** Directory with the built spectator UI to serve at / (null = API only). */
  staticDir: string | null
}

export const DEFAULT_CONFIG: TableConfig = {
  port: 7777,
  smallBlind: 50,
  bigBlind: 100,
  buyIn: 10000,
  turnTimeoutMs: 30_000,
  handPauseMs: 6000,
  streetPauseMs: 2500,
  actionPauseMs: 1800,
  maxSeats: 6,
  autoRebuy: true,
  maxHands: 0,
  invite: null,
  tournament: false,
  blindLevelHands: 20,
  staticDir: null,
}

interface SeatInfo {
  seat: number
  name: string
  token: string
  chips: number
  buyIns: number
  socket: WebSocket | null
  sittingOut: boolean
  consecutiveTimeouts: number
  handsPlayed: number
  lastSayAt: number
  eliminated: boolean
  /** Final tournament place, assigned when the tournament ends. */
  place: number | null
}

interface PendingTurn {
  seat: number
  resolve: (applied: boolean) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Real players don't act on a metronome — vary pauses 60–140%. */
const jitter = (ms: number) => Math.round(ms * (0.6 + Math.random() * 0.8))

export class Table {
  readonly config: TableConfig
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private seats = new Map<number, SeatInfo>()
  private spectators = new Set<WebSocket>()
  private state: HandState | null = null
  private pending: PendingTurn | null = null
  private handCounter = 0
  private buttonSeat = 0
  private stopped = false
  private logStream: fs.WriteStream | null = null
  private logPath = ''
  private eliminationOrder: number[] = []
  private tournamentOver = false
  /** One-time seat invites issued via the spectator UI: token -> expiry. */
  private oneTimeInvites = new Map<string, number>()

  constructor(config: Partial<TableConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  start(): void {
    const logDir = path.join(process.cwd(), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    this.logPath = path.join(logDir, 'hands.jsonl')
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' })

    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res))
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (socket, req) => this.onConnection(socket, req))
    this.httpServer.listen(this.config.port)
    void this.gameLoop()
  }

  stop(): void {
    this.stopped = true
    this.wss?.close()
    this.httpServer?.close()
    for (const seat of this.seats.values()) seat.socket?.close()
    for (const s of this.spectators) s.close()
    this.logStream?.end()
  }

  /** Cumulative profit, big blinds per 100 hands — the skill metric. */
  stats(): {
    seat: number
    name: string
    chips: number
    net: number
    hands: number
    bb100: number
    eliminated: boolean
    place: number | null
  }[] {
    return [...this.seats.values()].map((s) => {
      const net = s.chips - s.buyIns * this.config.buyIn
      const bb100 = s.handsPlayed > 0 ? (net / this.config.bigBlind / s.handsPlayed) * 100 : 0
      return {
        seat: s.seat,
        name: s.name,
        chips: s.chips,
        net,
        hands: s.handsPlayed,
        bb100: Math.round(bb100 * 10) / 10,
        eliminated: s.eliminated,
        place: s.place,
      }
    })
  }

  // ---------- HTTP API (leaderboard, hand history) ----------

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.end()
      return
    }
    const u = new URL(req.url ?? '/', 'http://localhost')
    const json = (data: unknown) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    }
    if (u.pathname === '/api/leaderboard') {
      json({
        mode: this.config.tournament ? 'tournament' : 'cash',
        tournamentOver: this.tournamentOver,
        blinds: this.currentBlinds(),
        seats: { taken: this.seats.size, max: this.config.maxSeats },
        live: this.stats(),
        allTime: this.allTimeStats(),
      })
      return
    }
    if (u.pathname === '/api/seat-link' && req.method === 'POST') {
      const free = this.config.maxSeats - this.seats.size
      if (free <= 0) {
        res.statusCode = 409
        json({ error: 'no free seats' })
        return
      }
      const host = req.headers.host ?? `localhost:${this.config.port}`
      // Behind a TLS-terminating proxy (any PaaS) the agent must dial wss://.
      const scheme = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws'
      let url = `${scheme}://${host}`
      if (this.config.invite !== null) {
        // One-time token: the main invite key never leaves the server.
        const token = randomBytes(6).toString('hex')
        this.oneTimeInvites.set(token, Date.now() + 10 * 60_000)
        url += `/?invite=${token}`
      }
      json({ url, freeSeats: free, expiresInMin: 10, oneTime: this.config.invite !== null })
      return
    }
    if (u.pathname === '/api/hands') {
      const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 500)
      json(this.readHandLog().slice(-limit).reverse())
      return
    }
    if (this.config.staticDir && req.method === 'GET' && this.serveStatic(u.pathname, res)) return
    res.statusCode = 404
    res.end('not found')
  }

  /** Minimal static hosting for the built spectator (SPA fallback to index.html). */
  private serveStatic(pathname: string, res: http.ServerResponse): boolean {
    const dir = this.config.staticDir!
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
    let file = path.join(dir, safe === '/' || safe === '\\' ? 'index.html' : safe)
    if (!file.startsWith(dir)) return false
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    if (!fs.existsSync(file)) return false
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
    }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream')
    res.end(fs.readFileSync(file))
    return true
  }

  private readHandLog(): unknown[] {
    try {
      return fs
        .readFileSync(this.logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as unknown)
    } catch {
      return []
    }
  }

  private allTimeStats(): { name: string; net: number; hands: number; bb100: number }[] {
    const byName = new Map<string, { net: number; hands: number; bbSum: number }>()
    for (const raw of this.readHandLog()) {
      const hand = raw as { bigBlind?: number; players?: { name: string; start: number; end: number }[] }
      if (!hand.players) continue
      const bb = hand.bigBlind ?? this.config.bigBlind
      for (const p of hand.players) {
        const e = byName.get(p.name) ?? { net: 0, hands: 0, bbSum: 0 }
        e.net += p.end - p.start
        e.hands++
        e.bbSum += (p.end - p.start) / bb
        byName.set(p.name, e)
      }
    }
    return [...byName.entries()]
      .map(([name, e]) => ({
        name,
        net: e.net,
        hands: e.hands,
        bb100: Math.round((e.bbSum / e.hands) * 100 * 10) / 10,
      }))
      .sort((a, b) => b.net - a.net)
  }

  /** Blinds for the next hand — escalate by level in tournament mode. */
  private currentBlinds(): { smallBlind: number; bigBlind: number; level: number } {
    const level = this.config.tournament ? Math.floor(this.handCounter / this.config.blindLevelHands) : 0
    const mult = 2 ** level
    return { smallBlind: this.config.smallBlind * mult, bigBlind: this.config.bigBlind * mult, level }
  }

  get handsPlayed(): number {
    return this.handCounter
  }

  // ---------- connections ----------

  private onConnection(socket: WebSocket, req: http.IncomingMessage): void {
    let boundSeat: SeatInfo | null = null
    let isSpectator = false
    const inviteParam = new URL(req.url ?? '/', 'http://localhost').searchParams.get('invite')
    const inviteOk = this.config.invite === null || inviteParam === this.config.invite

    socket.on('message', (raw) => {
      let msg
      try {
        msg = parseClientMsg(raw.toString())
      } catch {
        this.send(socket, { type: 'error', code: 'bad_message', message: 'malformed or unknown message' })
        return
      }

      switch (msg.type) {
        case 'subscribe': {
          isSpectator = true
          this.spectators.add(socket)
          this.sendSnapshot(socket)
          break
        }
        case 'join': {
          if (boundSeat || isSpectator) return
          // Reconnect to an existing seat needs no invite — the seat token IS the credential.
          const isReconnect = !!msg.token && [...this.seats.values()].some((s) => s.token === msg.token)
          const expiry = inviteParam ? this.oneTimeInvites.get(inviteParam) : undefined
          const viaOneTime = !inviteOk && expiry !== undefined && expiry > Date.now()
          if (!isReconnect && !inviteOk && !viaOneTime) {
            // Watching is open to everyone; taking a seat needs an invite link.
            this.send(socket, { type: 'error', code: 'invalid_invite', message: 'a seat requires the invite link' })
            socket.close()
            return
          }
          boundSeat = this.handleJoin(socket, msg.name, msg.token ?? undefined)
          if (boundSeat && viaOneTime) this.oneTimeInvites.delete(inviteParam!) // consumed
          break
        }
        case 'action': {
          if (!boundSeat) return
          if (!this.pending || this.pending.seat !== boundSeat.seat || !this.state) {
            this.send(socket, { type: 'error', code: 'not_your_turn', message: 'no action expected from you' })
            return
          }
          if (msg.handId !== this.state.handId || msg.seq !== this.state.seq) {
            this.send(socket, { type: 'error', code: 'stale_seq', message: 'state has moved on, wait for your_turn' })
            return
          }
          try {
            applyAction(this.state, boundSeat.seat, { move: msg.move as Move, amount: msg.amount ?? undefined })
          } catch (e) {
            this.send(socket, { type: 'error', code: 'invalid_action', message: (e as Error).message })
            return
          }
          const resolve = this.pending.resolve
          this.pending = null
          resolve(true)
          break
        }
        case 'reasoning': {
          if (!boundSeat || !this.state) return
          this.broadcastSpectators({
            type: 'reasoning_event',
            handId: msg.handId,
            seat: boundSeat.seat,
            name: boundSeat.name,
            text: msg.text,
          })
          break
        }
        case 'say': {
          if (!boundSeat) return
          const now = Date.now()
          if (now - boundSeat.lastSayAt < 1500) return // keep chatty agents from flooding the table
          boundSeat.lastSayAt = now
          this.broadcastAll({ type: 'chat_event', seat: boundSeat.seat, name: boundSeat.name, text: msg.text })
          break
        }
      }
    })

    socket.on('close', () => {
      this.spectators.delete(socket)
      if (boundSeat && boundSeat.socket === socket) boundSeat.socket = null
    })
  }

  private handleJoin(socket: WebSocket, name: string, token?: string): SeatInfo | null {
    // Reconnect onto an existing seat.
    if (token) {
      const existing = [...this.seats.values()].find((s) => s.token === token)
      if (existing) {
        existing.socket?.close()
        existing.socket = socket
        existing.sittingOut = false
        existing.consecutiveTimeouts = 0
        this.sendJoined(socket, existing)
        return existing
      }
    }
    let seatNo: number | null = null
    for (let i = 1; i <= this.config.maxSeats; i++) {
      if (!this.seats.has(i)) {
        seatNo = i
        break
      }
    }
    if (seatNo === null) {
      this.send(socket, { type: 'error', code: 'table_full', message: 'no free seats' })
      socket.close()
      return null
    }
    const seat: SeatInfo = {
      seat: seatNo,
      name,
      token: randomUUID(),
      chips: this.config.buyIn,
      buyIns: 1,
      socket,
      sittingOut: false,
      consecutiveTimeouts: 0,
      handsPlayed: 0,
      lastSayAt: 0,
      eliminated: false,
      place: null,
    }
    this.seats.set(seatNo, seat)
    this.sendJoined(socket, seat)
    return seat
  }

  private sendJoined(socket: WebSocket, seat: SeatInfo): void {
    this.send(socket, {
      type: 'joined',
      seat: seat.seat,
      chips: seat.chips,
      token: seat.token,
      tableConfig: {
        smallBlind: this.config.smallBlind,
        bigBlind: this.config.bigBlind,
        turnTimeoutMs: this.config.turnTimeoutMs,
        maxSeats: this.config.maxSeats,
      },
    })
  }

  // ---------- game loop ----------

  private eligibleSeats(): SeatInfo[] {
    return [...this.seats.values()]
      .filter((s) => !s.sittingOut && !s.eliminated && s.socket?.readyState === WebSocket.OPEN && s.chips > 0)
      .sort((a, b) => a.seat - b.seat)
  }

  private async gameLoop(): Promise<void> {
    while (!this.stopped) {
      if (this.config.maxHands > 0 && this.handCounter >= this.config.maxHands) break
      if (this.tournamentOver) {
        await sleep(1000)
        continue
      }
      const players = this.eligibleSeats()
      if (players.length < 2) {
        await sleep(1000)
        continue
      }
      try {
        await this.playHand(players)
      } catch (e) {
        console.error('hand crashed:', e)
        this.state = null
      }
      if (this.config.tournament) {
        this.processEliminations()
      } else if (this.config.autoRebuy) {
        // Re-buy busted stacks between hands (cash game).
        for (const s of this.seats.values()) {
          if (s.chips === 0) {
            s.chips = this.config.buyIn
            s.buyIns++
          }
        }
      }
      await sleep(this.config.handPauseMs)
    }
  }

  private processEliminations(): void {
    const busted = [...this.seats.values()]
      .filter((s) => !s.eliminated && s.chips === 0)
      // Several players busting the same hand: the shorter starting stack finishes lower.
      .sort((a, b) => {
        const sa = this.state?.players.find((p) => p.seat === a.seat)?.startingChips ?? 0
        const sb = this.state?.players.find((p) => p.seat === b.seat)?.startingChips ?? 0
        return sa - sb
      })
    for (const s of busted) {
      s.eliminated = true
      this.eliminationOrder.push(s.seat)
      this.broadcastAll({
        type: 'chat_event',
        seat: 0,
        name: 'Table',
        text: `${s.name} is eliminated from the tournament (#${this.eliminationOrder.length} out).`,
      })
    }
    const alive = [...this.seats.values()].filter((s) => !s.eliminated && s.chips > 0)
    if (alive.length === 1 && this.seats.size >= 2) {
      this.tournamentOver = true
      alive[0].place = 1
      const reversed = [...this.eliminationOrder].reverse()
      reversed.forEach((seat, i) => {
        this.seats.get(seat)!.place = i + 2
      })
      const standings = [...this.seats.values()]
        .filter((s) => s.place !== null)
        .sort((a, b) => a.place! - b.place!)
        .map((s) => `${s.place}. ${s.name}`)
        .join('  ')
      this.broadcastAll({ type: 'chat_event', seat: 0, name: 'Table', text: `Tournament over! ${standings}` })
      console.log(`[table] tournament over: ${standings}`)
    }
  }

  private async playHand(participants: SeatInfo[]): Promise<void> {
    const blinds = this.currentBlinds()
    this.handCounter++
    const handId = `h${this.handCounter}`
    const seats = participants.map((s) => s.seat)
    this.buttonSeat = seats.find((s) => s > this.buttonSeat) ?? seats[0]

    const state = createHand({
      handId,
      players: participants.map((s) => ({ seat: s.seat, name: s.name, chips: s.chips })),
      button: this.buttonSeat,
      smallBlind: blinds.smallBlind,
      bigBlind: blinds.bigBlind,
      seed: randomInt(2 ** 31),
    })
    this.state = state

    // hand_start: each agent sees only its own cards; spectators see everything.
    for (const s of participants) {
      const p = state.players.find((p) => p.seat === s.seat)!
      this.sendToSeat(s, {
        type: 'hand_start',
        handId,
        button: state.button,
        smallBlind: state.smallBlind,
        bigBlind: state.bigBlind,
        holeCards: p.holeCards,
        players: this.publicPlayers(state, false),
      })
      s.handsPlayed++
    }
    this.broadcastSpectators({
      type: 'hand_start',
      handId,
      button: state.button,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      players: this.publicPlayers(state, true),
    })
    this.broadcastState()

    while (!isComplete(state)) {
      if (state.toAct === null) {
        await sleep(jitter(this.config.streetPauseMs))
        advanceStreet(state)
        this.broadcastState()
        continue
      }
      const seatInfo = this.seats.get(state.toAct)!
      const la = legalActions(state)
      let applied = false

      if (seatInfo.socket?.readyState === WebSocket.OPEN && !seatInfo.sittingOut) {
        this.sendToSeat(seatInfo, {
          type: 'your_turn',
          handId,
          seq: state.seq,
          validMoves: la.moves,
          toCall: la.toCall,
          minRaiseTo: la.minRaiseTo,
          maxRaiseTo: la.maxRaiseTo,
          timeoutMs: this.config.turnTimeoutMs,
        })
        applied = await this.waitForAction(seatInfo.seat)
      }

      if (!applied) {
        // Disconnected, sitting out or timed out: check if free, otherwise fold.
        seatInfo.consecutiveTimeouts++
        if (seatInfo.consecutiveTimeouts >= 3) seatInfo.sittingOut = true
        const fallback: Move = la.moves.includes('check') ? 'check' : 'fold'
        applyAction(state, seatInfo.seat, { move: fallback })
      } else {
        seatInfo.consecutiveTimeouts = 0
      }
      this.broadcastState()
      await sleep(jitter(this.config.actionPauseMs))
    }

    // Sync engine result back to the seats.
    const net: Record<string, number> = {}
    for (const p of state.players) {
      const s = this.seats.get(p.seat)!
      s.chips = p.chips
      net[String(p.seat)] = p.chips - p.startingChips
    }
    const payouts: Record<string, number> = {}
    for (const [seat, amount] of Object.entries(state.payouts)) payouts[seat] = amount

    const endMsgFor = (reveal: boolean): ServerMsg => ({
      type: 'hand_end',
      handId,
      board: state.board,
      payouts,
      net,
      showdown: state.showdown?.map((e) => ({ seat: e.seat, holeCards: e.holeCards, handName: e.handName })),
      players: this.publicPlayers(state, reveal),
    })
    for (const s of participants) this.sendToSeat(s, endMsgFor(false))
    this.broadcastSpectators(endMsgFor(true))

    this.logStream?.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        handId,
        button: state.button,
        bigBlind: state.bigBlind,
        board: state.board,
        players: state.players.map((p) => ({
          seat: p.seat,
          name: p.name,
          hole: p.holeCards,
          start: p.startingChips,
          end: p.chips,
          folded: p.folded,
        })),
        payouts: state.payouts,
        showdown: state.showdown,
      }) + '\n',
    )
    this.state = null
  }

  private waitForAction(seat: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.seat === seat) this.pending = null
        resolve(false)
      }, this.config.turnTimeoutMs)
      this.pending = {
        seat,
        resolve: (applied) => {
          clearTimeout(timer)
          resolve(applied)
        },
      }
    })
  }

  // ---------- messaging ----------

  private publicPlayers(state: HandState, reveal: boolean): PublicPlayer[] {
    return state.players.map((p) => {
      const seat = this.seats.get(p.seat)
      return {
        seat: p.seat,
        name: p.name,
        chips: p.chips,
        bet: p.committed,
        folded: p.folded,
        allIn: p.allIn,
        sittingOut: seat?.sittingOut ?? false,
        connected: seat?.socket?.readyState === WebSocket.OPEN,
        ...(reveal ? { holeCards: p.holeCards } : {}),
      }
    })
  }

  private stateMsg(state: HandState, reveal: boolean): ServerMsg {
    return {
      type: 'state',
      handId: state.handId,
      seq: state.seq,
      street: state.street,
      board: state.board,
      pot: potSize(state),
      currentBet: state.currentBet,
      toAct: state.toAct,
      players: this.publicPlayers(state, reveal),
      ...(state.lastAction ? { lastAction: state.lastAction } : {}),
    }
  }

  private broadcastState(): void {
    if (!this.state) return
    const playerMsg = JSON.stringify(this.stateMsg(this.state, false))
    for (const s of this.seats.values()) {
      if (s.socket?.readyState === WebSocket.OPEN) s.socket.send(playerMsg)
    }
    this.broadcastSpectators(this.stateMsg(this.state, true))
  }

  private sendSnapshot(socket: WebSocket): void {
    if (!this.state) return
    this.send(socket, {
      type: 'hand_start',
      handId: this.state.handId,
      button: this.state.button,
      smallBlind: this.state.smallBlind,
      bigBlind: this.state.bigBlind,
      players: this.publicPlayers(this.state, true),
    })
    this.send(socket, this.stateMsg(this.state, true))
  }

  private broadcastAll(msg: ServerMsg): void {
    const raw = JSON.stringify(msg)
    for (const s of this.seats.values()) {
      if (s.socket?.readyState === WebSocket.OPEN) s.socket.send(raw)
    }
    for (const s of this.spectators) {
      if (s.readyState === WebSocket.OPEN) s.send(raw)
    }
  }

  private broadcastSpectators(msg: ServerMsg): void {
    const raw = JSON.stringify(msg)
    for (const s of this.spectators) {
      if (s.readyState === WebSocket.OPEN) s.send(raw)
    }
  }

  private sendToSeat(seat: SeatInfo, msg: ServerMsg): void {
    if (seat.socket?.readyState === WebSocket.OPEN) seat.socket.send(JSON.stringify(msg))
  }

  private send(socket: WebSocket, msg: ServerMsg): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }
}
