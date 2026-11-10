import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id'

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses randomUUID when the context has it', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('falls back to 128 random bits as hex without randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(171),
    })
    expect(newId()).toBe('ab'.repeat(16))
  })
})
