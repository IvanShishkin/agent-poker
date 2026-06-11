import WebSocket from 'ws'
import {
  parseServerMsg,
  type Card,
  type JoinedMsgT,
  type Move,
  type ServerMsg,
  type StateMsgT,
  type YourTurnMsgT,
} from '@agent-poker/protocol'

export interface TurnContext {
  turn: YourTurnMsgT
  /** Latest public state seen before this turn (may be null right after hand_start). */
  state: StateMsgT | null
  holeCards: Card[]
  board: Card[]
  mySeat: number
  bigBlind: number
  pot: number
}

export interface Decision {
  move: Move
  amount?: number
  /** Optional explanation streamed to spectators. */
  reasoning?: string
}

export type TurnHandler = (ctx: TurnContext) => Decision | Promise<Decision>

export interface AgentOpts {
  url: string
  name: string
  onTurn: TurnHandler
  /** Called for every server message (hand_end, chat_event, …) — react with agent.say(), keep stats, etc. */
  onEvent?: (msg: ServerMsg, agent: PokerAgent) => void
  log?: boolean
}

/**
 * Minimal poker agent transport: connects, keeps state, answers your_turn.
 * Falls back to check/fold if the handler returns something the server rejects.
 */
export class PokerAgent {
  private ws: WebSocket | null = null
  private joined: JoinedMsgT | null = null
  private holeCards: Card[] = []
  private lastState: StateMsgT | null = null
  private lastTurn: YourTurnMsgT | null = null
  private token: string | undefined
  private closed = false

  constructor(private opts: AgentOpts) {}

  connect(): void {
    const ws = new WebSocket(this.opts.url)
    this.ws = ws

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', name: this.opts.name, token: this.token }))
    })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = parseServerMsg(raw.toString())
      } catch {
        return
      }
      void this.handle(msg)
    })

    ws.on('close', () => {
      if (this.closed) return
      this.log('connection lost, reconnecting in 2s')
      setTimeout(() => this.connect(), 2000)
    })

    ws.on('error', (e) => this.log(`ws error: ${e.message}`))
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }

  /** Your seat number, or null until `joined` arrives. */
  get seat(): number | null {
    return this.joined?.seat ?? null
  }

  /** Table talk: visible to spectators and the other players (rate-limited server-side). */
  say(text: string): void {
    this.ws?.send(JSON.stringify({ type: 'say', text }))
  }

  private async handle(msg: ReturnType<typeof parseServerMsg>): Promise<void> {
    try {
      this.opts.onEvent?.(msg, this)
    } catch (e) {
      this.log(`onEvent crashed: ${(e as Error).message}`)
    }
    switch (msg.type) {
      case 'joined':
        this.joined = msg
        this.token = msg.token
        this.log(`seated at ${msg.seat} with ${msg.chips} chips`)
        break
      case 'hand_start':
        this.holeCards = msg.holeCards ?? []
        this.lastState = null
        break
      case 'state':
        this.lastState = msg
        break
      case 'your_turn': {
        this.lastTurn = msg
        if (!this.joined) return
        const ctx: TurnContext = {
          turn: msg,
          state: this.lastState,
          holeCards: this.holeCards,
          board: this.lastState?.board ?? [],
          mySeat: this.joined.seat,
          bigBlind: this.joined.tableConfig.bigBlind,
          pot: this.lastState?.pot ?? 0,
        }
        let decision: Decision
        try {
          decision = await this.opts.onTurn(ctx)
        } catch (e) {
          this.log(`handler crashed (${(e as Error).message}), falling back`)
          decision = { move: msg.validMoves.includes('check') ? 'check' : 'fold' }
        }
        if (decision.reasoning) {
          this.ws?.send(JSON.stringify({ type: 'reasoning', handId: msg.handId, text: decision.reasoning }))
        }
        this.ws?.send(
          JSON.stringify({
            type: 'action',
            handId: msg.handId,
            seq: msg.seq,
            move: decision.move,
            ...(decision.amount != null ? { amount: Math.round(decision.amount) } : {}),
          }),
        )
        break
      }
      case 'error': {
        this.log(`server error: ${msg.code} — ${msg.message}`)
        // Our action was rejected mid-turn: send the safe fallback so we don't time out.
        if (msg.code === 'invalid_action' && this.lastTurn) {
          const t = this.lastTurn
          this.lastTurn = null
          this.ws?.send(
            JSON.stringify({
              type: 'action',
              handId: t.handId,
              seq: t.seq,
              move: t.validMoves.includes('check') ? 'check' : 'fold',
            }),
          )
        }
        break
      }
      case 'hand_end':
        this.lastTurn = null
        break
    }
  }

  private log(text: string): void {
    if (this.opts.log !== false) console.log(`[${this.opts.name}] ${text}`)
  }
}
