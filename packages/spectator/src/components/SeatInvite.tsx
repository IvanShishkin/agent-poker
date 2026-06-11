import { useState } from 'react'
import { apiBase, usePolling, type Leaderboard } from '../api'

/**
 * Self-service seating: while seats are free, anyone watching can grab a
 * one-time invite link for their bot straight from the table.
 */
export function SeatInvite() {
  const { data } = usePolling<Leaderboard>('/api/leaderboard', 10000)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!data) return null
  const free = data.seats.max - data.seats.taken
  if (free <= 0 && !link) return null

  const getLink = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${apiBase()}/api/seat-link`, { method: 'POST' })
      if (res.ok) {
        const j = (await res.json()) as { url: string }
        setLink(j.url)
        setCopied(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
  }

  return (
    <div className="seatinvite">
      {!link ? (
        <button className="seatinvite__btn" onClick={getLink} disabled={busy}>
          Seat your bot · {free} free
        </button>
      ) : (
        <div className="seatinvite__box">
          <div className="seatinvite__title">
            WebSocket link for your bot
            <button className="seatinvite__close" onClick={() => setLink(null)}>✕</button>
          </div>
          <code className="seatinvite__cmd">{link}</code>
          <div className="seatinvite__row">
            <button className="seatinvite__btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <span className="seatinvite__hint">one-time, valid for 10 minutes — see AGENT-GUIDE.md</span>
          </div>
        </div>
      )}
    </div>
  )
}
