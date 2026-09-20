import { useEffect, useMemo, useState } from 'react'
import {
  FileText, Timer, MemoryStick, FileCode, Layers, Upload, Type,
  Plus, Pencil, Trash2, Loader2, AlertCircle, Info, X, ArrowRight, Home,
} from 'lucide-react'
import { listProblems, createProblem, updateProblem, deleteProblem } from '../api/problems'
import { useContest } from '../state/ContestContext'
import { renderStatement } from '../lib/markdown'
import CloudHeader from '../components/CloudHeader'
import './AddProblems.css'

const EMPTY_FORM = { title: '', timeLimitSeconds: '1', memoryLimitMB: '256', statement: '' }

// crypto.randomUUID() only exists in "secure contexts" (HTTPS, or the
// literal host "localhost") — it's undefined and throws on a plain-HTTP
// deployment reached by IP or a non-localhost hostname, which crashed the
// whole page here since nothing catches render-time exceptions. These ids
// are only ever used as a local React key / removal target (never sent to
// the backend — only an *existing* test case's real database id is), so
// they don't need to be cryptographically random at all.
let localIdCounter = 0
function nextLocalId() {
  localIdCounter += 1
  return `local-${localIdCounter}`
}

function draftKey(contestId) {
  return `cc_cloud_problem_draft_${contestId}`
}

function loadDraft(contestId) {
  try {
    const raw = localStorage.getItem(draftKey(contestId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function validateProblem(form, testCases) {
  const errors = {}
  if (!form.title.trim()) errors.title = 'Problem title is required.'

  const time = Number(form.timeLimitSeconds)
  if (!String(form.timeLimitSeconds).trim() || !Number.isFinite(time) || time <= 0) {
    errors.timeLimitSeconds = 'Enter a time limit greater than 0.'
  }

  const memory = Number(form.memoryLimitMB)
  if (!String(form.memoryLimitMB).trim() || !Number.isFinite(memory) || memory <= 0) {
    errors.memoryLimitMB = 'Enter a memory limit greater than 0.'
  }

  if (!form.statement.trim()) errors.statement = 'Problem statement is required.'
  if (testCases.length === 0) errors.testCases = 'Add at least one test case (input and output).'

  return errors
}

// Both entry paths converge here into the same { label, inputText,
// outputText, source } shape — an upload just skips straight to it after
// reading the files, instead of the organizer typing into textareas.
async function groupUploadedFiles(fileList) {
  const files = Array.from(fileList)
  const groups = new Map()
  const errors = []

  for (const file of files) {
    const match = file.name.match(/^(.*)\.(in|out)$/i)
    if (!match) {
      errors.push(`"${file.name}" isn't a .in or .out file — skipped.`)
      continue
    }
    const [, base, ext] = match
    const group = groups.get(base) ?? {}
    group[ext.toLowerCase()] = file
    groups.set(base, group)
  }

  const entries = []
  for (const [base, group] of groups) {
    if (group.in && group.out) {
      const [inputText, outputText] = await Promise.all([group.in.text(), group.out.text()])
      entries.push({ id: nextLocalId(), label: base, inputText, outputText, source: 'upload' })
    } else if (group.in) {
      errors.push(`"${base}.in" has no matching "${base}.out" — pair skipped.`)
    } else {
      errors.push(`"${base}.out" has no matching "${base}.in" — pair skipped.`)
    }
  }

  return { entries, errors }
}

// Shown any time this page can't actually confirm it has a valid,
// reachable contest — no contest in state at all, or the backend rejected
// the one we do have (deleted, or a stale/expired access token). Every
// action on this page (listing, adding, editing, deleting problems) needs
// that same contest + token, so there's nothing usable to show underneath
// it either way — this replaces the whole page rather than sitting above
// a broken form.
function NoContestPanel({ message, onHome }) {
  return (
    <div className="no-contest-state">
      <AlertCircle size={22} strokeWidth={2} />
      <h2>No contest selected</h2>
      <p>{message}</p>
      <button type="button" className="add-problem-btn" onClick={onHome}>
        <Home size={16} /> Back to start
      </button>
    </div>
  )
}

export default function AddProblems({ onContinue, onHome }) {
  const { contest } = useContest()
  const contestId = contest?.id

  const [problems, setProblems] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [testCases, setTestCases] = useState([])
  const [fieldErrors, setFieldErrors] = useState({})

  const [entryMode, setEntryMode] = useState('upload')
  const [manualInput, setManualInput] = useState('')
  const [manualOutput, setManualOutput] = useState('')
  const [uploadErrors, setUploadErrors] = useState([])

  const [saveState, setSaveState] = useState('idle') // idle | saving | error
  const [saveError, setSaveError] = useState(null)

  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null) // { id, message }

  // Saved problems are always the backend's answer, fetched fresh — never
  // reconstructed from localStorage.
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

  // Restore an in-progress (unsaved) problem draft once, on load.
  useEffect(() => {
    if (!contestId) return
    const draft = loadDraft(contestId)
    if (!draft) return
    setForm(draft.form ?? EMPTY_FORM)
    setTestCases(draft.testCases ?? [])
    setEntryMode(draft.entryMode ?? 'upload')
    setEditingId(draft.editingId ?? null)
    setManualInput(draft.manualInput ?? '')
    setManualOutput(draft.manualOutput ?? '')
    setFormOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId])

  // Persist the draft as it changes, only while the form is actually open.
  useEffect(() => {
    if (!contestId || !formOpen) return
    try {
      localStorage.setItem(
        draftKey(contestId),
        JSON.stringify({ form, testCases, entryMode, editingId, manualInput, manualOutput }),
      )
    } catch {
      // localStorage unavailable — the form still works, it just won't survive a refresh.
    }
  }, [contestId, formOpen, form, testCases, entryMode, editingId, manualInput, manualOutput])

  function clearDraft() {
    try { localStorage.removeItem(draftKey(contestId)) } catch { /* nothing to clean up */ }
  }

  function clearTestCasesError() {
    setFieldErrors(errs => {
      if (!errs.testCases) return errs
      const next = { ...errs }
      delete next.testCases
      return next
    })
  }

  function openAddForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setTestCases([])
    setEntryMode('upload')
    setManualInput('')
    setManualOutput('')
    setUploadErrors([])
    setFieldErrors({})
    setSaveState('idle')
    setSaveError(null)
    setFormOpen(true)
  }

  function openEditForm(problem) {
    setEditingId(problem.id)
    setForm({
      title: problem.title,
      timeLimitSeconds: String(problem.time_limit_seconds),
      memoryLimitMB: String(problem.memory_limit_mb),
      statement: problem.statement,
    })
    setTestCases((problem.test_cases ?? []).map(tc => ({ id: tc.id, label: tc.label, source: 'existing' })))
    setEntryMode('upload')
    setManualInput('')
    setManualOutput('')
    setUploadErrors([])
    setFieldErrors({})
    setSaveState('idle')
    setSaveError(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    clearDraft()
  }

  function handleFieldChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    setFieldErrors(errs => {
      if (!errs[name]) return errs
      const next = { ...errs }
      delete next[name]
      return next
    })
  }

  async function handleFilesSelected(e) {
    const { entries, errors } = await groupUploadedFiles(e.target.files)
    if (entries.length > 0) {
      setTestCases(tc => [...tc, ...entries])
      clearTestCasesError()
    }
    setUploadErrors(errors)
    e.target.value = ''
  }

  function addManualEntry() {
    if (!manualInput.trim() || !manualOutput.trim()) return
    const label = `Manual ${testCases.filter(tc => tc.source === 'manual').length + 1}`
    setTestCases(tc => [...tc, { id: nextLocalId(), label, inputText: manualInput, outputText: manualOutput, source: 'manual' }])
    setManualInput('')
    setManualOutput('')
    clearTestCasesError()
  }

  function removeTestCase(id) {
    setTestCases(tc => tc.filter(entry => entry.id !== id))
  }

  async function handleSave(e) {
    e.preventDefault()
    const errors = validateProblem(form, testCases)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    const payload = {
      title: form.title.trim(),
      timeLimitSeconds: Number(form.timeLimitSeconds),
      memoryLimitMB: Number(form.memoryLimitMB),
      statement: form.statement.trim(),
      testCases,
    }

    setSaveState('saving')
    setSaveError(null)
    try {
      const saved = editingId
        ? await updateProblem(contestId, contest.accessToken, editingId, payload)
        : await createProblem(contestId, contest.accessToken, payload)

      setProblems(list => (editingId ? list.map(p => (p.id === saved.id ? saved : p)) : [...list, saved]))
      clearDraft()
      setFormOpen(false)
      setSaveState('idle')
    } catch (err) {
      setSaveError(err.message)
      setSaveState('error')
    }
  }

  async function handleDelete(problem) {
    setDeletingId(problem.id)
    setDeleteError(null)
    try {
      await deleteProblem(contestId, contest.accessToken, problem.id)
      setProblems(list => list.filter(p => p.id !== problem.id))
    } catch (err) {
      setDeleteError({ id: problem.id, message: err.message })
    } finally {
      setDeletingId(null)
    }
  }

  const previewHtml = useMemo(() => renderStatement(form.statement), [form.statement])
  const isSaving = saveState === 'saving'

  if (!contestId) {
    return (
      <div className="problems-page">
        <CloudHeader onHome={onHome} />
        <main className="problems-main">
          <div className="problems-shell">
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
      <div className="problems-page">
        <CloudHeader onHome={onHome} />
        <main className="problems-main">
          <div className="problems-shell">
            <NoContestPanel message={listError} onHome={onHome} />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="problems-page">
      <CloudHeader onHome={onHome} />
      <main className="problems-main">
        <div className="problems-shell">
          <div className="problems-list-header">
            <div>
              <h1 className="problems-title">Problems</h1>
              <p className="problems-subtitle">
                {contest.name} · {problems.length} problem{problems.length === 1 ? '' : 's'} added
              </p>
            </div>
            {!formOpen && (
              <div className="problems-header-actions">
                <button type="button" className="continue-btn" onClick={onContinue}>
                  Continue to Generate Package <ArrowRight size={15} />
                </button>
                <button type="button" className="add-problem-btn" onClick={openAddForm}>
                  <Plus size={16} /> Add problem
                </button>
              </div>
            )}
          </div>

          {listLoading && (
            <div className="list-status"><Loader2 size={16} className="spin" /> Loading problems…</div>
          )}

          {!listLoading && !listError && problems.length === 0 && !formOpen && (
            <div className="empty-problems">No problems yet — add the first one below.</div>
          )}

          {!listLoading && problems.length > 0 && (
            <ul className="problem-cards">
              {problems.map(problem => (
                <li key={problem.id} className="problem-card">
                  <div className="problem-card-main">
                    <span className="problem-card-title">{problem.title}</span>
                    <span className="problem-card-meta">
                      {(problem.test_cases ?? []).length} test case{(problem.test_cases ?? []).length === 1 ? '' : 's'}
                      {' · '}{problem.time_limit_seconds}s · {problem.memory_limit_mb} MB
                    </span>
                  </div>
                  <div className="problem-card-actions">
                    <button type="button" className="icon-btn" onClick={() => openEditForm(problem)} aria-label="Edit problem" title="Edit">
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      onClick={() => handleDelete(problem)}
                      disabled={deletingId === problem.id}
                      aria-label="Delete problem"
                      title="Delete"
                    >
                      {deletingId === problem.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                    </button>
                  </div>
                  {deleteError?.id === problem.id && (
                    <p className="problem-card-error"><AlertCircle size={12} /> {deleteError.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {formOpen && (
            <form className="problem-form" onSubmit={handleSave} noValidate>
              <div className="problem-form-header">
                <h2>{editingId ? 'Edit problem' : 'Add a problem'}</h2>
                <button type="button" className="icon-btn" onClick={closeForm} aria-label="Close form" title="Close">
                  <X size={16} />
                </button>
              </div>

              {saveState === 'error' && (
                <div className="inline-error inline-error--block"><AlertCircle size={14} /> {saveError}</div>
              )}

              <div className="problem-field">
                <label htmlFor="title">Title</label>
                <div className={`problem-input-wrap${fieldErrors.title ? ' problem-input-wrap--error' : ''}`}>
                  <FileText size={16} strokeWidth={2} className="problem-input-icon" />
                  <input id="title" name="title" type="text" value={form.title} onChange={handleFieldChange} placeholder="e.g. Two Sum" />
                </div>
                {fieldErrors.title && <p className="field-error"><AlertCircle size={12} />{fieldErrors.title}</p>}
              </div>

              <div className="problem-field-row">
                <div className="problem-field">
                  <label htmlFor="timeLimitSeconds">Time limit (seconds)</label>
                  <div className={`problem-input-wrap${fieldErrors.timeLimitSeconds ? ' problem-input-wrap--error' : ''}`}>
                    <Timer size={16} strokeWidth={2} className="problem-input-icon" />
                    <input
                      id="timeLimitSeconds" name="timeLimitSeconds" type="number" min="0" step="0.1"
                      value={form.timeLimitSeconds} onChange={handleFieldChange}
                    />
                  </div>
                  {fieldErrors.timeLimitSeconds && <p className="field-error"><AlertCircle size={12} />{fieldErrors.timeLimitSeconds}</p>}
                </div>

                <div className="problem-field">
                  <label htmlFor="memoryLimitMB">Memory limit (MB)</label>
                  <div className={`problem-input-wrap${fieldErrors.memoryLimitMB ? ' problem-input-wrap--error' : ''}`}>
                    <MemoryStick size={16} strokeWidth={2} className="problem-input-icon" />
                    <input
                      id="memoryLimitMB" name="memoryLimitMB" type="number" min="0" step="1"
                      value={form.memoryLimitMB} onChange={handleFieldChange}
                    />
                  </div>
                  {fieldErrors.memoryLimitMB && <p className="field-error"><AlertCircle size={12} />{fieldErrors.memoryLimitMB}</p>}
                </div>
              </div>

              <div className="problem-field">
                <label htmlFor="statement"><FileCode size={14} strokeWidth={2} className="label-icon" /> Problem statement</label>
                <div className={`statement-editor${fieldErrors.statement ? ' statement-editor--error' : ''}`}>
                  <div className="statement-pane">
                    <span className="statement-pane-label">Markdown</span>
                    <textarea
                      id="statement" name="statement" value={form.statement} onChange={handleFieldChange}
                      placeholder={'## Input\n\nDescribe the input format…\n\n## Output\n\nDescribe the output format…'}
                    />
                  </div>
                  <div className="statement-pane">
                    <span className="statement-pane-label">Preview</span>
                    <div className="statement-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  </div>
                </div>
                {fieldErrors.statement && <p className="field-error"><AlertCircle size={12} />{fieldErrors.statement}</p>}
              </div>

              <div className="testcases-section">
                <label className="testcases-heading"><Layers size={15} strokeWidth={2} className="label-icon" /> Test cases</label>

                <div className="format-guide">
                  <Info size={14} strokeWidth={2} />
                  <div>
                    <p>
                      Each pair is one Codeforces-style batch file: the first line of the <code>.in</code> file
                      states how many test cases it holds, and the matching <code>.out</code> file has one
                      output per case, in the same order.
                    </p>
                    <pre>{`1.in                1.out
─────               ─────
3        ← count    7
1 2                 11
3 4                 9
5 6`}</pre>
                  </div>
                </div>

                <div className="entry-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={entryMode === 'upload'} className={`tab-pill${entryMode === 'upload' ? ' tab-pill--active' : ''}`} onClick={() => setEntryMode('upload')}>
                    <Upload size={14} /> Upload files
                  </button>
                  <button type="button" role="tab" aria-selected={entryMode === 'manual'} className={`tab-pill${entryMode === 'manual' ? ' tab-pill--active' : ''}`} onClick={() => setEntryMode('manual')}>
                    <Type size={14} /> Manual entry
                  </button>
                </div>

                {entryMode === 'upload' ? (
                  <div className="upload-panel">
                    <label className="upload-dropzone">
                      <Upload size={20} strokeWidth={1.75} />
                      <span>Click to choose .in / .out files</span>
                      <span className="upload-hint">Select multiple at once — e.g. 1.in, 1.out, 2.in, 2.out</span>
                      <input type="file" multiple accept=".in,.out" onChange={handleFilesSelected} hidden />
                    </label>
                    {uploadErrors.length > 0 && (
                      <ul className="upload-errors">
                        {uploadErrors.map((msg, i) => (
                          <li key={i}><AlertCircle size={12} /> {msg}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="manual-panel">
                    <div className="manual-textareas">
                      <div className="manual-field">
                        <span className="statement-pane-label">Input</span>
                        <textarea value={manualInput} onChange={e => setManualInput(e.target.value)} placeholder={'3\n1 2\n3 4\n5 6'} />
                      </div>
                      <div className="manual-field">
                        <span className="statement-pane-label">Expected output</span>
                        <textarea value={manualOutput} onChange={e => setManualOutput(e.target.value)} placeholder={'3\n7\n11\n9'} />
                      </div>
                    </div>
                    <button type="button" className="add-testcase-btn" onClick={addManualEntry} disabled={!manualInput.trim() || !manualOutput.trim()}>
                      <Plus size={14} /> Add test case
                    </button>
                  </div>
                )}

                {testCases.length > 0 && (
                  <ul className="testcase-list">
                    {testCases.map(tc => (
                      <li key={tc.id} className="testcase-chip">
                        <span className="testcase-chip-label">{tc.label}</span>
                        <span className={`testcase-chip-tag testcase-chip-tag--${tc.source}`}>
                          {tc.source === 'existing' ? 'Saved' : tc.source === 'upload' ? 'Uploaded' : 'Manual'}
                        </span>
                        <button type="button" className="testcase-chip-remove" onClick={() => removeTestCase(tc.id)} aria-label={`Remove ${tc.label}`}>
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {fieldErrors.testCases && <p className="field-error"><AlertCircle size={12} />{fieldErrors.testCases}</p>}
              </div>

              <div className="problem-form-actions">
                <button type="button" className="cancel-btn" onClick={closeForm} disabled={isSaving}>Cancel</button>
                <button type="submit" className="save-problem-btn" disabled={isSaving}>
                  {isSaving ? <><Loader2 size={16} className="spin" /> Saving…</> : editingId ? 'Save changes' : 'Add problem'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
