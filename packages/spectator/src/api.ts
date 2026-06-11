import { useEffect, useState } from 'react'
import type { Card } from '@agent-poker/protocol'

/** Derive the HTTP API base from the ws URL: ws://host:port/?x → http://host:port */
export function apiBase(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('ws')
  if (fromQuery) {
    const u = new URL(fromQuery.replace(/^ws/, 'http'))
    return `${u.protocol}//${u.host}`
  }
  // Vite dev server: the table runs separately on 7777.
  if (window.location.port === '5173') return 'http://localhost:7777'
  // Served by the table itself (hosting mode): same origin.
  return `${window.location.protocol}//${window.location.host}`
}

export interface LiveEntry {
  seat: number
  name: string
  chips: number
  net: number
  hands: number
  bb100: number
  eliminated: boolean
  place: number | null
}

export interface Leaderboard {
  mode: 'cash' | 'tournament'
  tournamentOver: boolean
  blinds: { smallBlind: number; bigBlind: number; level: number }
  seats: { taken: number; max: number }
  live: LiveEntry[]
  allTime: { name: string; net: number; hands: number; bb100: number }[]
}

export interface HandRecord {
  ts: string
  handId: string
  button: number
  bigBlind?: number
  board: Card[]
  players: { seat: number; name: string; hole: Card[]; start: number; end: number; folded: boolean }[]
  payouts: Record<string, number>
  showdown?: { seat: number; holeCards: Card[]; handName: string }[]
}

/** Poll a JSON endpoint while the component is mounted; keeps last good data on errors. */
export function usePolling<T>(path: string, intervalMs: number): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${apiBase()}${path}`)
        if (!res.ok) throw new Error(String(res.status))
        const json = (await res.json()) as T
        if (alive) {
          setData(json)
          setError(false)
        }
      } catch {
        if (alive) setError(true)
      }
    }
    void load()
    const timer = setInterval(load, intervalMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [path, intervalMs])

  return { data, error }
}
