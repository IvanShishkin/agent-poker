import type { Card } from '@agent-poker/protocol'
import { cardParts } from '../format'

interface Props {
  card?: Card
  faceDown?: boolean
  dim?: boolean
  size?: 'board' | 'hole'
}

export function PlayingCard({ card, faceDown, dim, size = 'hole' }: Props) {
  const classes = ['card', `card--${size}`]
  if (dim) classes.push('card--dim')

  if (faceDown || !card) {
    classes.push('card--back')
    return (
      <div className={classes.join(' ')}>
        <div className="card__back-pattern" />
      </div>
    )
  }

  const { rank, glyph, red } = cardParts(card)
  classes.push(red ? 'card--red' : 'card--black')
  return (
    <div className={classes.join(' ')}>
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{glyph}</span>
    </div>
  )
}
