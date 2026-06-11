import type { Card, Move } from '@agent-poker/protocol'

const nf = new Intl.NumberFormat('en-US')

/** 1850 -> "1,850" */
export function fmt(n: number): string {
  return nf.format(n)
}

export interface CardParts {
  rank: string
  glyph: string
  red: boolean
}

const SUIT_GLYPHS: Record<string, { glyph: string; red: boolean }> = {
  s: { glyph: '♠', red: false }, // ♠
  h: { glyph: '♥', red: true }, // ♥
  d: { glyph: '♦', red: true }, // ♦
  c: { glyph: '♣', red: false }, // ♣
}

export function cardParts(card: Card): CardParts {
  const rank = card[0] === 'T' ? '10' : card[0]
  const suit = SUIT_GLYPHS[card[1]] ?? { glyph: '?', red: false }
  return { rank, glyph: suit.glyph, red: suit.red }
}

export function describeMove(move: Move, amount?: number): string {
  switch (move) {
    case 'fold':
      return 'folds'
    case 'check':
      return 'checks'
    case 'call':
      return amount != null ? `calls ${fmt(amount)}` : 'calls'
    case 'raise':
      return amount != null ? `raises to ${fmt(amount)}` : 'raises'
  }
}

/** Short, human-friendly slice of a hand id. */
export function shortHandId(handId: string): string {
  return handId.length > 10 ? `…${handId.slice(-6)}` : handId
}
