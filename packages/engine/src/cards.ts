import { mulberry32 } from './rng.js'

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS = ['s', 'h', 'd', 'c'] as const

/** Card as '<rank><suit>', e.g. 'As', 'Td' — the format pokersolver expects. */
export type Card = string

export function freshDeck(): Card[] {
  const deck: Card[] = []
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s)
  return deck
}

export function shuffledDeck(seed: number): Card[] {
  const rand = mulberry32(seed)
  const deck = freshDeck()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}
