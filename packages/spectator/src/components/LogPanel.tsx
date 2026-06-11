import { useEffect, useRef } from 'react'
import type { Card } from '@agent-poker/protocol'
import { cardParts, fmt } from '../format'
import type { ConnStatus, GameState, LogLine } from '../state'

function InlineCards({ cards }: { cards: Card[] }) {
  return (
    <span className="log__cards">
      {cards.map((c, i) => {
        const { rank, glyph, red } = cardParts(c)
        return (
          <span key={i} className={`log__card ${red ? 'log__card--red' : ''}`}>
            {rank}
            {glyph}
          </span>
        )
      })}
    </span>
  )
}

const CONN_LABEL: Record<ConnStatus, string> = {
  connecting: 'connecting…',
  connected: 'live',
  reconnecting: 'reconnecting…',
}

export function LogPanel({ state }: { state: GameState }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastId = state.log.length ? state.log[state.log.length - 1].id : 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  return (
    <aside className="panel">
      <header className="panel__header">
        <h1 className="panel__title">Agent Poker</h1>
        <div className={`conn conn--${state.conn}`}>
          <span className="conn__dot" />
          {CONN_LABEL[state.conn]}
        </div>
      </header>
      {state.smallBlind != null && state.bigBlind != null && (
        <div className="panel__blinds">
          Blinds {fmt(state.smallBlind)}/{fmt(state.bigBlind)}
        </div>
      )}
      <div className="panel__log" ref={scrollRef}>
        {state.log.map((l: LogLine) => (
          <div key={l.id} className={`log__line log__line--${l.kind}`}>
            {l.text}
            {l.cards && <InlineCards cards={l.cards} />}
          </div>
        ))}
        {state.log.length === 0 && <div className="log__line log__line--info">Waiting for action…</div>}
      </div>
    </aside>
  )
}
