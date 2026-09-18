const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8081'

export function apiFetch(path, options = {}) {
  // A FormData body needs the browser to set its own multipart boundary in
  // Content-Type — forcing application/json here would break every upload.
  const isFormData = options.body instanceof FormData

  return fetch(`${API_URL}${path}`, {
    ...options,
    // Without this, a backend that's gone unreachable (crashed, not
    // started yet, wrong port) hangs the calling fetch forever instead of
    // surfacing as a network error the UI can react to.
    signal: options.signal ?? AbortSignal.timeout(15000),
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  }).then(
    (res) => res,
    () => {
      // A raw network failure or the timeout above both reject with a
      // DOMException whose .message ("Failed to fetch", "signal timed
      // out", etc.) isn't something to show a contest organizer.
      throw new Error("Couldn't reach the CampusCode Cloud server. Check your connection and try again.")
    },
  )
}
