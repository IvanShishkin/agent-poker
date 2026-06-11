import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Card } from '@agent-poker/protocol'
import { fmt } from '../format'
import { PlayingCard } from './PlayingCard'

interface Props {
  board: Card[]
  pot: number
}

export function Board({ board, pot }: Props) {
  // Track previous board length so multi-card deals (the flop) stagger nicely.
  const prevLen = useRef(0)
  const baseIndex = Math.min(prevLen.current, board.length)
  useEffect(() => {
    prevLen.current = board.length
  }, [board.length])

  return (
    <div className="board">
      <AnimatePresence>
        {pot > 0 && (
          <motion.div
            className="pot"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
          >
            <span className="pot__chip" />
            Pot: {fmt(pot)}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="board__cards">
        <AnimatePresence>
          {board.map((card, i) => (
            <motion.div
              key={`${i}-${card}`}
              initial={{ opacity: 0, x: -36, rotateY: 90 }}
              animate={{ opacity: 1, x: 0, rotateY: 0 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
              transition={{
                duration: 0.45,
                delay: Math.max(0, i - baseIndex) * 0.14,
                ease: [0.2, 0.8, 0.3, 1],
              }}
              style={{ transformPerspective: 600 }}
            >
              <PlayingCard card={card} size="board" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
