import { useEffect, useState } from 'react'
import {
  Trophy, Clock, User, Lock, Eye, EyeOff,
  Loader2, AlertCircle, CheckCircle2, Code2,
} from 'lucide-react'
import { useContest } from '../state/ContestContext'
import './CreateContest.css'

const DRAFT_KEY = 'cc_cloud_create_contest_draft'
const SUBMIT_DELAY_MS = 700

const DEFAULT_FORM = {
  name: '',
  durationMinutes: '180',
  adminUsername: '',
  adminPassword: '',
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return DEFAULT_FORM
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_FORM, ...parsed }
  } catch {
    return DEFAULT_FORM
  }
}

function validate(form) {
  const errors = {}

  if (!form.name.trim()) {
    errors.name = 'Contest name is required.'
  }

  const duration = Number(form.durationMinutes)
  if (!form.durationMinutes.trim() || !Number.isFinite(duration) || duration <= 0) {
    errors.durationMinutes = 'Enter a duration greater than 0 minutes.'
  }

  if (!form.adminUsername.trim()) {
    errors.adminUsername = 'Admin username is required.'
  }

  if (!form.adminPassword) {
    errors.adminPassword = 'Admin password is required.'
  } else if (form.adminPassword.length < 8) {
    errors.adminPassword = 'Password must be at least 8 characters.'
  }

  return errors
}

export default function CreateContest() {
  const { setContest } = useContest()

  const [form, setForm] = useState(loadDraft)
  const [fieldErrors, setFieldErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  // Persist the draft as the organizer types, so a refresh mid-form
  // doesn't lose their work. Skipped once submitted, since the draft has
  // already been cleared and the form is unmounted.
  useEffect(() => {
    if (submitted) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {
      // localStorage unavailable — the form still works, it just won't
      // survive a refresh this session.
    }
  }, [form, submitted])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    setFieldErrors(errs => {
      if (!errs[name]) return errs
      const next = { ...errs }
      delete next[name]
      return next
    })
  }

  function handleSubmit(e) {
    e.preventDefault()
    const errors = validate(form)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    const payload = {
      name: form.name.trim(),
      durationMinutes: Number(form.durationMinutes),
      adminUsername: form.adminUsername.trim(),
      adminPassword: form.adminPassword,
    }

    setIsSubmitting(true)
    // Stands in for the real create-contest request, which lands with
    // backend wiring in a follow-up — this keeps the submitting/disabled
    // button behavior honest in the meantime.
    setTimeout(() => {
      console.log('Create contest submit:', payload)
      setContest({
        name: payload.name,
        durationMinutes: payload.durationMinutes,
        adminUsername: payload.adminUsername,
        createdAt: new Date().toISOString(),
      })
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        // nothing to clean up if storage isn't available
      }
      setIsSubmitting(false)
      setSubmitted(payload)
    }, SUBMIT_DELAY_MS)
  }

  return (
    <div className="create-page">
      <header className="topbar">
        <div className="topbar-inner">
          <Code2 size={22} strokeWidth={2.5} className="logo-icon" />
          <span className="logo">Campus<span className="logo-accent">Code</span></span>
          <span className="cloud-badge">Cloud</span>
        </div>
      </header>

      <main className="create-main">
        <div className="create-card">
          {submitted ? (
            <div className="success-panel">
              <div className="success-icon">
                <CheckCircle2 size={26} strokeWidth={2} />
              </div>
              <h2 className="success-title">Contest created</h2>
              <p className="success-detail">
                "{submitted.name}" is saved. Next you'll add problems to it.
              </p>
              <div className="success-meta">
                <div className="success-meta-row">
                  <span className="success-meta-label">Duration</span>
                  <span className="success-meta-value">{submitted.durationMinutes} min</span>
                </div>
                <div className="success-meta-row">
                  <span className="success-meta-label">Admin username</span>
                  <span className="success-meta-value">{submitted.adminUsername}</span>
                </div>
              </div>
              <p className="success-next-hint">The "Add Problems" page is coming next.</p>
            </div>
          ) : (
            <>
              <div className="create-card-header">
                <h2 className="create-title">Create a new contest</h2>
                <p className="create-subtitle">Set the basics now — you'll add problems next.</p>
              </div>

              <form onSubmit={handleSubmit} className="create-form" noValidate>
                <div className="create-field">
                  <label htmlFor="name">Contest Name</label>
                  <div className={`create-input-wrap${fieldErrors.name ? ' create-input-wrap--error' : ''}`}>
                    <Trophy size={18} strokeWidth={2} className="create-input-icon" />
                    <input
                      id="name"
                      name="name"
                      type="text"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="e.g. Fall Coding Sprint"
                      autoFocus
                    />
                  </div>
                  {fieldErrors.name && (
                    <p className="field-error"><AlertCircle size={12} />{fieldErrors.name}</p>
                  )}
                </div>

                <div className="create-field">
                  <label htmlFor="durationMinutes">Duration (minutes)</label>
                  <div className={`create-input-wrap${fieldErrors.durationMinutes ? ' create-input-wrap--error' : ''}`}>
                    <Clock size={18} strokeWidth={2} className="create-input-icon" />
                    <input
                      id="durationMinutes"
                      name="durationMinutes"
                      type="number"
                      min="1"
                      value={form.durationMinutes}
                      onChange={handleChange}
                      placeholder="180"
                    />
                  </div>
                  {fieldErrors.durationMinutes && (
                    <p className="field-error"><AlertCircle size={12} />{fieldErrors.durationMinutes}</p>
                  )}
                </div>

                <div className="create-field">
                  <label htmlFor="adminUsername">Admin Username</label>
                  <div className={`create-input-wrap${fieldErrors.adminUsername ? ' create-input-wrap--error' : ''}`}>
                    <User size={18} strokeWidth={2} className="create-input-icon" />
                    <input
                      id="adminUsername"
                      name="adminUsername"
                      type="text"
                      value={form.adminUsername}
                      onChange={handleChange}
                      placeholder="Username for contest-day login"
                    />
                  </div>
                  {fieldErrors.adminUsername && (
                    <p className="field-error"><AlertCircle size={12} />{fieldErrors.adminUsername}</p>
                  )}
                </div>

                <div className="create-field">
                  <label htmlFor="adminPassword">Admin Password</label>
                  <div className={`create-input-wrap create-input-wrap--password${fieldErrors.adminPassword ? ' create-input-wrap--error' : ''}`}>
                    <Lock size={18} strokeWidth={2} className="create-input-icon" />
                    <input
                      id="adminPassword"
                      name="adminPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={form.adminPassword}
                      onChange={handleChange}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                  {fieldErrors.adminPassword ? (
                    <p className="field-error"><AlertCircle size={12} />{fieldErrors.adminPassword}</p>
                  ) : (
                    <p className="field-hint">This is what you'll use to log into the admin dashboard on contest day.</p>
                  )}
                </div>

                <button type="submit" className="create-submit-btn" disabled={isSubmitting}>
                  {isSubmitting
                    ? <><Loader2 size={16} className="spin" /> Saving…</>
                    : 'Continue'
                  }
                </button>
              </form>

              <p className="create-footer">You can change these details later from the admin dashboard.</p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
