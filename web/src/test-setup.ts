import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// No vitest globals, so Testing Library cannot auto-register this.
afterEach(cleanup)
