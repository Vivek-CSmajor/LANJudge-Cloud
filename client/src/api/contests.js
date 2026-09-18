import { apiFetch } from './client'

/**
 * Create a new contest.
 * @returns {Promise<{id: number, name: string, duration_minutes: number, admin_username: string, created_at: string}>}
 * @throws {Error} with a user-facing message on failure
 */
export async function createContest({ name, durationMinutes, adminUsername, adminPassword }) {
  const res = await apiFetch('/contests', {
    method: 'POST',
    body: JSON.stringify({
      name,
      duration_minutes: durationMinutes,
      admin_username: adminUsername,
      admin_password: adminPassword,
    }),
  })

  if (res.ok) {
    return res.json()
  }

  let message = `Couldn't save the contest (${res.status}). Please try again.`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    // response wasn't JSON — fall back to the generic message above
  }
  throw new Error(message)
}
