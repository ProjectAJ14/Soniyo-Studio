import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { notifyReconnected, useAsync } from './async'

it('refetches a view stuck on unreachable when the Mac answers again', async () => {
  let up = false
  const { result } = renderHook(() => useAsync(async () => {
    if (!up) throw new ApiError('unreachable', 'unreachable', 'down', true)
    return 'songs'
  }, []))
  await waitFor(() => expect(result.current[0].status).toBe('error'))
  up = true
  act(() => notifyReconnected())
  await waitFor(() => expect(result.current[0]).toEqual({ status: 'success', data: 'songs' }))
})
