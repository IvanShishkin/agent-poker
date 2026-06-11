import { fmt } from '../format'
import { usePolling, type Leaderboard as LeaderboardData } from '../api'

function Net({ value }: { value: number }) {
  return <span className={value >= 0 ? 'num--pos' : 'num--neg'}>{value > 0 ? `+${fmt(value)}` : fmt(value)}</span>
}

export function Leaderboard() {
  const { data, error } = usePolling<LeaderboardData>('/api/leaderboard', 5000)

  if (!data) {
    return <div className="view"><p className="view__note">{error ? 'API unreachable' : 'loading…'}</p></div>
  }

  const live = [...data.live].sort((a, b) => {
    if (a.place !== null || b.place !== null) return (a.place ?? 99) - (b.place ?? 99)
    return b.chips - a.chips
  })

  return (
    <div className="view">
      <div className="view__head">
        <span className={`badge ${data.mode === 'tournament' ? 'badge--gold' : ''}`}>
          {data.mode === 'tournament' ? 'TOURNAMENT' : 'CASH'}
        </span>
        <span className="view__blinds">
          blinds {fmt(data.blinds.smallBlind)}/{fmt(data.blinds.bigBlind)}
          {data.mode === 'tournament' ? ` · level ${data.blinds.level + 1}` : ''}
        </span>
        {error && <span className="view__note">API unreachable</span>}
      </div>
      {data.tournamentOver && <div className="banner">Tournament over</div>}

      <h3 className="view__section">At the table</h3>
      <table className="stats">
        <thead>
          <tr><th></th><th>player</th><th>stack</th><th>net</th><th>hands</th><th>bb/100</th></tr>
        </thead>
        <tbody>
          {live.map((p) => (
            <tr key={p.seat} className={p.eliminated ? 'stats__row--out' : ''}>
              <td>{p.place === 1 ? '🏆' : (p.place ?? '—')}</td>
              <td>{p.name}{p.eliminated ? <span className="stats__out"> out</span> : ''}</td>
              <td>{fmt(p.chips)}</td>
              <td><Net value={p.net} /></td>
              <td>{p.hands}</td>
              <td>{p.bb100}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="view__section">All time</h3>
      <table className="stats">
        <thead>
          <tr><th>#</th><th>player</th><th>net</th><th>hands</th><th>bb/100</th></tr>
        </thead>
        <tbody>
          {data.allTime.map((p, i) => (
            <tr key={p.name}>
              <td>{i + 1}</td>
              <td>{p.name}</td>
              <td><Net value={p.net} /></td>
              <td>{p.hands}</td>
              <td>{p.bb100}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
