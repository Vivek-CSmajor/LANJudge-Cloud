import { useState } from 'react'
import Landing from './pages/Landing'
import DownloadClient from './pages/DownloadClient'
import CreateContest from './pages/CreateContest'
import AddProblems from './pages/AddProblems'
import GeneratePackage from './pages/GeneratePackage'
import ThemeToggle from './components/ThemeToggle'
import ErrorBoundary from './components/ErrorBoundary'
import { ContestProvider, useContest } from './state/ContestContext'
import { useTheme } from './hooks/useTheme'

// No router yet — just five screens and one way to move forward through
// them. A contest already in context (e.g. after a refresh) skips straight
// to Add Problems, since both the landing page and Create Contest have
// nothing left to do for it.
function AppShell() {
  const { contest } = useContest()
  const [view, setView] = useState(() => (contest ? 'problems' : 'landing'))

  if (view === 'landing') {
    return <Landing onCreateContest={() => setView('create')} onDownloadClient={() => setView('download-client')} />
  }
  if (view === 'download-client') {
    return <DownloadClient onBack={() => setView('landing')} />
  }
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
    <ErrorBoundary>
      <ContestProvider>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <AppShell />
      </ContestProvider>
    </ErrorBoundary>
  )
}
