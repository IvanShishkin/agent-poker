import { motion } from 'framer-motion'
import { seatPos } from '../seatLayout'
import type { Bubble } from '../state'

export function ReasoningBubble({ bubble }: { bubble: Bubble }) {
  const pos = seatPos(bubble.seat)
  // Choose which side of the seat the bubble sits on so it stays over the felt.
  const side: 'left' | 'right' = pos.x > 65 ? 'left' : 'right'
  const vAlign: 'above' | 'below' = pos.y < 35 ? 'below' : 'above'

  const style: React.CSSProperties = {
    top: `${vAlign === 'above' ? pos.y - 9 : pos.y + 9}%`,
  }
  if (side === 'right') style.left = `${Math.min(pos.x + 8, 72)}%`
  else style.right = `${Math.min(100 - pos.x + 8, 72)}%`

  return (
    <motion.div
      className={`bubble bubble--${side} bubble--${vAlign}`}
      style={style}
      initial={{ opacity: 0, scale: 0.7, y: vAlign === 'above' ? 8 : -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.5 } }}
      transition={{ type: 'spring', stiffness: 350, damping: 24 }}
    >
      <div className="bubble__name">{bubble.name}</div>
      <div className="bubble__text">{bubble.text}</div>
      <span className="bubble__dot bubble__dot--1" />
      <span className="bubble__dot bubble__dot--2" />
    </motion.div>
  )
}
