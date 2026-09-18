import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

// A problem statement is authored by whoever runs the contest, but it's
// rendered to participants later — sanitizing keeps a stray pasted <script>
// from ever executing in either preview.
export function renderStatement(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown ?? ''))
}
