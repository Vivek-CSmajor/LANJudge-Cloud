import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'cc_cloud_current_contest'

// The contest a future "Add Problems" page (and whatever comes after it)
// will attach to. Backed by localStorage rather than plain component state
// so it survives a refresh or a direct navigation, not just in-memory
// route changes — this is the seed of what grows into full app-wide
// contest state as more pages, and real backend-issued contest IDs, are
// added.
const ContestContext = createContext(null)

function loadStoredContest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function ContestProvider({ children }) {
  const [contest, setContest] = useState(loadStoredContest)

  useEffect(() => {
    try {
      if (contest) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(contest))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — the app
      // still works for this session, it just won't survive a refresh.
    }
  }, [contest])

  return (
    <ContestContext.Provider value={{ contest, setContest }}>
      {children}
    </ContestContext.Provider>
  )
}

export function useContest() {
  const ctx = useContext(ContestContext)
  if (!ctx) throw new Error('useContest must be used within a ContestProvider')
  return ctx
}
