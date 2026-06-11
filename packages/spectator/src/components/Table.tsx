import { AnimatePresence, motion } from 'framer-motion'
import { fmt } from '../format'
import { betPos, buttonPos, towardPotPx } from '../seatLayout'
import type { GameState } from '../state'
import { Board } from './Board'
import { ReasoningBubble } from './ReasoningBubble'
import { Seat } from './Seat'

export function Table({ state }: { state: GameState }) {
  const players = [...state.players].sort((a, b) => a.seat - b.seat)
  const btn = state.button != null ? buttonPos(state.button) : null

  return (
    <div className="table-area">
      <div className="felt">
        <div className="felt__inner-ring" />
        <div className="felt__logo">AGENT&nbsp;POKER</div>
        {players.length === 0 && (
          <div className="felt__waiting">
            {state.conn === 'connected' ? 'Waiting for players…' : 'Connecting to table…'}
          </div>
        )}
        <Board board={state.board} pot={state.pot} />
      </div>

      {/* Street bets — sweep toward the pot when they leave (street change). */}
      <AnimatePresence>
        {players
          .filter((p) => p.bet > 0)
          .map((p) => {
            const pos = betPos(p.seat)
            const sweep = towardPotPx(p.seat)
            return (
              <motion.div
                key={`bet-${p.seat}`}
                className="bet"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ x: sweep.x, y: sweep.y, opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.45, ease: 'easeInOut' }}
              >
                <span className="bet__chip" />
                {fmt(p.bet)}
              </motion.div>
            )
          })}
      </AnimatePresence>

      {/* Dealer button */}
      {btn && (
        <motion.div
          className="dealer-button"
          animate={{ left: `${btn.x}%`, top: `${btn.y}%` }}
          initial={false}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          D
        </motion.div>
      )}

      {players.map((p) => (
        <Seat
          key={p.seat}
          player={p}
          handId={state.handId}
          isToAct={!state.handOver && state.toAct === p.seat}
          isWinner={state.handOver && p.seat in state.winners}
          winner={state.winners[p.seat]}
          handName={state.handNames[p.seat]}
          handOver={state.handOver}
        />
      ))}

      {/* Reasoning bubbles (system messages with no seated player stay in the log only) */}
      <AnimatePresence>
        {state.bubbles
          .filter((b) => state.players.some((p) => p.seat === b.seat))
          .map((b) => (
            <ReasoningBubble key={b.id} bubble={b} />
          ))}
      </AnimatePresence>
    </div>
  )
}
