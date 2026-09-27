// Hand-off from Song/Library ("Edit and regenerate", presets) to the Create screen.
import type { BuilderSpec } from '../api/types'

let pending: BuilderSpec | null = null

export function setDraft(spec: BuilderSpec): void { pending = structuredClone(spec) }

/** Read once: Create consumes the draft on mount. */
export function takeDraft(): BuilderSpec | null {
  const d = pending
  pending = null
  return d
}
