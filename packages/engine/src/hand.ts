import type { Card } from './cards.js'
import { shuffledDeck } from './cards.js'
import { describeHand, pickWinners } from './evaluate.js'

export type Move = 'fold' | 'check' | 'call' | 'raise'
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete'

export class InvalidActionError extends Error {}

export interface HandPlayer {
  seat: number
  name: string
  startingChips: number
  /** Chips behind (not yet committed). */
  chips: number
  holeCards: [Card, Card]
  folded: boolean
  allIn: boolean
  /** Committed on the current street. */
  committed: number
  /** Committed over the whole hand. */
  totalCommitted: number
}

export interface ShowdownEntry {
  seat: number
  holeCards: [Card, Card]
  handName: string
}

export interface LastAction {
  seat: number
  move: Move
  amount?: number
}

export interface HandState {
  handId: string
  button: number
  smallBlind: number
  bigBlind: number
  deck: Card[]
  board: Card[]
  street: Street
  players: HandPlayer[]
  /** Seat to act, or null when no betting is possible (run-out / hand over). */
  toAct: number | null
  /** Highest total committed on this street. */
  currentBet: number
  /** Size of the last full raise — defines the minimum re-raise. */
  lastFullRaise: number
  /** Seats that have acted since the last full raise; facing a short all-in they may only call/fold. */
  actedSinceFullRaise: number[]
  seq: number
  lastAction: LastAction | null
  /** Gross winnings per seat, set when the hand completes. */
  payouts: Record<number, number>
  showdown?: ShowdownEntry[]
}

export interface LegalActions {
  moves: Move[]
  /** Chips needed to call, capped by stack. */
  toCall: number
  minRaiseTo: number | null
  maxRaiseTo: number | null
}

export interface CreateHandOpts {
  handId: string
  players: { seat: number; name: string; chips: number }[]
  button: number
  smallBlind: number
  bigBlind: number
  seed: number
  /** Test hook: fully ordered deck instead of a seeded shuffle. */
  deck?: Card[]
}

// ---------- helpers ----------

function player(state: HandState, seat: number): HandPlayer {
  const p = state.players.find((p) => p.seat === seat)
  if (!p) throw new InvalidActionError(`no player at seat ${seat}`)
  return p
}

/** Next seat in table order among the hand's players, regardless of status. */
function nextSeatInHand(state: HandState, from: number): number {
  const seats = state.players.map((p) => p.seat)
  const higher = seats.filter((s) => s > from)
  return higher.length > 0 ? Math.min(...higher) : Math.min(...seats)
}

/** Next seat after `from` that can still act (not folded, not all-in), or null. */
function nextToAct(state: HandState, from: number): number | null {
  let seat = from
  for (let i = 0; i < state.players.length; i++) {
    seat = nextSeatInHand(state, seat)
    const p = player(state, seat)
    if (!p.folded && !p.allIn) return seat
    if (seat === from) break
  }
  return null
}

function commit(state: HandState, seat: number, amount: number): void {
  const p = player(state, seat)
  if (amount > p.chips) throw new InvalidActionError('commit exceeds stack')
  p.chips -= amount
  p.committed += amount
  p.totalCommitted += amount
  if (p.chips === 0) p.allIn = true
}

function actors(state: HandState): HandPlayer[] {
  return state.players.filter((p) => !p.folded && !p.allIn)
}

export function potSize(state: HandState): number {
  return state.players.reduce((sum, p) => sum + p.totalCommitted, 0)
}

/** If the biggest bet went uncalled, return the excess to its owner before building pots. */
function refundUncalled(state: HandState): void {
  const sorted = [...state.players].sort((a, b) => b.totalCommitted - a.totalCommitted)
  if (sorted.length < 2) return
  const diff = sorted[0].totalCommitted - sorted[1].totalCommitted
  if (diff > 0) {
    sorted[0].chips += diff
    sorted[0].totalCommitted -= diff
    if (sorted[0].allIn && sorted[0].chips > 0) sorted[0].allIn = false
  }
}

// ---------- lifecycle ----------

export function createHand(opts: CreateHandOpts): HandState {
  const seatDefs = [...opts.players].sort((a, b) => a.seat - b.seat)
  if (seatDefs.length < 2) throw new InvalidActionError('need at least 2 players')
  if (seatDefs.some((p) => p.chips <= 0)) throw new InvalidActionError('player with empty stack')
  if (!seatDefs.some((p) => p.seat === opts.button)) throw new InvalidActionError('button not seated')

  const deck = opts.deck ? [...opts.deck] : shuffledDeck(opts.seed)

  const state: HandState = {
    handId: opts.handId,
    button: opts.button,
    smallBlind: opts.smallBlind,
    bigBlind: opts.bigBlind,
    deck,
    board: [],
    street: 'preflop',
    players: seatDefs.map((p) => ({
      seat: p.seat,
      name: p.name,
      startingChips: p.chips,
      chips: p.chips,
      holeCards: ['', ''] as [Card, Card],
      folded: false,
      allIn: false,
      committed: 0,
      totalCommitted: 0,
    })),
    toAct: null,
    currentBet: 0,
    lastFullRaise: opts.bigBlind,
    actedSinceFullRaise: [],
    seq: 0,
    lastAction: null,
    payouts: {},
  }

  // Deal two cards each, one at a time, starting left of the button.
  const dealOrder: number[] = []
  let s = opts.button
  for (let i = 0; i < state.players.length; i++) {
    s = nextSeatInHand(state, s)
    dealOrder.push(s)
  }
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) {
      player(state, seat).holeCards[round] = state.deck.shift()!
    }
  }

  // Blinds. Heads-up: the button posts the small blind and acts first preflop.
  const headsUp = state.players.length === 2
  const sbSeat = headsUp ? opts.button : nextSeatInHand(state, opts.button)
  const bbSeat = nextSeatInHand(state, sbSeat)
  commit(state, sbSeat, Math.min(opts.smallBlind, player(state, sbSeat).chips))
  commit(state, bbSeat, Math.min(opts.bigBlind, player(state, bbSeat).chips))
  state.currentBet = opts.bigBlind

  state.toAct = nextToAct(state, bbSeat)
  if (state.toAct === null || actors(state).length < 2) {
    // Blinds put (almost) everyone all-in — no betting, straight to the run-out.
    state.toAct = actors(state).length === 1 && firstActorFacingBet(state) ? state.toAct : null
  }
  return state
}

/** True if the single remaining actor still owes chips (so they get a call/fold decision). */
function firstActorFacingBet(state: HandState): boolean {
  const a = actors(state)
  return a.length === 1 && state.currentBet - a[0].committed > 0
}

export function legalActions(state: HandState): LegalActions {
  if (state.toAct === null) throw new InvalidActionError('no one to act')
  const p = player(state, state.toAct)
  const owed = state.currentBet - p.committed
  const toCall = Math.min(owed, p.chips)

  const moves: Move[] = ['fold']
  if (owed === 0) moves.push('check')
  else moves.push('call')

  let minRaiseTo: number | null = null
  let maxRaiseTo: number | null = null
  const oppCanRespond = state.players.some((o) => o.seat !== p.seat && !o.folded && !o.allIn)
  if (!state.actedSinceFullRaise.includes(p.seat) && p.chips > owed && oppCanRespond) {
    maxRaiseTo = p.committed + p.chips
    minRaiseTo = Math.min(state.currentBet + state.lastFullRaise, maxRaiseTo)
    moves.push('raise')
  }
  return { moves, toCall, minRaiseTo, maxRaiseTo }
}

export function applyAction(state: HandState, seat: number, action: { move: Move; amount?: number }): HandState {
  if (state.toAct === null || state.street === 'showdown' || state.street === 'complete')
    throw new InvalidActionError('no action expected')
  if (seat !== state.toAct) throw new InvalidActionError(`not seat ${seat}'s turn`)

  const la = legalActions(state)
  if (!la.moves.includes(action.move)) throw new InvalidActionError(`${action.move} is not legal here`)
  const p = player(state, seat)

  switch (action.move) {
    case 'fold':
      p.folded = true
      addActed(state, seat)
      break
    case 'check':
      addActed(state, seat)
      break
    case 'call':
      commit(state, seat, la.toCall)
      addActed(state, seat)
      break
    case 'raise': {
      const amt = action.amount
      if (amt == null || !Number.isInteger(amt)) throw new InvalidActionError('raise needs an integer amount')
      if (amt > la.maxRaiseTo!) throw new InvalidActionError(`raise above max (${la.maxRaiseTo})`)
      if (amt < la.minRaiseTo! && amt !== la.maxRaiseTo)
        throw new InvalidActionError(`raise below min (${la.minRaiseTo}); only an all-in may be smaller`)
      const raiseSize = amt - state.currentBet
      commit(state, seat, amt - p.committed)
      state.currentBet = amt
      if (raiseSize >= state.lastFullRaise) {
        state.lastFullRaise = raiseSize
        state.actedSinceFullRaise = [seat]
      } else {
        // Short all-in: does not reopen betting for those who already acted.
        addActed(state, seat)
      }
      break
    }
  }

  state.lastAction = { seat, move: action.move, ...(action.move === 'raise' ? { amount: action.amount } : {}) }
  state.seq++
  afterAction(state, seat)
  return state
}

function addActed(state: HandState, seat: number): void {
  if (!state.actedSinceFullRaise.includes(seat)) state.actedSinceFullRaise.push(seat)
}

function roundComplete(state: HandState): boolean {
  return actors(state).every(
    (p) => p.committed === state.currentBet && state.actedSinceFullRaise.includes(p.seat),
  )
}

function afterAction(state: HandState, actorSeat: number): void {
  const live = state.players.filter((p) => !p.folded)
  if (live.length === 1) {
    finishByFold(state, live[0])
    return
  }
  if (roundComplete(state)) {
    endBettingRound(state)
  } else {
    state.toAct = nextToAct(state, actorSeat)
    if (state.toAct === null) endBettingRound(state)
  }
}

function endBettingRound(state: HandState): void {
  if (actors(state).length >= 2) {
    if (state.street === 'river') {
      resolveShowdown(state)
    } else {
      dealNextStreet(state)
      state.toAct = nextToAct(state, state.button)
    }
  } else {
    // Betting is over for the hand; board (if incomplete) is dealt via advanceStreet()
    // so the server can pace the run-out for spectators.
    state.toAct = null
  }
}

function dealNextStreet(state: HandState): void {
  const deal = (n: number) => {
    for (let i = 0; i < n; i++) state.board.push(state.deck.shift()!)
  }
  if (state.street === 'preflop') {
    state.street = 'flop'
    deal(3)
  } else if (state.street === 'flop') {
    state.street = 'turn'
    deal(1)
  } else if (state.street === 'turn') {
    state.street = 'river'
    deal(1)
  } else {
    throw new InvalidActionError(`cannot deal after ${state.street}`)
  }
  for (const p of state.players) p.committed = 0
  state.currentBet = 0
  state.lastFullRaise = state.bigBlind
  state.actedSinceFullRaise = []
  state.seq++
}

/**
 * Advance one step of a run-out (betting finished, board incomplete or showdown pending).
 * Call repeatedly until the hand completes; the server inserts pauses between calls.
 */
export function advanceStreet(state: HandState): HandState {
  if (state.street === 'complete') throw new InvalidActionError('hand is complete')
  if (state.toAct !== null) throw new InvalidActionError('betting still in progress')
  if (state.street === 'river') resolveShowdown(state)
  else dealNextStreet(state)
  return state
}

/** Fast path: run the board out to completion with no pacing (tests, sim). */
export function runOut(state: HandState): HandState {
  while (state.street !== 'complete' && state.toAct === null) advanceStreet(state)
  return state
}

export function isComplete(state: HandState): boolean {
  return state.street === 'complete'
}

// ---------- resolution ----------

function finishByFold(state: HandState, winner: HandPlayer): void {
  refundUncalled(state)
  const pot = potSize(state)
  winner.chips += pot
  state.payouts = { [winner.seat]: pot }
  state.street = 'complete'
  state.toAct = null
  state.seq++
}

function resolveShowdown(state: HandState): void {
  refundUncalled(state)
  state.street = 'showdown'
  const contenders = state.players.filter((p) => !p.folded)

  // Side pots: slice contributions at each distinct total-committed level.
  const levels = [...new Set(state.players.filter((p) => p.totalCommitted > 0).map((p) => p.totalCommitted))].sort(
    (a, b) => a - b,
  )
  const pots: { amount: number; eligible: number[]; contested: boolean }[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    for (const p of state.players) amount += Math.max(0, Math.min(p.totalCommitted, level) - prev)
    let eligible = contenders.filter((p) => p.totalCommitted >= level).map((p) => p.seat)
    let contested = true
    if (eligible.length === 0) {
      // Every contributor to this slice folded — no live hand can claim it,
      // so it is returned to its (equal) contributors rather than burned.
      eligible = state.players.filter((p) => p.totalCommitted >= level).map((p) => p.seat)
      contested = false
    }
    if (amount > 0) pots.push({ amount, eligible, contested })
    prev = level
  }

  const payouts: Record<number, number> = {}
  for (const pot of pots) {
    const winners = pot.contested
      ? pickWinners(
          pot.eligible.map((seat) => ({ id: seat, cards: [...player(state, seat).holeCards, ...state.board] })),
        )
      : pot.eligible
    const share = Math.floor(pot.amount / winners.length)
    let remainder = pot.amount - share * winners.length
    // Odd chips go to the earliest winner left of the button.
    const ordered: number[] = []
    let s = state.button
    while (ordered.length < winners.length) {
      s = nextSeatInHand(state, s)
      if (winners.includes(s) && !ordered.includes(s)) ordered.push(s)
    }
    for (const seat of ordered) {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      const amount = share + extra
      payouts[seat] = (payouts[seat] ?? 0) + amount
      player(state, seat).chips += amount
    }
  }

  state.payouts = payouts
  state.showdown = contenders.map((p) => ({
    seat: p.seat,
    holeCards: p.holeCards,
    handName: describeHand([...p.holeCards, ...state.board]),
  }))
  state.street = 'complete'
  state.toAct = null
  state.seq++
}
