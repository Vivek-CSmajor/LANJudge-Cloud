import { Trophy, Download, ArrowRight } from 'lucide-react'
import CloudHeader from '../components/CloudHeader'
import './Landing.css'

export default function Landing({ onCreateContest, onDownloadClient }) {
  return (
    <div className="landing-page">
      <CloudHeader />
      <main className="landing-main">
        <div className="landing-shell">
          <h1 className="landing-title">What would you like to do?</h1>
          <p className="landing-subtitle">
            Set up a new contest, or get the app your participants use to join one.
          </p>

          <div className="landing-options">
            <button type="button" className="landing-card" onClick={onCreateContest}>
              <Trophy size={26} strokeWidth={1.75} />
              <h2>Create a Contest</h2>
              <p>Set the basics, add problems and test cases, then generate a package for the offline contest server.</p>
              <span className="landing-card-cta">Get started <ArrowRight size={14} /></span>
            </button>

            <button type="button" className="landing-card" onClick={onDownloadClient}>
              <Download size={26} strokeWidth={1.75} />
              <h2>Download Participant App</h2>
              <p>Get the app participants install on their own laptop to join a contest on the day.</p>
              <span className="landing-card-cta">Browse downloads <ArrowRight size={14} /></span>
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
