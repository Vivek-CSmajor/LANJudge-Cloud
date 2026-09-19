import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, AlertCircle, Loader2, Package, Download } from 'lucide-react'
import { listProblems } from '../api/problems'
import { generatePackage, generateBundle } from '../api/packages'
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

export default function GeneratePackage() {
  const { contest } = useContest()
  const contestId = contest?.id

  const [problems, setProblems] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [generateState, setGenerateState] = useState('idle') // idle | generating | success | error
  const [generateError, setGenerateError] = useState(null)
  const [packageResult, setPackageResult] = useState(null) // { blob, filename }

  const [bundlePlatform, setBundlePlatform] = useState(null) // which platform is currently downloading, if any
  const [bundleError, setBundleError] = useState(null)

  useEffect(() => {
    if (!contestId) return
    let cancelled = false
    setListLoading(true)
    setListError(null)
    listProblems(contestId)
      .then(data => { if (!cancelled) setProblems(data ?? []) })
      .catch(err => { if (!cancelled) setListError(err.message) })
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [contestId])

  const readiness = useMemo(() => computeReadiness(contest, problems), [contest, problems])
  const allReady = readiness.every(item => item.met)
  const isGenerating = generateState === 'generating'
  const totalTestCases = useMemo(
    () => problems.reduce((sum, p) => sum + (p.test_cases?.length ?? 0), 0),
    [problems],
  )

  async function handleGenerate() {
    setGenerateState('generating')
    setGenerateError(null)
    try {
      const result = await generatePackage(contestId, contest.accessToken)
      setPackageResult(result)
      setGenerateState('success')
    } catch (err) {
      setGenerateError(err.message)
      setGenerateState('error')
    }
  }

  function handleDownload() {
    if (!packageResult) return
    triggerDownload(packageResult.blob, packageResult.filename)
  }

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
        <CloudHeader />
        <main className="generate-main">
          <div className="no-contest-notice">
            <AlertCircle size={18} />
            <p>No contest is loaded yet. Create a contest first.</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="generate-page">
      <CloudHeader />
      <main className="generate-main">
        <div className="generate-card">
          <div className="generate-card-header">
            <h2 className="generate-title">Generate & download package</h2>
            <p className="generate-subtitle">
              {contest.name} · Review the checklist, then export this contest for the LAN server.
            </p>
          </div>

          {listLoading && (
            <div className="list-status"><Loader2 size={16} className="spin" /> Loading problems…</div>
          )}
          {listError && (
            <div className="inline-error"><AlertCircle size={14} /> {listError}</div>
          )}

          {!listLoading && !listError && (
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

              {generateState === 'error' && (
                <div className="inline-error"><AlertCircle size={14} /> {generateError}</div>
              )}

              {generateState === 'success' && packageResult ? (
                <div className="generate-success">
                  <CheckCircle2 size={20} />
                  <p>
                    Package ready — {problems.length} problem{problems.length === 1 ? '' : 's'},{' '}
                    {totalTestCases} test case{totalTestCases === 1 ? '' : 's'}.
                  </p>
                  <button type="button" className="download-btn" onClick={handleDownload}>
                    <Download size={16} /> Download package (.zip)
                  </button>

                  <div className="bundle-picker">
                    <p className="bundle-picker-label">
                      Or download the full offline bundle for your organizer laptop —
                      LAN server + Docker setup script + participant client, all in one file:
                    </p>
                    <div className="bundle-picker-options">
                      {PLATFORMS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="bundle-btn"
                          disabled={bundlePlatform !== null}
                          onClick={() => handleDownloadBundle(p.id)}
                        >
                          {bundlePlatform === p.id
                            ? <><Loader2 size={15} className="spin" /> Preparing…</>
                            : <><Download size={15} /> {p.label}</>
                          }
                        </button>
                      ))}
                    </div>
                    {bundleError && (
                      <div className="inline-error"><AlertCircle size={14} /> {bundleError}</div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="generate-btn"
                  disabled={!allReady || isGenerating}
                  onClick={handleGenerate}
                >
                  {isGenerating
                    ? <><Loader2 size={16} className="spin" /> Generating… this can take a moment</>
                    : <><Package size={16} /> Generate Package</>
                  }
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
