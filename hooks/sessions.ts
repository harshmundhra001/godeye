export type { AgentRow, SessionRecord, Status } from '../types'
import type { AgentRow, Status } from '../types'

export const STATUS_COLOR: Record<Status, string | undefined> = {
  working: 'claude',
  input: '#f5d142',
  done: '#3ddc84',
  failed: '#ff5c5c',
  idle: undefined,
}
export const STATUS_LABEL: Record<Status, string> = {
  working: 'in progress',
  input: 'needs input',
  done: 'completed',
  failed: 'failed',
  idle: 'idle',
}
export const STATUS_DOT: Record<Status, string> = {
  working: '●',
  input: '◆',
  done: '✔',
  failed: '✘',
  idle: '○',
}

export const STALE_MS = 20_000
export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// What a subagent's AgentStatus means for the bar.
export const agentState = (status: string): AgentRow['state'] =>
  status === 'completed'
    ? 'done'
    : status === 'failed' || status === 'killed'
      ? 'failed'
      : status === 'idle'
        ? 'idle'
        : 'working'
