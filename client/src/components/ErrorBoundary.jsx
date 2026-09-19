import { Component } from 'react'
import { AlertTriangle } from 'lucide-react'
import './ErrorBoundary.css'

// A blank page with no way forward (what happened when crypto.randomUUID()
// threw on a non-secure-context deployment) is the worst possible failure
// mode — this at least gives the organizer a message and a way to recover
// without losing the draft sitting in localStorage.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary-page">
          <div className="error-boundary-card">
            <AlertTriangle size={22} strokeWidth={2} />
            <h2>Something went wrong</h2>
            <p>{this.state.error.message || 'An unexpected error occurred.'}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
