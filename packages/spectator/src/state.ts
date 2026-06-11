import type { Card, PublicPlayer, ServerMsg, Street } from '@agent-poker/protocol'
import { describeMove, fmt, shortHandId } from './format'

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting'

export interface LogLine {
  id: number
  kind: 'hand' | 'action' | 'street' | 'result' | 'reasoning' | 'error' | 'info'
  text: string
  cards?: Card[]
}

export interface Bubble {
  id: number
  seat: number
  name: string
  text: string
}

export interface WinnerInfo {
  payout: number
  net: number
  handName?: string
}

export interface GameState {
  conn: ConnStatus
  handId: string | null
  button: number | null
  smallBlind: number | null
  bigBlind: number | null
  street: Street | null
  board: Card[]
  pot: number
  currentBet: number
  toAct: number | null
  players: PublicPlayer[]
  /** seat -> winnings at hand end (cleared on next hand) */
  winners: Record<number, WinnerInfo>
  /** seat -> hand name at showdown */
  handNames: Record<number, string>
  handOver: boolean
  lastSeq: number
  log: LogLine[]
  bubbles: Bubble[]
}

export const initialState: GameState = {
  conn: 'connecting',
  handId: null,
  button: null,
  smallBlind: null,
  bigBlind: null,
  street: null,
  board: [],
  pot: 0,
  currentBet: 0,
  toAct: null,
  players: [],
  winners: {},
  handNames: {},
  handOver: false,
  lastSeq: -1,
  log: [],
  bubbles: [],
}

export type Action =
  | { type: 'conn'; status: ConnStatus }
  | { type: 'msg'; msg: ServerMsg }
  | { type: 'bubble_expire'; id: number }

const MAX_LOG = 200
let nextId = 1

function line(kind: LogLine['kind'], text: string, cards?: Card[]): LogLine {
  return { id: nextId++, kind, text, cards }
}

function pushLog(log: LogLine[], ...lines: LogLine[]): LogLine[] {
  const next = [...log, ...lines]
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next
}

function playerName(players: PublicPlayer[], seat: number): string {
  return players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`
}

const STREET_LABEL: Partial<Record<Street, string>> = {
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
}

/** Cards newly dealt for a street marker. */
function streetCards(street: Street, board: Card[]): Card[] {
  if (street === 'flop') return board.slice(0, 3)
  if (street === 'turn') return board.slice(3, 4)
  if (street === 'river') return board.slice(4, 5)
  return []
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'conn':
      return { ...state, conn: action.status }
    case 'bubble_expire':
      return { ...state, bubbles: state.bubbles.filter((b) => b.id !== action.id) }
    case 'msg':
      return handleMsg(state, action.msg)
  }
}

function handleMsg(s: GameState, msg: ServerMsg): GameState {
  switch (msg.type) {
    case 'hand_start': {
      return {
        ...s,
        handId: msg.handId,
        button: msg.button,
        smallBlind: msg.smallBlind,
        bigBlind: msg.bigBlind,
        street: 'preflop',
        board: [],
        pot: 0,
        currentBet: 0,
        toAct: null,
        players: msg.players,
        winners: {},
        handNames: {},
        handOver: false,
        lastSeq: -1,
        bubbles: [],
        log: pushLog(
          s.log,
          line('hand', `Hand ${shortHandId(msg.handId)} · blinds ${fmt(msg.smallBlind)}/${fmt(msg.bigBlind)}`),
        ),
      }
    }

    case 'state': {
      const newHand = msg.handId !== s.handId
      let log = s.log
      if (newHand && s.handId === null) {
        log = pushLog(log, line('info', `Joined mid-hand ${shortHandId(msg.handId)}`))
      }
      // Log the action that produced this state (dedupe via seq).
      if (msg.lastAction && (newHand || msg.seq > s.lastSeq)) {
        const { seat, move, amount } = msg.lastAction
        log = pushLog(log, line('action', `${playerName(msg.players, seat)} ${describeMove(move, amount)}`))
      }
      // Street marker when the street advances within a hand.
      if (!newHand && msg.street !== s.street && STREET_LABEL[msg.street]) {
        const cards = streetCards(msg.street, msg.board)
        log = pushLog(log, line('street', STREET_LABEL[msg.street]!, cards.length ? cards : undefined))
      }
      return {
        ...s,
        handId: msg.handId,
        street: msg.street,
        board: msg.board,
        pot: msg.pot,
        currentBet: msg.currentBet,
        toAct: msg.toAct,
        players: msg.players,
        lastSeq: msg.seq,
        log,
        ...(newHand ? { winners: {}, handNames: {}, handOver: false } : null),
      }
    }

    case 'hand_end': {
      const winners: Record<number, WinnerInfo> = {}
      for (const [seatStr, payout] of Object.entries(msg.payouts)) {
        if (payout > 0) {
          const seat = Number(seatStr)
          winners[seat] = { payout, net: msg.net[seatStr] ?? 0 }
        }
      }
      const handNames: Record<number, string> = {}
      let log = s.log
      if (msg.showdown) {
        for (const sd of msg.showdown) {
          handNames[sd.seat] = sd.handName
          if (winners[sd.seat]) winners[sd.seat].handName = sd.handName
          log = pushLog(
            log,
            line('action', `${playerName(msg.players, sd.seat)} shows`, sd.holeCards),
          )
        }
      }
      for (const [seatStr, info] of Object.entries(winners)) {
        const seat = Number(seatStr)
        const withHand = info.handName ? ` with ${info.handName}` : ''
        log = pushLog(log, line('result', `${playerName(msg.players, seat)} wins ${fmt(info.payout)}${withHand}`))
      }
      return {
        ...s,
        handId: msg.handId,
        board: msg.board,
        street: 'complete',
        toAct: null,
        players: msg.players,
        winners,
        handNames,
        handOver: true,
        log,
      }
    }

    case 'reasoning_event':
    case 'chat_event': {
      const bubble: Bubble = { id: nextId++, seat: msg.seat, name: msg.name, text: msg.text }
      return {
        ...s,
        bubbles: [...s.bubbles.filter((b) => b.seat !== msg.seat), bubble],
        log: pushLog(s.log, line('reasoning', `${msg.name}: “${msg.text}”`)),
      }
    }

    case 'error':
      return { ...s, log: pushLog(s.log, line('error', `Error [${msg.code}]: ${msg.message}`)) }

    // Agent-only messages; never expected on the spectator stream.
    case 'joined':
    case 'your_turn':
      return s
  }
}
