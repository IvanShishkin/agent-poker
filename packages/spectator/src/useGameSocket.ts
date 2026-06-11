import { useEffect, useReducer } from 'react'
import { parseServerMsg } from '@agent-poker/protocol'
import { initialState, reducer, type Action, type GameState } from './state'

function wsUrl(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('ws')
  if (fromQuery) return fromQuery
  // Vite dev server: the table runs separately on 7777.
  if (window.location.port === '5173') return 'ws://localhost:7777'
  // Served by the table itself (hosting mode): same origin.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
}

const BUBBLE_TTL_MS = 6000

export function useGameSocket(): [GameState, React.Dispatch<Action>] {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    const url = wsUrl()
    let ws: WebSocket | null = null
    let disposed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      if (disposed) return
      dispatch({ type: 'conn', status: attempt === 0 ? 'connecting' : 'reconnecting' })
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      ws.onopen = () => {
        attempt = 0
        dispatch({ type: 'conn', status: 'connected' })
        ws?.send(JSON.stringify({ type: 'subscribe' }))
      }
      ws.onmessage = (ev) => {
        try {
          dispatch({ type: 'msg', msg: parseServerMsg(String(ev.data)) })
        } catch (err) {
          console.warn('Unparseable server message', err)
        }
      }
      ws.onclose = () => {
        ws = null
        scheduleReconnect()
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    function scheduleReconnect() {
      if (disposed) return
      dispatch({ type: 'conn', status: 'reconnecting' })
      const delay = Math.min(10_000, 500 * 2 ** attempt)
      attempt += 1
      timer = setTimeout(connect, delay)
    }

    connect()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [])

  // Expire reasoning bubbles ~6s after they appear.
  useEffect(() => {
    if (state.bubbles.length === 0) return
    const timers = state.bubbles.map((b) =>
      setTimeout(() => dispatch({ type: 'bubble_expire', id: b.id }), BUBBLE_TTL_MS),
    )
    return () => timers.forEach(clearTimeout)
    // Re-keying on ids only: a new bubble restarts only its own timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bubbles.map((b) => b.id).join(',')])

  return [state, dispatch]
}
