import { freshDeck, type Card } from './cards.js'
import { pickWinners } from './evaluate.js'
import { mulberry32 } from './rng.js'

export interface EquityInput {
  /** Community cards on the table (0, 3, 4 or 5). */
  board: Card[]
  /** Live (non-folded) contenders. */
  players: { seat: number; holeCards: Card[] }[]
  /** Hole cards of folded players — dead, removed from the run-out deck. */
  deadHoleCards?: Card[]
}

/** Above this many board completions we sample instead of enumerating (preflop). */
const EXACT_LIMIT = 25_000
const SAMPLES = 3000

/**
 * Probability each live player wins the hand given the current board, by completing
 * the board over the remaining deck. Exact enumeration for flop/turn/river; Monte
 * Carlo (seeded, deterministic) for preflop where the full enumeration is huge.
 * Ties split the win equally. Returns seat -> share in [0,1] (sums to ~1).
 */
export function handEquity(input: EquityInput): Record<number, number> {
  const { board, players } = input
  const out: Record<number, number> = {}
  if (players.length === 0) return out
  if (players.length === 1) {
    out[players[0].seat] = 1
    return out
  }

  const known = new Set<Card>([
    ...board,
    ...(input.deadHoleCards ?? []),
    ...players.flatMap((p) => p.holeCards),
  ])
  const remaining = freshDeck().filter((c) => !known.has(c))
  const needed = 5 - board.length

  const tally: Record<number, number> = {}
  for (const p of players) tally[p.seat] = 0
  let total = 0

  const score = (completion: Card[]) => {
    const full = completion.length ? [...board, ...completion] : board
    const winners = pickWinners(players.map((p) => ({ id: p.seat, cards: [...p.holeCards, ...full] })))
    const share = 1 / winners.length
    for (const id of winners) tally[id] += share
    total++
  }

  if (needed <= 0) {
    score([])
  } else if (nChooseK(remaining.length, needed) <= EXACT_LIMIT) {
    enumerate(remaining, needed, score)
  } else {
    const rand = mulberry32(seedFrom(known))
    for (let i = 0; i < SAMPLES; i++) score(sample(remaining, needed, rand))
  }

  for (const p of players) out[p.seat] = total ? tally[p.seat] / total : 0
  return out
}

function nChooseK(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

/** Enumerate every k-combination of `arr`, invoking `cb` with each. */
function enumerate(arr: Card[], k: number, cb: (combo: Card[]) => void): void {
  const combo: Card[] = []
  const walk = (start: number) => {
    if (combo.length === k) {
      cb(combo)
      return
    }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i])
      walk(i + 1)
      combo.pop()
    }
  }
  walk(0)
}

/** k distinct cards drawn via partial Fisher–Yates on a copy. */
function sample(arr: Card[], k: number, rand: () => number): Card[] {
  const pool = arr.slice()
  const out: Card[] = []
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
    out.push(pool[i])
  }
  return out
}

/** Stable 32-bit seed from the dealt cards, so sampled equity is reproducible. */
function seedFrom(cards: Set<Card>): number {
  let h = 2166136261
  for (const c of [...cards].sort()) {
    for (let i = 0; i < c.length; i++) {
      h ^= c.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}
