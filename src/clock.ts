// Injected time, so tests run waits (write spacing, rate limits) without waiting.

/** `sleep` may end early once `signal` aborts. */
export type Clock = { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> }

/** The browser clock: a sleep ends early when its signal aborts. */
export const browserClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve()
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      signal?.addEventListener('abort', done)
    }),
}
