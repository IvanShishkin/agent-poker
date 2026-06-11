import { handRank } from '@agent-poker/engine'
import type { Card } from '@agent-poker/protocol'
import { PokerAgent, type Decision, type TurnContext } from './client.js'

const RANK_ORDER = '23456789TJQKA'

/** Chen formula: classic starting-hand score (AA=20, AKs=12, 72o≈-1). */
function chenScore(cards: Card[]): number {
  const [a, b] = cards
  const value = (c: Card) => {
    const r = c[0]
    if (r === 'A') return 10
    if (r === 'K') return 8
    if (r === 'Q') return 7
    if (r === 'J') return 6
    return (RANK_ORDER.indexOf(r) + 2) / 2
  }
  const hi = Math.max(value(a), value(b))
  const idxA = RANK_ORDER.indexOf(a[0])
  const idxB = RANK_ORDER.indexOf(b[0])
  const pair = a[0] === b[0]
  let score = pair ? Math.max(5, hi * 2) : hi
  if (!pair && a[1] === b[1]) score += 2
  const gap = pair ? 0 : Math.abs(idxA - idxB) - 1
  if (gap === 1) score -= 1
  else if (gap === 2) score -= 2
  else if (gap === 3) score -= 4
  else if (gap >= 4) score -= 5
  if (!pair && gap <= 1 && Math.max(idxA, idxB) < RANK_ORDER.indexOf('Q')) score += 1
  return Math.ceil(score)
}

const HAND_NAMES = ['', 'high card', 'a pair', 'two pair', 'a set', 'a straight', 'a flush', 'a full house', 'quads', 'a straight flush']

function preflop(ctx: TurnContext): Decision {
  const { turn, bigBlind, holeCards } = ctx
  const score = chenScore(holeCards)
  const canRaise = turn.validMoves.includes('raise')
  const free = turn.validMoves.includes('check')

  if (score >= 10 && canRaise) {
    const amount = Math.min(turn.maxRaiseTo!, Math.max(turn.minRaiseTo!, bigBlind * 3 + turn.toCall * 2))
    return { move: 'raise', amount, reasoning: `Strong hand (Chen ${score}) — raising to ${amount}.` }
  }
  if (score >= 8) {
    if (free) return { move: 'check' }
    if (turn.toCall <= bigBlind * 4) return { move: 'call', reasoning: `Decent hand (Chen ${score}) — calling.` }
    return { move: 'fold', reasoning: 'Decent hand, but the price is too high.' }
  }
  if (score >= 6 && turn.toCall <= bigBlind) {
    return free ? { move: 'check' } : { move: 'call' }
  }
  if (free) return { move: 'check' }
  return { move: 'fold', reasoning: `Weak starter (Chen ${score}) — folding.` }
}

function postflop(ctx: TurnContext): Decision {
  const { turn, holeCards, board, pot } = ctx
  const rank = handRank([...holeCards, ...board])
  const made = HAND_NAMES[rank] ?? '?'
  const canRaise = turn.validMoves.includes('raise')
  const free = turn.validMoves.includes('check')

  if (rank >= 4) {
    if (canRaise) {
      const amount = Math.min(turn.maxRaiseTo!, Math.max(turn.minRaiseTo!, Math.floor(pot * 0.75)))
      return { move: 'raise', amount, reasoning: `I have ${made} — betting ${amount}.` }
    }
    return free ? { move: 'check' } : { move: 'call', reasoning: `Not letting go of ${made}.` }
  }
  if (rank === 3) {
    if (free && canRaise) {
      const amount = Math.min(turn.maxRaiseTo!, Math.max(turn.minRaiseTo!, Math.floor(pot * 0.5)))
      return { move: 'raise', amount, reasoning: 'Two pair — betting for value.' }
    }
    if (free) return { move: 'check' }
    if (turn.toCall <= pot) return { move: 'call', reasoning: 'Two pair — calling a reasonable bet.' }
    return { move: 'fold', reasoning: 'Two pair, but the pressure is too much.' }
  }
  if (rank === 2) {
    if (free) return { move: 'check' }
    if (turn.toCall <= Math.floor(pot * 0.35)) return { move: 'call', reasoning: 'A pair — taking a cheap look.' }
    return { move: 'fold', reasoning: 'One pair against a big bet — fold.' }
  }
  if (free) return { move: 'check' }
  return { move: 'fold', reasoning: 'Missed the board — folding.' }
}

const agent = new PokerAgent({
  url: process.env.URL ?? 'ws://localhost:7777',
  name: process.env.NAME ?? 'TAG-Bot',
  onTurn(ctx) {
    return ctx.board.length === 0 ? preflop(ctx) : postflop(ctx)
  },
  onEvent(msg, agent) {
    if (msg.type === 'hand_end' && agent.seat !== null) {
      const net = msg.net[String(agent.seat)] ?? 0
      const sd = msg.showdown?.find((e) => e.seat === agent.seat)
      if (net > 2000 && sd) agent.say(`Discipline pays: ${sd.handName}.`)
    }
    // Never leave trash talk unanswered.
    if (msg.type === 'chat_event' && msg.seat !== agent.seat && /easy|skill/i.test(msg.text) && Math.random() < 0.5) {
      agent.say("We'll see in the long run.")
    }
  },
})

agent.connect()
