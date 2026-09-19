import { useState } from 'react'
import { ArrowLeft, Download, Loader2, AlertCircle, MonitorSmartphone } from 'lucide-react'
import { downloadClientInstaller } from '../api/clientDownload'
import CloudHeader from '../components/CloudHeader'
import './DownloadClient.css'

const PLATFORMS = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos-intel', label: 'Mac (Intel)' },
  { id: 'macos-arm', label: 'Mac (Apple Silicon)' },
]

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

export default function DownloadClient({ onBack }) {
  const [downloadingId, setDownloadingId] = useState(null)
  const [errors, setErrors] = useState({}) // platform id -> message

  async function handleDownload(platform) {
    setDownloadingId(platform)
    setErrors(e => {
      if (!e[platform]) return e
      const next = { ...e }
      delete next[platform]
      return next
    })
    try {
      const { blob, filename } = await downloadClientInstaller(platform)
      triggerDownload(blob, filename)
    } catch (err) {
      setErrors(e => ({ ...e, [platform]: err.message }))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="download-client-page">
      <CloudHeader />
      <main className="download-client-main">
        <div className="download-client-shell">
          <button type="button" className="back-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </button>

          <h1 className="download-client-title">Download Participant App</h1>
          <p className="download-client-subtitle">
            This is the app participants install on their own laptop to join a contest —
            pick your operating system below.
          </p>

          <div className="platform-grid">
            {PLATFORMS.map(p => {
              const isDownloading = downloadingId === p.id
              return (
                <div key={p.id} className="platform-card">
                  <MonitorSmartphone size={22} strokeWidth={1.75} />
                  <h3>{p.label}</h3>
                  <button
                    type="button"
                    className="platform-download-btn"
                    onClick={() => handleDownload(p.id)}
                    disabled={isDownloading}
                  >
                    {isDownloading
                      ? <><Loader2 size={14} className="spin" /> Downloading…</>
                      : <><Download size={14} /> Download</>
                    }
                  </button>
                  {errors[p.id] && (
                    <p className="platform-error"><AlertCircle size={12} /> {errors[p.id]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
