import { useState } from 'react'
import CreateContest from './pages/CreateContest'
import AddProblems from './pages/AddProblems'
import GeneratePackage from './pages/GeneratePackage'
import ThemeToggle from './components/ThemeToggle'
import { ContestProvider, useContest } from './state/ContestContext'
import { useTheme } from './hooks/useTheme'

// No router yet — just three screens and one way to move forward through
// them. A contest already in context (e.g. after a refresh) skips straight
// to Add Problems, since Create Contest has nothing left to do for it.
function AppShell() {
  const { contest } = useContest()
  const [view, setView] = useState(() => (contest ? 'problems' : 'create'))

  if (view === 'create') {
    return <CreateContest onContinue={() => setView('problems')} />
  }
  if (view === 'problems') {
    return <AddProblems onContinue={() => setView('generate')} />
  }
  return <GeneratePackage />
}

export default function App() {
  const { theme, toggleTheme } = useTheme()

  return (
    <ContestProvider>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <AppShell />
    </ContestProvider>
  )
}
