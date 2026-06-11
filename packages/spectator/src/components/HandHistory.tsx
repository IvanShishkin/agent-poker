import { useState } from 'react'
import type { Card } from '@agent-poker/protocol'
import { cardParts, fmt } from '../format'
import { usePolling, type HandRecord } from '../api'

function MiniCards({ cards }: { cards: Card[] }) {
  return (
    <span className="log__cards">
      {cards.map((c, i) => {
        const p = cardParts(c)
        return (
          <span key={i} className={`log__card ${p.red ? 'log__card--red' : ''}`}>
            {p.rank}{p.glyph}
          </span>
        )
      })}
    </span>
  )
}

function time(ts: string): string {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ru-RU')
}

function HandRow({ hand }: { hand: HandRecord }) {
  const [open, setOpen] = useState(false)
  const winners = Object.entries(hand.payouts)
    .filter(([, amount]) => amount > 0)
    .map(([seat, amount]) => {
      const p = hand.players.find((p) => p.seat === Number(seat))
      return `${p?.name ?? `Seat ${seat}`} +${fmt(amount)}`
    })
    .join(', ')

  return (
    <div className={`hand ${open ? 'hand--open' : ''}`} onClick={() => setOpen(!open)}>
      <div className="hand__row">
        <span className="hand__id">{hand.handId}</span>
        <span className="hand__time">{time(hand.ts)}</span>
        <MiniCards cards={hand.board} />
        <span className="hand__winners">{winners}</span>
      </div>
      {open && (
        <div className="hand__detail">
          {hand.players.map((p) => {
            const net = p.end - p.start
            const sd = hand.showdown?.find((e) => e.seat === p.seat)
            return (
              <div key={p.seat} className={`hand__player ${p.folded ? 'hand__player--folded' : ''}`}>
                <span className="hand__pname">{p.name}</span>
                <MiniCards cards={p.hole} />
                <span className={net >= 0 ? 'num--pos' : 'num--neg'}>
                  {net > 0 ? `+${fmt(net)}` : fmt(net)}
                </span>
                <span className="hand__pextra">
                  {p.folded ? 'fold' : (sd?.handName ?? '')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function HandHistory() {
  const { data, error } = usePolling<HandRecord[]>('/api/hands?limit=100', 10000)

  if (!data) {
    return <div className="view"><p className="view__note">{error ? 'API unreachable' : 'loading…'}</p></div>
  }
  return (
    <div className="view">
      <div className="view__head">
        <span className="badge">LAST {data.length} HANDS</span>
        {error && <span className="view__note">API unreachable</span>}
      </div>
      {data.map((h) => (
        <HandRow key={`${h.ts}-${h.handId}`} hand={h} />
      ))}
    </div>
  )
}
