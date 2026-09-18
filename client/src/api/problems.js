import { apiFetch } from './client'

/**
 * Builds the multipart body shared by create and update. Test cases from
 * either entry method (file upload or manual textareas) have already been
 * normalized by the caller into the same { label, inputText, outputText }
 * shape, so both are wrapped as Blobs here identically — the backend only
 * ever sees plain file parts. An `id`-only entry with source 'existing'
 * means "keep this test case already on the server."
 */
function buildProblemFormData({ title, timeLimitSeconds, memoryLimitMB, statement, testCases }) {
  const formData = new FormData()
  formData.append('title', title)
  formData.append('time_limit_seconds', String(timeLimitSeconds))
  formData.append('memory_limit_mb', String(memoryLimitMB))
  formData.append('statement', statement)

  const keepIds = testCases.filter(tc => tc.source === 'existing').map(tc => tc.id)
  if (keepIds.length > 0) {
    formData.append('keep_testcase_ids', JSON.stringify(keepIds))
  }

  const newCases = testCases.filter(tc => tc.source !== 'existing')
  formData.append('testcase_count', String(newCases.length))
  newCases.forEach((tc, i) => {
    formData.append(`testcase_label_${i}`, tc.label)
    formData.append(`testcase_input_${i}`, new Blob([tc.inputText], { type: 'text/plain' }), `${tc.label}.in`)
    formData.append(`testcase_output_${i}`, new Blob([tc.outputText], { type: 'text/plain' }), `${tc.label}.out`)
  })

  return formData
}

async function readResponse(res, fallbackMessage) {
  if (res.ok) return res.json()
  let message = fallbackMessage
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {
    // response wasn't JSON — fall back to the generic message
  }
  throw new Error(message)
}

export async function listProblems(contestId) {
  const res = await apiFetch(`/contests/${contestId}/problems`)
  return readResponse(res, "Couldn't load problems. Please try again.")
}

export async function createProblem(contestId, problem) {
  const res = await apiFetch(`/contests/${contestId}/problems`, {
    method: 'POST',
    body: buildProblemFormData(problem),
  })
  return readResponse(res, `Couldn't save the problem (${res.status}). Please try again.`)
}

export async function updateProblem(contestId, problemId, problem) {
  const res = await apiFetch(`/contests/${contestId}/problems/${problemId}`, {
    method: 'PUT',
    body: buildProblemFormData(problem),
  })
  return readResponse(res, `Couldn't save the problem (${res.status}). Please try again.`)
}

export async function deleteProblem(contestId, problemId) {
  const res = await apiFetch(`/contests/${contestId}/problems/${problemId}`, { method: 'DELETE' })
  return readResponse(res, `Couldn't delete the problem (${res.status}). Please try again.`)
}
