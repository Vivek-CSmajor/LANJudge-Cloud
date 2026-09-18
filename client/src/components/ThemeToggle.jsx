import { Sun, Moon } from 'lucide-react'
import './ThemeToggle.css'

export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="theme-toggle-btn"
      onClick={onToggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle dark mode"
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
