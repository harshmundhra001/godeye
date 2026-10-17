import type { Bank, Flow } from '../types'
import { costOf } from './pricing'
import type { Usage } from './pricing'

// The five live readouts of this session only: nothing here is written to a
// shared file or to $.store, so another session never sees it.

export const FIVE_MIN = 5 * 60_000
export const ONE_HOUR = 60 * 60_000
export const HIST = 16

export const EMPTY_FLOW: Flow = {
  startedAt: 0,
  turns: 0,
  steps: 0,
  inputTotal: 0,
  outTotal: 0,
  readTotal: 0,
  writeTotal: 0,
  outLast: 0,
  rate: 0,
  lastAt: 0,
  lastContext: 0,
  lastModel: '',
  hist: [],
}

// Folds one main-loop response into the session's totals. `ms` is how long the
// request took, for the output rate.
export const addStep = (flow: Flow, u: Usage & { model?: string }, ms: number, now: number): Flow => {
  const out = u.output_tokens || 0
  const read = u.cache_read_input_tokens || 0
  const write = u.cache_creation_input_tokens || 0
  const input = u.input_tokens || 0

  return {
    ...flow,
    steps: flow.steps + 1,
    inputTotal: flow.inputTotal + input,
    outTotal: flow.outTotal + out,
    readTotal: flow.readTotal + read,
    writeTotal: flow.writeTotal + write,
    outLast: out,
    rate: ms >= 300 && out > 0 ? out / (ms / 1000) : flow.rate,
    lastAt: now,
    lastContext: input + read + write + out,
    lastModel: u.model || flow.lastModel,
    hist: [...flow.hist, out].slice(-HIST),
  }
}

// Share of the prompt tokens the cache served, over the whole session.
export const hitRate = (flow: Flow): number => {
  const all = flow.inputTotal + flow.readTotal + flow.writeTotal

  return all > 0 ? flow.readTotal / all : 0
}

export type CacheState = { kind: 'none' } | { kind: 'warm'; left: number; ratio: number } | { kind: 'cold'; ago: number }

// The prompt cache lives `ttl` ms after the last response that read or wrote
// it, and every main-loop response renews it.
export const cacheState = (flow: Flow, ttl: number, now: number): CacheState => {
  if (flow.lastAt <= 0) return { kind: 'none' }
  const age = Math.max(0, now - flow.lastAt)

  return age >= ttl ? { kind: 'cold', ago: age - ttl } : { kind: 'warm', left: ttl - age, ratio: age / ttl }
}

// What re-sending the context costs cold (cache write) against warm (cache read).
export const coldPenalty = (flow: Flow): { cold: number; warm: number } => {
  const model = flow.lastModel
  const tokens = flow.lastContext

  return {
    cold: costOf(model, { cache_creation_input_tokens: tokens }),
    warm: costOf(model, { cache_read_input_tokens: tokens }),
  }
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const LEVELS = '▁▂▃▄▅▆▇█'

// One block per value, scaled to the tallest.
export const spark = (values: number[]): string => {
  const top = Math.max(1, ...values)

  return values.map(v => (v <= 0 ? ' ' : LEVELS[Math.min(7, Math.floor((v / top) * 7.999))])).join('')
}

export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))

export const fileName = (path: string) => path.split('/').filter(Boolean).slice(-2).join('/')

// The breakdown the memory bank keeps: the engine's /context figures, trimmed.
export const toBank = (b: {
  percentage: number
  totalTokens: number
  rawMaxTokens: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
  categories: { name: string; tokens: number; kind: string }[]
  memoryFiles: { path: string; type: string; tokens: number }[]
  mcpTools: { tokens: number }[]
}): Bank => ({
  percent: b.percentage,
  used: b.totalTokens,
  window: b.rawMaxTokens,
  compactAt: b.autoCompactThreshold ?? 0,
  compactOn: b.isAutoCompactEnabled,
  categories: b.categories
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, c) => c.tokens - a.tokens)
    .slice(0, 4)
    .map(c => ({ name: c.name, tokens: c.tokens })),
  files: b.memoryFiles
    .slice()
    .sort((a, c) => c.tokens - a.tokens)
    .slice(0, 3)
    .map(f => ({ name: fileName(f.path), kind: f.type, tokens: f.tokens })),
  fileCount: b.memoryFiles.length,
  fileTokens: b.memoryFiles.reduce((sum, f) => sum + f.tokens, 0),
  mcpTokens: b.mcpTools.reduce((sum, t) => sum + t.tokens, 0),
})
