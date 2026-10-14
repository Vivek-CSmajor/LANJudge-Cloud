import { apiFetch } from './client'

// A 130MB+ installer over a slow connection can easily take longer than
// the shared 15s default timeout, and there's no server-side "generation"
// step here to bound — it's just the transfer itself.
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Downloads a platform's participant client installer as a Blob, along
 * with the filename the server suggested via Content-Disposition.
 * @param {'windows'|'macos-intel'|'macos-arm'} platform
 * @returns {Promise<{ blob: Blob, filename: string }>}
 * @throws {Error} with a user-facing message on failure
 */
export async function downloadClientInstaller(platform) {
  const res = await apiFetch(`/client-download/${platform}`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })

  if (!res.ok) {
    let message = `Couldn't download the installer (${res.status}). Please try again.`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // response wasn't JSON — fall back to the generic message above
    }
    throw new Error(message)
  }

  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match ? match[1] : `lanjudge-client-${platform}`

  return { blob: await res.blob(), filename }
}
