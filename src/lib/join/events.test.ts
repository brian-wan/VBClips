import { describe, expect, it } from 'vitest'
import { applyJoinEvent, type RunningView } from './events'
import type { JoinEvent } from './runner'

const event = (patch: Partial<JoinEvent>): JoinEvent => ({
  phase: 'cut',
  mode: 'fast',
  segmentIndex: 0,
  progress: 0.2,
  remainingSeconds: null,
  label: 'Cutting clip 1 of 2',
  uncached: false,
  ...patch,
})
const start: RunningView = {
  event: event({ phase: 'download', label: 'Loading ffmpeg' }),
  fellBack: false,
  loadingLog: null,
}

describe('applyJoinEvent', () => {
  it('shows every progress event', () => {
    const next = event({ progress: 0.4 })
    expect(applyJoinEvent(start, next)).toEqual({ ...start, event: next })
  })

  it('keeps a log line from the core load to show under the bar', () => {
    const note = event({ phase: 'start', log: 'Multi-thread core did not start' })
    expect(applyJoinEvent(start, note)?.loadingLog).toBe('Multi-thread core did not start')
    const later = applyJoinEvent({ ...start, loadingLog: 'kept' }, event({ phase: 'download' }))
    expect(later?.loadingLog).toBe('kept')
  })

  it('drops ffmpeg log lines once the core is running', () => {
    expect(applyJoinEvent(start, event({ log: 'frame=  120 fps=30' }))).toBeNull()
    expect(applyJoinEvent(start, event({ phase: 'concat', log: 'muxing' }))).toBeNull()
  })

  it('remembers a fallback for the rest of the run', () => {
    const fallback = event({ phase: 'fallback', mode: 'precise', log: 'Re-encoding instead' })
    const after = applyJoinEvent(start, fallback)
    expect(after?.fellBack).toBe(true)
    expect(after && applyJoinEvent(after, event({ mode: 'precise' }))?.fellBack).toBe(true)
  })
})
