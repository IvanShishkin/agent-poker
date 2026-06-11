import { createRequire } from 'node:module'
import type { Card } from './cards.js'

// pokersolver is untyped CJS — load via require and type the surface we use.
const require = createRequire(import.meta.url)
const { Hand } = require('pokersolver') as {
  Hand: {
    solve(cards: string[]): { rank: number; descr: string; name: string }
    winners(hands: unknown[]): unknown[]
  }
}

/** Human-readable name of the best 5-card hand from the given cards. */
export function describeHand(cards: Card[]): string {
  return Hand.solve(cards).descr
}

/** 1 = high card … 9 = straight flush. */
export function handRank(cards: Card[]): number {
  return Hand.solve(cards).rank
}

/** Given (id, cards) entries, return ids of the winning (possibly tied) hands. */
export function pickWinners(entries: { id: number; cards: Card[] }[]): number[] {
  const hands = entries.map((e) => {
    const h = Hand.solve(e.cards) as { __id?: number }
    h.__id = e.id
    return h
  })
  return (Hand.winners(hands) as { __id: number }[]).map((h) => h.__id)
}
