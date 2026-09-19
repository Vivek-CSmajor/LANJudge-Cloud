import { apiFetch } from './client'

// Zipping every test case file can take longer than the default request
// timeout for a contest with a lot of problems, so this call gets its own
// longer budget instead of the shared 15s default.
const GENERATE_TIMEOUT_MS = 60000

/**
 * Generates the downloadable contest package and returns it as a Blob,
 * along with the filename the server suggested via Content-Disposition.
 * @returns {Promise<{ blob: Blob, filename: string }>}
 * @throws {Error} with a user-facing message on failure
 */
export async function generatePackage(contestId, accessToken) {
  const res = await apiFetch(`/contests/${contestId}/package`, {
    method: 'POST',
    headers: { 'X-Access-Token': accessToken },
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  })

  if (!res.ok) {
    let message = `Couldn't generate the package (${res.status}). Please try again.`
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
  const filename = match ? match[1] : 'contest.zip'

  return { blob: await res.blob(), filename }
}

/**
 * Generates the contest package and wraps it together with the pre-built
 * platform bundle (LAN server binary, Docker setup script, participant
 * client installer) for the given OS, returned as one downloadable zip.
 * @param {string|number} contestId
 * @param {'windows'|'macos-intel'|'macos-arm'} platform
 * @returns {Promise<{ blob: Blob, filename: string }>}
 * @throws {Error} with a user-facing message on failure
 */
export async function generateBundle(contestId, accessToken, platform) {
  const res = await apiFetch(`/contests/${contestId}/bundle/${platform}`, {
    method: 'POST',
    headers: { 'X-Access-Token': accessToken },
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  })

  if (!res.ok) {
    let message = `Couldn't generate the bundle (${res.status}). Please try again.`
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
  const filename = match ? match[1] : 'contest-bundle.zip'

  return { blob: await res.blob(), filename }
}
