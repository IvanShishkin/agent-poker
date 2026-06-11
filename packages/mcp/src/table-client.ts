import WebSocket from 'ws'
import {
  parseServerMsg,
  type Card,
  type JoinedMsgT,
  type Move,
  type StateMsgT,
  type YourTurnMsgT,
} from '@agent-poker/protocol'

const log = (text: string) => console.error(`[mcp-bridge] ${text}`)

export interface PendingTurn extends YourTurnMsgT {
  receivedAt: number
}

/**
 * Holds one seat at the table on behalf of an MCP client (an LLM agent).
 * Pull-model wrapper over the push protocol: the latest your_turn is parked
 * here until the agent picks it up via wait_for_turn / act.
 */
export class TableClient {
  private ws: WebSocket | null = null
  private token: string | undefined
  private closed = false

  joined: JoinedMsgT | null = null
  holeCards: Card[] = []
  lastState: StateMsgT | null = null
  currentTurn: PendingTurn | null = null
  /** Human-readable feed of things the agent should know about (capped). */
  events: string[] = []

  private turnWaiters: ((turn: PendingTurn | null) => void)[] = []
  private actWaiters: { resolve: (r: string) => void; seq: number }[] = []

  constructor(
    private url: string,
    private name: string,
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: this.name, token: this.token })))
    ws.on('message', (raw) => {
      try {
        this.handle(parseServerMsg(raw.toString()))
      } catch {
        /* ignore unknown messages */
      }
    })
    ws.on('close', () => {
      if (this.closed) return
      log('connection lost, reconnecting in 2s')
      setTimeout(() => this.connect(), 2000)
    })
    ws.on('error', (e) => log(`ws error: ${e.message}`))
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private pushEvent(text: string): void {
    this.events.push(text)
    if (this.events.length > 50) this.events.splice(0, this.events.length - 50)
  }

  private handle(msg: ReturnType<typeof parseServerMsg>): void {
    switch (msg.type) {
      case 'joined':
        this.joined = msg
        this.token = msg.token
        this.pushEvent(`Seated at seat ${msg.seat} with ${msg.chips} chips.`)
        log(`seated at ${msg.seat}`)
        break
      case 'hand_start':
        this.holeCards = msg.holeCards ?? []
        this.currentTurn = null
        this.pushEvent(`New hand ${msg.handId}. Your hole cards: ${this.holeCards.join(' ')}.`)
        break
      case 'state': {
        this.lastState = msg
        // Action applied (or someone else acted): seq moved past what an act() call waited for.
        this.actWaiters = this.actWaiters.filter((w) => {
          if (msg.seq > w.seq) {
            w.resolve('ok')
            return false
          }
          return true
        })
        // A state for a newer seq invalidates a parked turn we never answered.
        if (this.currentTurn && msg.seq > this.currentTurn.seq) this.currentTurn = null
        break
      }
      case 'your_turn': {
        const turn: PendingTurn = { ...msg, receivedAt: Date.now() }
        this.currentTurn = turn
        const waiters = this.turnWaiters
        this.turnWaiters = []
        for (const w of waiters) w(turn)
        break
      }
      case 'hand_end': {
        this.currentTurn = null
        const mySeat = this.joined?.seat
        const net = mySeat != null ? (msg.net[String(mySeat)] ?? 0) : 0
        const showdown = msg.showdown
          ?.map((e) => `seat ${e.seat} showed ${e.holeCards.join(' ')} (${e.handName})`)
          .join('; ')
        this.pushEvent(
          `Hand ${msg.handId} ended. Board: ${msg.board.join(' ') || '—'}. Your net: ${net > 0 ? '+' : ''}${net}.` +
            (showdown ? ` Showdown: ${showdown}.` : ''),
        )
        break
      }
      case 'chat_event':
        if (msg.seat !== this.joined?.seat) this.pushEvent(`${msg.name} (seat ${msg.seat}) says: “${msg.text}”`)
        break
      case 'error':
        this.pushEvent(`Server error [${msg.code}]: ${msg.message}`)
        // An invalid action should fail the pending act() call immediately.
        for (const w of this.actWaiters) w.resolve(`rejected: ${msg.message}`)
        this.actWaiters = []
        break
    }
  }

  /** Resolve with the parked/next your_turn, or null after maxWaitMs. */
  waitForTurn(maxWaitMs: number): Promise<PendingTurn | null> {
    if (this.currentTurn) return Promise.resolve(this.currentTurn)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.turnWaiters = this.turnWaiters.filter((w) => w !== waiter)
        resolve(null)
      }, maxWaitMs)
      const waiter = (turn: PendingTurn | null) => {
        clearTimeout(timer)
        resolve(turn)
      }
      this.turnWaiters.push(waiter)
    })
  }

  /** Send an action for the parked turn; resolves 'ok' or 'rejected: …'. */
  act(move: Move, amount?: number, reasoning?: string): Promise<string> {
    const turn = this.currentTurn
    if (!turn) return Promise.resolve('rejected: it is not your turn (call wait_for_turn first)')
    if (!this.connected) return Promise.resolve('rejected: not connected to the table')
    if (reasoning) this.ws!.send(JSON.stringify({ type: 'reasoning', handId: turn.handId, text: reasoning }))
    this.ws!.send(
      JSON.stringify({
        type: 'action',
        handId: turn.handId,
        seq: turn.seq,
        move,
        ...(amount != null ? { amount: Math.round(amount) } : {}),
      }),
    )
    this.currentTurn = null
    return new Promise((resolve) => {
      const waiter = { resolve, seq: turn.seq }
      this.actWaiters.push(waiter)
      setTimeout(() => {
        this.actWaiters = this.actWaiters.filter((w) => w !== waiter)
        resolve('sent (no confirmation received — check get_table_state)')
      }, 5000)
    })
  }

  say(text: string): void {
    this.ws?.send(JSON.stringify({ type: 'say', text }))
  }
}
