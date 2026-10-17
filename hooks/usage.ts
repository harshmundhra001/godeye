import { hsl } from './animations'
import type { Seg } from './animations'

export const DEFAULT_DAY_LIMIT = 20
export type Spend = Record<string, number>
export type Row = { label: string; usd: number; limit: number }

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Today, the last 7 days, and the calendar month so far. Week and month limits
// are the daily limit scaled, as only the daily one is set.
export const summarize = (spend: Spend, now: Date, dayLimit: number): Row[] => {
  let week = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    week += spend[dayKey(d)] ?? 0
  }
  const prefix = dayKey(now).slice(0, 7)
  const month = Object.entries(spend).reduce(
    (sum, [key, usd]) => (key.startsWith(prefix) ? sum + usd : sum),
    0,
  )
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return [
    { label: 'TODAY', usd: spend[dayKey(now)] ?? 0, limit: dayLimit },
    { label: 'WEEK', usd: week, limit: dayLimit * 7 },
    { label: 'MONTH', usd: month, limit: dayLimit * days },
  ]
}

// Green until 50% of the limit, then through yellow to red at the limit.
export const levelColor = (ratio: number) => {
  const over = Math.min(1, Math.max(0, (ratio - 0.5) / 0.5))
  return hsl(130 - over * 130, 0.85, 0.55)
}

export const money = (usd: number) => `$${usd.toFixed(2)}`

const EIGHTHS = ' ▏▎▍▌▋▊▉'
export const bar = (ratio: number, width: number): Seg[] => {
  const color = levelColor(ratio)
  const cells = Math.min(1, Math.max(0, ratio)) * width
  const full = Math.floor(cells)
  const part = EIGHTHS[Math.floor((cells - full) * 8)]
  const fill = '█'.repeat(full) + (full < width ? part : '')
  const rest = width - fill.length
  return [
    { text: fill, color },
    { text: '░'.repeat(Math.max(0, rest)), dim: true },
  ]
}

const LEVELS = ' ▁▂▃▄▅▆▇'

// A bucket that fills from the bottom: `rows` high, `inner` wide, the liquid
// in the level colour with a part-filled top row.
export const bucket = (ratio: number, inner = 9, rows = 6): Seg[][] => {
  const color = levelColor(ratio)
  const level = Math.min(1, Math.max(0, ratio)) * rows
  const full = Math.floor(level)
  const part = LEVELS[Math.floor((level - full) * 8)]
  const out: Seg[][] = []
  for (let r = 0; r < rows; r++) {
    const fromBottom = rows - 1 - r
    const liquid =
      fromBottom < full ? '█' : fromBottom === full && part !== ' ' ? part : ' '
    out.push([
      { text: '│', dim: true },
      { text: liquid.repeat(inner), color },
      { text: '│', dim: true },
    ])
  }
  out.push([{ text: `╰${'─'.repeat(inner)}╯`, dim: true }])
  return out
}
