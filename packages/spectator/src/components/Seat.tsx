import { AnimatePresence, motion } from 'framer-motion'
import type { PublicPlayer } from '@agent-poker/protocol'
import { fmt } from '../format'
import { seatPos } from '../seatLayout'
import type { WinnerInfo } from '../state'
import { PlayingCard } from './PlayingCard'

interface Props {
  player: PublicPlayer
  isToAct: boolean
  isWinner: boolean
  winner?: WinnerInfo
  handName?: string
  /** Showdown / hand over: face all cards up even for folded players' hidden cards. */
  handOver: boolean
  handId: string | null
}

export function Seat({ player, isToAct, isWinner, winner, handName, handOver, handId }: Props) {
  const pos = seatPos(player.seat)
  const out = player.sittingOut
  const folded = player.folded

  const classes = ['seat']
  if (isToAct) classes.push('seat--active')
  if (isWinner) classes.push('seat--winner')
  if (folded || out) classes.push('seat--folded')

  return (
    <div className={classes.join(' ')} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <div className="seat__cards">
        {out ? null : player.holeCards ? (
          player.holeCards.map((c, i) => (
            <PlayingCard key={`${handId}-${i}-${c}`} card={c} dim={folded} />
          ))
        ) : (
          <>
            <PlayingCard faceDown dim={folded} />
            <PlayingCard faceDown dim={folded} />
          </>
        )}
      </div>

      <div className="seat__plate">
        <div className="seat__name">
          {!player.connected && <span className="seat__offline" title="disconnected" />}
          {player.name}
        </div>
        <div className="seat__chips">{out ? 'sitting out' : fmt(player.chips)}</div>
      </div>

      {player.allIn && !folded && <div className="seat__badge seat__badge--allin">ALL-IN</div>}

      <AnimatePresence>
        {isWinner && winner && (
          <motion.div
            key={`win-${handId}`}
            className="seat__payout"
            initial={{ opacity: 0, y: 6, scale: 0.8 }}
            animate={{ opacity: 1, y: -34, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          >
            +{fmt(winner.payout)}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {handOver && handName && (
          <motion.div
            key={`hn-${handId}`}
            className={`seat__handname${isWinner ? ' seat__handname--winner' : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {handName}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
