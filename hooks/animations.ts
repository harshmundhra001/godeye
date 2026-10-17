export type Seg = { text: string; color?: string; dim?: boolean }
export type Animation = {
  id: string
  name: string
  lines: (n: number, busy: boolean) => Seg[][]
}
type Plain = (n: number) => string[]

const pingpong = (n: number, max: number) => {
  const m = n % (max * 2)
  return m <= max ? m : max * 2 - m
}

const eye: Plain = n => {
  const blink = n % 24 > 21
  const x = pingpong(Math.floor(n / 2), 6)
  if (blink) return ['  .-------.  ', ' (  -----  ) ', "  '-------'  "]
  const row = ' '.repeat(x) + '●' + ' '.repeat(6 - x)
  return ['  .-------.  ', ` (  ${row}  ) `, "  '-------'  "]
}

const radar: Plain = n => {
  const rows = 7
  const cols = 15
  const angle = ((n % 24) / 24) * Math.PI * 2
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      const dx = (c - 7) / 2
      const dy = r - 3
      const dist = Math.hypot(dx, dy)
      if (dist > 3.2) line += ' '
      else if (dist < 0.5) line += '+'
      else {
        const a = Math.atan2(dy, dx)
        const diff = (angle - a + Math.PI * 4) % (Math.PI * 2)
        line += diff < 0.3 ? '#' : diff < 1.0 ? '·' : dist > 2.8 ? '.' : ' '
      }
    }
    out.push(line)
  }
  return out
}

const rain: Plain = n => {
  const rows = 6
  const cols = 16
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      const head = (n + c * 5) % (rows + 6)
      const behind = head - r
      line += behind === 0 ? '1' : behind > 0 && behind < 4 ? ((c + r) % 2 ? '0' : '1') : ' '
    }
    out.push(line)
  }
  return out
}

const wave: Plain = n => {
  const bars = '▁▂▃▄▅▆▇█'
  let line = ''
  for (let i = 0; i < 28; i++) {
    const v = Math.sin((i + n) / 2.5) * 0.6 + Math.sin((i + n) / 1.3) * 0.4
    line += bars[Math.min(7, Math.max(0, Math.round(((v + 1) / 2) * 7)))]
  }
  return [line, 'calls/s  ' + (3 + (n % 5))]
}

const boot: Plain = n => {
  const text = ['INITIALIZING GOD-EYE...', 'LINKING TOOL FEED... OK', 'TARGETS ACQUIRED']
  const total = text.join('').length + 12
  let left = n % total
  return text.map(t => {
    const shown = Math.max(0, Math.min(t.length, left))
    left -= t.length
    return t.slice(0, shown) + (shown > 0 && shown < t.length ? '█' : '')
  })
}

const spinner: Plain = n => {
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  const done = n % 30 > 22
  return [
    `${done ? '✔' : frames[n % frames.length]} Bash ${done ? 'done' : 'running'}`,
    `${frames[(n + 3) % frames.length]} Read  running`,
  ]
}

const tinted = (f: Plain): Animation['lines'] => n => f(n).map(text => [{ text, color: 'claude' }])

export const hsl = (h: number, sat: number, l: number) => {
  const a = sat * Math.min(l, 1 - l)
  const k = (m: number) => {
    const v = l - a * Math.max(-1, Math.min((m + h / 30) % 12 - 3, 9 - ((m + h / 30) % 12), 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${k(0)}${k(8)}${k(4)}`
}

const EYE_BLUE = '#4da3ff'
const eyeOpen = (shift: number, pupil: string) => [
  '   .-"""-.   ',
  '  / (' + ' '.repeat(1 + shift) + pupil + ' '.repeat(1 - shift) + ') \\  ',
  "   '-...-'   ",
]
const EYE_SHUT = ['             ', '  ╰───────╯  ', '             ']

// An eye inside a clock ring: shut and the ring still while idle; open with a
// gradient hand sweeping the ring while working.
const eyeclock: Animation['lines'] = (n, busy) => {
  const rows = 13
  const cols = 33
  const cx = 16
  const cy = 6
  const R = 5.6
  const head = busy ? (n * Math.PI) / 10 : 0
  const hue = (n * 9) % 360
  const pupil = '◉'
  const shift = busy ? [0, 1, 1, 0, -1, -1][Math.floor(n / 3) % 6] : 0
  const eye = busy ? eyeOpen(shift, pupil) : EYE_SHUT
  const out: Seg[][] = []
  for (let r = 0; r < rows; r++) {
    const line: Seg[] = []
    for (let c = 0; c < cols; c++) {
      const dx = (c - cx) / 2
      const dy = r - cy
      const dist = Math.hypot(dx, dy)
      const er = r - (cy - 1)
      const ec = c - (cx - 6)
      let seg: Seg = { text: ' ' }
      if (er >= 0 && er < 3 && ec >= 0 && ec < 13) {
        const ch = eye[er][ec]
        seg = { text: ch, color: EYE_BLUE }
      } else if (Math.abs(dist - R) < 0.55) {
        if (!busy) seg = { text: '·', dim: true }
        else {
          const a = Math.atan2(dy, dx)
          const behind = (head - a + Math.PI * 4) % (Math.PI * 2)
          if (behind < 0.35) seg = { text: '●', color: hsl(hue, 1, 0.65) }
          else if (behind < 1.8)
            seg = {
              text: behind < 0.9 ? '•' : '·',
              color: hsl((hue + 300 - behind * 70) % 360, 0.9, 0.6),
            }
          else seg = { text: '·', dim: true }
        }
      }
      const last = line[line.length - 1]
      if (last && last.color === seg.color && last.dim === seg.dim) last.text += seg.text
      else line.push(seg)
    }
    out.push(line)
  }
  return out
}

export const ANIMATIONS: Animation[] = [
  { id: 'eyeclock', name: '★ Eye + clock', lines: eyeclock },
  { id: 'eye', name: 'Scanning eye', lines: tinted(eye) },
  { id: 'radar', name: 'Radar sweep', lines: tinted(radar) },
  { id: 'rain', name: 'Data rain', lines: tinted(rain) },
  { id: 'wave', name: 'Waveform', lines: tinted(wave) },
  { id: 'boot', name: 'Boot sequence', lines: tinted(boot) },
  { id: 'spinner', name: 'Call spinners', lines: tinted(spinner) },
]
