import type { Seg } from './animations'

const EIGHTHS = ' ▏▎▍▌▋▊▉'

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }

// A determinate bar: `ratio` of `width` filled in eighths of a cell.
export const filled = (ratio: number, width: number, color: string): Seg[] => {
  const cells = Math.min(1, Math.max(0, ratio)) * width
  const full = Math.floor(cells)
  const part = full < width ? EIGHTHS[Math.floor((cells - full) * 8)] : ''
  const fill = '█'.repeat(full) + part
  return [
    { text: fill, color },
    { text: '░'.repeat(Math.max(0, width - fill.length)), dim: true },
  ]
}

// An indeterminate bar for work with no known length: a block that sweeps
// back and forth along the track.
export const sweep = (n: number, width: number, color: string): Seg[] => {
  const block = Math.max(3, Math.floor(width / 4))
  const span = width - block
  const m = n % (span * 2)
  const at = m <= span ? m : span * 2 - m
  return [
    { text: '░'.repeat(at), dim: true },
    { text: '█'.repeat(block), color },
    { text: '░'.repeat(span - at), dim: true },
  ]
}

export const todoProgress = (todos: Todo[]) => {
  const done = todos.filter(t => t.status === 'completed').length
  const current = todos.find(t => t.status === 'in_progress')

  return { done, total: todos.length, current: current?.activeForm ?? '' }
}
