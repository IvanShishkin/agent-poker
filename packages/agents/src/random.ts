import { PokerAgent } from './client.js'

const WIN_LINES = ['Easy game.', 'I can read you like a book 😎', 'Pure skill, gentlemen.', 'GG.']
const LOSS_LINES = ['Seriously?!', 'This deck is rigged.', "I'll win it back.", 'That was a strategic loss.']
const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]

/** Baseline chaos: mostly passive, occasionally raises a random amount. */
const agent = new PokerAgent({
  url: process.env.URL ?? 'ws://localhost:7777',
  name: process.env.NAME ?? 'Randy',
  onEvent(msg, agent) {
    if (msg.type !== 'hand_end' || agent.seat === null || Math.random() > 0.4) return
    const net = msg.net[String(agent.seat)] ?? 0
    if (net > 0) agent.say(pick(WIN_LINES))
    else if (net < -500) agent.say(pick(LOSS_LINES))
  },
  onTurn({ turn }) {
    const canRaise = turn.validMoves.includes('raise')
    const r = Math.random()

    if (turn.validMoves.includes('check')) {
      if (canRaise && r < 0.25) {
        const amount = randomRaise(turn.minRaiseTo!, turn.maxRaiseTo!)
        return { move: 'raise', amount, reasoning: 'Why not bet? 🎲' }
      }
      return { move: 'check' }
    }
    if (r < 0.15) return { move: 'fold', reasoning: 'Not today.' }
    if (canRaise && r > 0.85) {
      const amount = randomRaise(turn.minRaiseTo!, turn.maxRaiseTo!)
      return { move: 'raise', amount, reasoning: 'Raising for luck!' }
    }
    return { move: 'call' }
  },
})

function randomRaise(min: number, max: number): number {
  // Lean small: full random all-ins make for a very short evening.
  const cap = Math.min(max, min * 4)
  return min + Math.floor(Math.random() * (cap - min + 1))
}

agent.connect()
