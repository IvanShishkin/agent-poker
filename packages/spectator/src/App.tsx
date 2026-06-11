import { useState } from 'react'
import { HandHistory } from './components/HandHistory'
import { Leaderboard } from './components/Leaderboard'
import { LogPanel } from './components/LogPanel'
import { SeatInvite } from './components/SeatInvite'
import { Table } from './components/Table'
import { useGameSocket } from './useGameSocket'

type Tab = 'table' | 'leaderboard' | 'hands'

const TABS: { id: Tab; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'hands', label: 'Hands' },
]

export default function App() {
  const [state] = useGameSocket()
  const [tab, setTab] = useState<Tab>('table')

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tabs__btn ${tab === t.id ? 'tabs__btn--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="stage">
        {tab === 'table' && <Table state={state} />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'hands' && <HandHistory />}
      </main>
      <SeatInvite />
      <LogPanel state={state} />
    </div>
  )
}
