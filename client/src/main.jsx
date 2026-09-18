import { createRoot } from 'react-dom/client'
// Self-hosted (no CDN, no network at runtime) — matches CampusCode-Client,
// since this app is expected to run fully offline on the same LAN setup.
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/500.css'
import '@fontsource/fira-code/600.css'
import '@fontsource/fira-code/700.css'
import './index.css'
import './darkMode.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
