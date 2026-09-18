import { Code2 } from 'lucide-react'
import './CloudHeader.css'

export default function CloudHeader() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Code2 size={22} strokeWidth={2.5} className="logo-icon" />
        <span className="logo">Campus<span className="logo-accent">Code</span></span>
        <span className="cloud-badge">Cloud</span>
      </div>
    </header>
  )
}
