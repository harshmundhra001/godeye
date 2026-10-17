import { test, expect } from 'claude-code/testing'

import { EMPTY_FLOW, FIVE_MIN, addStep, cacheState, clock, coldPenalty, hitRate, spark } from './vitals'

const usage = { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 500, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1900 }

test('a main response adds to the session totals', async () => {
  const f = addStep(EMPTY_FLOW, usage, 5000, 1000)
  expect(f.outTotal).toBe(500)
  expect(f.rate).toBe(100)
  expect(f.lastContext).toBe(10500)
  expect(f.hist).toEqual([500])
  expect(Math.round(hitRate(f) * 100)).toBe(80)
})

test('the cache counts down from the last response and goes cold', async () => {
  const f = addStep(EMPTY_FLOW, usage, 1000, 10_000)
  expect(cacheState(EMPTY_FLOW, FIVE_MIN, 0).kind).toBe('none')
  const warm = cacheState(f, FIVE_MIN, 10_000 + 60_000)
  expect(warm.kind === 'warm' && warm.left).toBe(FIVE_MIN - 60_000)
  expect(cacheState(f, FIVE_MIN, 10_000 + FIVE_MIN).kind).toBe('cold')
  const p = coldPenalty(f)
  expect(p.cold).toBeGreaterThan(p.warm)
})

test('clock and spark format', async () => {
  expect(clock(61_000)).toBe('1:01')
  expect(spark([0, 5, 10])).toBe(' ▄█')
})
