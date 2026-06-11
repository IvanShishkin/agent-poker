import { describe, expect, it } from 'vitest'
import {
  advanceStreet,
  applyAction,
  createHand,
  isComplete,
  legalActions,
  mulberry32,
  potSize,
  runOut,
  type CreateHandOpts,
  InvalidActionError,
} from '../src/index.js'

function makeHand(stacks: number[], overrides: Partial<CreateHandOpts> = {}) {
  return createHand({
    handId: 'h1',
    players: stacks.map((chips, i) => ({ seat: i + 1, name: `P${i + 1}`, chips })),
    button: 1,
    smallBlind: 50,
    bigBlind: 100,
    seed: 42,
    ...overrides,
  })
}

describe('dealing', () => {
  it('is deterministic for the same seed and differs across seeds', () => {
    const a = makeHand([10000, 10000, 10000], { seed: 7 })
    const b = makeHand([10000, 10000, 10000], { seed: 7 })
    const c = makeHand([10000, 10000, 10000], { seed: 8 })
    expect(a.players.map((p) => p.holeCards)).toEqual(b.players.map((p) => p.holeCards))
    expect(a.players.map((p) => p.holeCards)).not.toEqual(c.players.map((p) => p.holeCards))
    const all = a.players.flatMap((p) => p.holeCards)
    expect(new Set(all).size).toBe(6)
  })
})

describe('blinds and order', () => {
  it('3-handed: SB/BB posted, UTG acts first', () => {
    const s = makeHand([10000, 10000, 10000])
    const sb = s.players.find((p) => p.seat === 2)!
    const bb = s.players.find((p) => p.seat === 3)!
    expect(sb.committed).toBe(50)
    expect(bb.committed).toBe(100)
    expect(s.toAct).toBe(1) // button is UTG 3-handed
  })

  it('heads-up: button posts SB and acts first preflop, BB first postflop', () => {
    const s = makeHand([10000, 10000])
    expect(s.players.find((p) => p.seat === 1)!.committed).toBe(50)
    expect(s.players.find((p) => p.seat === 2)!.committed).toBe(100)
    expect(s.toAct).toBe(1)
    applyAction(s, 1, { move: 'call' })
    applyAction(s, 2, { move: 'check' })
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(2)
  })

  it('BB gets the option after limps and can raise', () => {
    const s = makeHand([10000, 10000, 10000])
    applyAction(s, 1, { move: 'call' })
    applyAction(s, 2, { move: 'call' })
    expect(s.toAct).toBe(3)
    const la = legalActions(s)
    expect(la.moves).toContain('check')
    expect(la.moves).toContain('raise')
    applyAction(s, 3, { move: 'raise', amount: 300 })
    expect(s.toAct).toBe(1)
  })
})

describe('fold endings and refunds', () => {
  it('fold to BB: blinds go to BB, uncalled part refunded', () => {
    const s = makeHand([10000, 10000])
    applyAction(s, 1, { move: 'fold' })
    expect(isComplete(s)).toBe(true)
    expect(s.payouts).toEqual({ 2: 100 })
    expect(s.players.find((p) => p.seat === 1)!.chips).toBe(9950)
    expect(s.players.find((p) => p.seat === 2)!.chips).toBe(10050)
  })

  it('uncalled raise is refunded to the aggressor', () => {
    const s = makeHand([10000, 10000])
    applyAction(s, 1, { move: 'raise', amount: 500 })
    applyAction(s, 2, { move: 'fold' })
    expect(s.players.find((p) => p.seat === 1)!.chips).toBe(10100)
    expect(s.players.find((p) => p.seat === 2)!.chips).toBe(9900)
  })
})

describe('raising rules', () => {
  it('enforces the minimum raise and tracks re-raise sizes', () => {
    const s = makeHand([10000, 10000])
    expect(() => applyAction(s, 1, { move: 'raise', amount: 150 })).toThrow(InvalidActionError)
    applyAction(s, 1, { move: 'raise', amount: 200 })
    const la = legalActions(s)
    expect(la.minRaiseTo).toBe(300)
    expect(la.maxRaiseTo).toBe(10000)
  })

  it('short all-in does not reopen betting for players who already acted', () => {
    const s = makeHand([10000, 10000, 450])
    applyAction(s, 1, { move: 'raise', amount: 300 })
    applyAction(s, 2, { move: 'call' })
    // BB: max 450 < min raise 500 — only legal as all-in, and it is a short raise
    expect(legalActions(s).minRaiseTo).toBe(450)
    applyAction(s, 3, { move: 'raise', amount: 450 })
    const la1 = legalActions(s)
    expect(s.toAct).toBe(1)
    expect(la1.moves).not.toContain('raise')
    expect(la1.toCall).toBe(150)
    applyAction(s, 1, { move: 'call' })
    expect(legalActions(s).moves).not.toContain('raise')
    applyAction(s, 2, { move: 'call' })
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(2)
  })

  it('rejects acting out of turn and checking a bet', () => {
    const s = makeHand([10000, 10000, 10000])
    expect(() => applyAction(s, 2, { move: 'call' })).toThrow(InvalidActionError)
    expect(() => applyAction(s, 1, { move: 'check' })).toThrow(InvalidActionError)
  })
})

describe('showdown and side pots', () => {
  it('splits main and side pots across different stack sizes', () => {
    // seats: 1=9000 (72o), 2=1000 (AA), 3=3000 (KK); button=1
    // deal order is 2,3,1 twice; then 5 board cards
    const deck = [
      'As', 'Ks', '7h',
      'Ad', 'Kd', '2h',
      '3c', '4c', '5d', '8d', '9s',
      '6h', '6d', '6c', 'Th',
    ]
    const s = makeHand([9000, 1000, 3000], { deck })
    applyAction(s, 1, { move: 'raise', amount: 3000 })
    applyAction(s, 2, { move: 'call' }) // all-in 1000
    applyAction(s, 3, { move: 'call' }) // all-in 3000
    expect(s.toAct).toBe(null)
    runOut(s)
    expect(isComplete(s)).toBe(true)
    // main pot 3000 -> AA (seat 2), side pot 4000 -> KK (seat 3)
    expect(s.payouts).toEqual({ 2: 3000, 3: 4000 })
    expect(s.players.find((p) => p.seat === 1)!.chips).toBe(6000)
    expect(s.players.find((p) => p.seat === 2)!.chips).toBe(3000)
    expect(s.players.find((p) => p.seat === 3)!.chips).toBe(4000)
    expect(s.showdown).toHaveLength(3)
  })

  it('splits the pot when the board plays for both', () => {
    // straight on board, both hole hands irrelevant
    const deck = [
      '2c', '2h', '3s', '3d',
      'Ts', 'Js', 'Qd', 'Kh', '9c',
      '6h', '6d',
    ]
    const s = makeHand([10000, 10000], { deck })
    applyAction(s, 1, { move: 'call' })
    applyAction(s, 2, { move: 'check' })
    for (let i = 0; i < 3; i++) {
      applyAction(s, 2, { move: 'check' })
      applyAction(s, 1, { move: 'check' })
    }
    expect(isComplete(s)).toBe(true)
    expect(s.payouts).toEqual({ 1: 100, 2: 100 })
    expect(s.players.every((p) => p.chips === 10000)).toBe(true)
  })
})

describe('fuzz: chip conservation over random hands', () => {
  it('never loses or mints chips across 300 random hands', () => {
    const rand = mulberry32(20260610)
    for (let iter = 0; iter < 300; iter++) {
      const n = 2 + Math.floor(rand() * 5)
      const stacks = Array.from({ length: n }, () => 100 + Math.floor(rand() * 20000))
      const total = stacks.reduce((a, b) => a + b, 0)
      const button = 1 + Math.floor(rand() * n)
      const s = createHand({
        handId: `fuzz-${iter}`,
        players: stacks.map((chips, i) => ({ seat: i + 1, name: `P${i + 1}`, chips })),
        button,
        smallBlind: 50,
        bigBlind: 100,
        seed: iter,
      })
      let guard = 0
      while (!isComplete(s)) {
        if (++guard > 500) throw new Error(`hand ${iter} did not terminate`)
        if (s.toAct === null) {
          advanceStreet(s)
          continue
        }
        const la = legalActions(s)
        const move = la.moves[Math.floor(rand() * la.moves.length)]
        if (move === 'raise') {
          const span = la.maxRaiseTo! - la.minRaiseTo!
          const amount = la.minRaiseTo! + Math.floor(rand() * (span + 1))
          applyAction(s, s.toAct, { move, amount })
        } else {
          applyAction(s, s.toAct, { move })
        }
      }
      const after = s.players.reduce((sum, p) => sum + p.chips, 0)
      expect(after, `hand ${iter} chip conservation`).toBe(total)
      if (s.showdown) expect(s.board).toHaveLength(5)
      const paid = Object.values(s.payouts).reduce((a, b) => a + b, 0)
      expect(paid, `hand ${iter} payouts equal pot`).toBe(potSize(s))
    }
  })
})
