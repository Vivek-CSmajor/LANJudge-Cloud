import CreateContest from './pages/CreateContest'
import ThemeToggle from './components/ThemeToggle'
import { ContestProvider } from './state/ContestContext'
import { useTheme } from './hooks/useTheme'

export default function App() {
  const { theme, toggleTheme } = useTheme()

  return (
    <ContestProvider>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <CreateContest />
    </ContestProvider>
  )
}
