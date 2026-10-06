import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchHesitation } from './hesitation.ts'

function fakeDocument() {
  const target = new EventTarget()
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    setVisibility(state: DocumentVisibilityState) {
      doc.visibilityState = state
      target.dispatchEvent(new Event('visibilitychange'))
    },
  }
  return doc
}

describe('watchHesitation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('nudges once the time has passed while visible', () => {
    const onHesitate = vi.fn()
    watchHesitation(fakeDocument(), 20_000, onHesitate)
    vi.advanceTimersByTime(19_999)
    expect(onHesitate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHesitate).toHaveBeenCalledTimes(1)
  })

  it('does not count time while the tab is hidden', () => {
    const doc = fakeDocument()
    const onHesitate = vi.fn()
    watchHesitation(doc, 20_000, onHesitate)
    vi.advanceTimersByTime(15_000)
    doc.setVisibility('hidden')
    vi.advanceTimersByTime(60_000)
    expect(onHesitate).not.toHaveBeenCalled()
    doc.setVisibility('visible')
    vi.advanceTimersByTime(4_999)
    expect(onHesitate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHesitate).toHaveBeenCalledTimes(1)
  })

  it('starts counting only once a hidden tab becomes visible', () => {
    const doc = fakeDocument()
    doc.visibilityState = 'hidden'
    const onHesitate = vi.fn()
    watchHesitation(doc, 20_000, onHesitate)
    vi.advanceTimersByTime(30_000)
    expect(onHesitate).not.toHaveBeenCalled()
    doc.setVisibility('visible')
    vi.advanceTimersByTime(20_000)
    expect(onHesitate).toHaveBeenCalledTimes(1)
  })

  it('never nudges after cleanup', () => {
    const doc = fakeDocument()
    const onHesitate = vi.fn()
    const cleanup = watchHesitation(doc, 20_000, onHesitate)
    vi.advanceTimersByTime(10_000)
    cleanup()
    doc.setVisibility('hidden')
    doc.setVisibility('visible')
    vi.advanceTimersByTime(60_000)
    expect(onHesitate).not.toHaveBeenCalled()
  })
})
