import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, AlertCircle, Loader2, Download, Home } from 'lucide-react'
import { listProblems } from '../api/problems'
import { generateBundle } from '../api/packages'
import { useContest } from '../state/ContestContext'
import CloudHeader from '../components/CloudHeader'
import './GeneratePackage.css'

const PLATFORMS = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos-intel', label: 'Mac (Intel)' },
  { id: 'macos-arm', label: 'Mac (Apple Silicon)' },
]

// Mirrors the backend's own re-check in handlers/package.go — shown here
// so the organizer can see exactly what's missing before ever clicking
// Generate, not just get a rejected request.
function computeReadiness(contest, problems) {
  const problemIssues = []
  for (const p of problems) {
    const label = p.title?.trim() ? `"${p.title.trim()}"` : `#${p.id}`
    if (!p.title?.trim()) problemIssues.push(`Problem ${label} has no title.`)
    if (!(Number(p.time_limit_seconds) > 0)) problemIssues.push(`Problem ${label} has an invalid time limit.`)
    if (!(Number(p.memory_limit_mb) > 0)) problemIssues.push(`Problem ${label} has an invalid memory limit.`)
    if (!p.statement?.trim()) problemIssues.push(`Problem ${label} has no statement.`)
    if (!(p.test_cases?.length > 0)) problemIssues.push(`Problem ${label} has no test cases.`)
  }

  return [
    {
      label: 'Contest has a name, duration, admin username, and password',
      met: Boolean(contest?.name?.trim() && contest?.durationMinutes > 0 && contest?.adminUsername?.trim()),
    },
    {
      label: 'Contest has at least one problem',
      met: problems.length > 0,
    },
    {
      label: 'Every problem has a title, valid limits, a statement, and at least one test case',
      met: problems.length > 0 && problemIssues.length === 0,
      details: problemIssues,
    },
  ]
}

// Shown any time this page can't actually confirm it has a valid,
// reachable contest to work with — no contest in state at all, or the
// backend rejected the one we do have (deleted, or a stale/expired access
// token). Either way, showing the checklist/generate UI underneath would
// be pointless, so this replaces it entirely rather than sitting above it.
function NoContestPanel({ message, onHome }) {
  return (
    <div className="no-contest-state">
      <AlertCircle size={22} strokeWidth={2} />
      <h2>No contest selected</h2>
      <p>{message}</p>
      <button type="button" className="generate-btn" onClick={onHome}>
        <Home size={16} /> Back to start
      </button>
    </div>
  )
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function GeneratePackage({ onHome }) {
  const { contest } = useContest()
  const contestId = contest?.id

  const [problems, setProblems] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [bundlePlatform, setBundlePlatform] = useState(null) // which platform is currently downloading, if any
  const [bundleError, setBundleError] = useState(null)

  useEffect(() => {
    if (!contestId) return
    let cancelled = false
    setListLoading(true)
    setListError(null)
    listProblems(contestId, contest.accessToken)
      .then(data => { if (!cancelled) setProblems(data ?? []) })
      .catch(err => { if (!cancelled) setListError(err.message) })
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [contestId])

  const readiness = useMemo(() => computeReadiness(contest, problems), [contest, problems])
  const allReady = readiness.every(item => item.met)

  async function handleDownloadBundle(platform) {
    setBundlePlatform(platform)
    setBundleError(null)
    try {
      const result = await generateBundle(contestId, contest.accessToken, platform)
      triggerDownload(result.blob, result.filename)
    } catch (err) {
      setBundleError(err.message)
    } finally {
      setBundlePlatform(null)
    }
  }

  if (!contestId) {
    return (
      <div className="generate-page">
        <CloudHeader onHome={onHome} />
        <main className="generate-main">
          <div className="generate-card">
            <NoContestPanel
              message="You haven't created a contest yet, or it's no longer available in this browser."
              onHome={onHome}
            />
          </div>
        </main>
      </div>
    )
  }

  if (!listLoading && listError) {
    return (
      <div className="generate-page">
        <CloudHeader onHome={onHome} />
        <main className="generate-main">
          <div className="generate-card">
            <NoContestPanel message={listError} onHome={onHome} />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="generate-page">
      <CloudHeader onHome={onHome} />
      <main className="generate-main">
        <div className="generate-card">
          <div className="generate-card-header">
            <h2 className="generate-title">Generate & download package</h2>
            <p className="generate-subtitle">
              {contest.name} · Review the checklist, then download the package for your organizer laptop.
            </p>
          </div>

          {listLoading && (
            <div className="list-status"><Loader2 size={16} className="spin" /> Loading problems…</div>
          )}

          {!listLoading && (
            <>
              <ul className="readiness-list">
                {readiness.map((item, i) => (
                  <li key={i} className={`readiness-item${item.met ? ' readiness-item--met' : ''}`}>
                    {item.met ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                    <div>
                      <span>{item.label}</span>
                      {!item.met && item.details?.length > 0 && (
                        <ul className="readiness-sub-list">
                          {item.details.map((d, j) => <li key={j}>{d}</li>)}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {bundleError && (
                <div className="inline-error"><AlertCircle size={14} /> {bundleError}</div>
              )}

              <div className="bundle-picker">
                <p className="bundle-picker-label">
                  Pick the OS of the laptop that will run the contest — each download includes
                  the contest data, the LAN server, and its Docker setup script:
                </p>
                <div className="bundle-picker-options">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="bundle-btn"
                      disabled={!allReady || bundlePlatform !== null}
                      onClick={() => handleDownloadBundle(p.id)}
                    >
                      {bundlePlatform === p.id
                        ? <><Loader2 size={15} className="spin" /> Preparing…</>
                        : <><Download size={15} /> {p.label}</>
                      }
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
