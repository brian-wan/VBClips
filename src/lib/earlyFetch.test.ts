import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_FALLBACK_MS, whenIdle, type IdleEnvironment } from './earlyFetch'

function environment(overrides: Partial<IdleEnvironment> = {}): IdleEnvironment {
  return {
    setTimeout: (callback, ms) => Number(setTimeout(callback, ms)),
    clearTimeout: (id) => clearTimeout(id),
    saveData: false,
    ...overrides,
  }
}

function idleCallbacks() {
  const pending = new Map<number, () => void>()
  let next = 1
  return {
    pending,
    requestIdleCallback: (callback: () => void) => {
      pending.set(next, callback)
      return next++
    },
    cancelIdleCallback: (id: number) => pending.delete(id),
    idle: () => {
      for (const [id, callback] of pending) {
        pending.delete(id)
        callback()
      }
    },
  }
}

describe('whenIdle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs the task at the first idle moment, not before', () => {
    const idle = idleCallbacks()
    const task = vi.fn()
    whenIdle(task, environment(idle))
    vi.advanceTimersByTime(10_000)
    expect(task).not.toHaveBeenCalled()
    idle.idle()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('falls back to a 2 s timer without an idle callback', () => {
    const task = vi.fn()
    whenIdle(task, environment())
    vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the user asked to save data', () => {
    const idle = idleCallbacks()
    const task = vi.fn()
    whenIdle(task, environment({ ...idle, saveData: true }))
    whenIdle(task, environment({ saveData: true }))
    expect(idle.pending.size).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(task).not.toHaveBeenCalled()
  })

  it('cancels a task that has not run yet', () => {
    const idle = idleCallbacks()
    const task = vi.fn()
    whenIdle(task, environment(idle))()
    whenIdle(task, environment())()
    idle.idle()
    vi.advanceTimersByTime(10_000)
    expect(task).not.toHaveBeenCalled()
  })
})
