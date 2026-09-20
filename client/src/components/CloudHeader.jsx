import { Code2, Home } from 'lucide-react'
import './CloudHeader.css'

// onHome is optional: Landing has nowhere further back to go, and
// DownloadClient already has its own dedicated back button, so neither
// passes it. Every other page does, so there's always a way out of a
// broken or dead-end state.
export default function CloudHeader({ onHome }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Code2 size={22} strokeWidth={2.5} className="logo-icon" />
        <span className="logo">Campus<span className="logo-accent">Code</span></span>
        <span className="cloud-badge">Cloud</span>
        {onHome && (
          <button type="button" className="topbar-home-btn" onClick={onHome}>
            <Home size={14} /> Back to start
          </button>
        )}
      </div>
    </header>
  )
}
