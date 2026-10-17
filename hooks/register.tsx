import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Bank, Core, Flow, Note, Plan, Tab, ToolCall } from '../types'
import { filled, sweep, todoProgress } from './progress'
import type { Todo } from './progress'
import type { AgentRow, SessionRecord, Status } from './sessions'
import { SPIN, STALE_MS, STATUS_COLOR, STATUS_DOT, STATUS_LABEL, agentState, clip, elapsed, tokens } from './sessions'
import { costOf, contextOf, windowOf } from './pricing'
import { ANIMATIONS } from './animations'
import type { Animation, Seg } from './animations'
import { DEFAULT_DAY_LIMIT, bar, bucket, dayKey, levelColor, money, summarize } from './usage'
import type { Spend } from './usage'
import { EMPTY_FLOW, FIVE_MIN, ONE_HOUR, addStep, cacheState, clock, coldPenalty, hitRate, short, spark, toBank } from './vitals'

const PANE = 'godeye'
const calls = atom({ plugin: 'godeye', key: 'calls' } as const, [])
const tab = atom({ plugin: 'godeye', key: 'tab' } as const, 'godeye')
const plans = atom({ plugin: 'godeye', key: 'plans' } as const, [])
const openPlan = atom({ plugin: 'godeye', key: 'openPlan' } as const, '')
const frame = atom({ plugin: 'godeye', key: 'frame' } as const, 0)
const anim = atom({ plugin: 'godeye', key: 'anim' } as const, 'eyeclock')
const spend = atom({ plugin: 'godeye', key: 'spend' } as const, {})
const knowOn = atom({ plugin: 'godeye', key: 'knowOn' } as const, false)
const notes = atom({ plugin: 'godeye', key: 'notes' } as const, [])
const scanning = atom({ plugin: 'godeye', key: 'scanning' } as const, false)
const knowStatus = atom({ plugin: 'godeye', key: 'knowStatus' } as const, '')
const status = atom({ plugin: 'godeye', key: 'status' } as const, 'idle')
const since = atom({ plugin: 'godeye', key: 'since' } as const, 0)
const title = atom({ plugin: 'godeye', key: 'title' } as const, '')
const agents = atom({ plugin: 'godeye', key: 'agents' } as const, [])
const others = atom({ plugin: 'godeye', key: 'others' } as const, [])
const cost = atom({ plugin: 'godeye', key: 'cost' } as const, 0)
const carry = atom({ plugin: 'godeye', key: 'carry' } as const, 0)
const rawCost = atom({ plugin: 'godeye', key: 'rawCost' } as const, 0)
const hidden = atom({ plugin: 'godeye', key: 'hidden' } as const, [])
const editTitle = atom({ plugin: 'godeye', key: 'editTitle' } as const, false)
const todos = atom({ plugin: 'godeye', key: 'todos' } as const, [])
const dayLimit = atom({ plugin: 'godeye', key: 'dayLimit' } as const, DEFAULT_DAY_LIMIT)
const busy = atom({ plugin: 'godeye', key: 'busy' } as const, false)
const core = atom({ plugin: 'godeye', key: 'core' } as const, { model: '', effort: '', tokens: 0, window: 0, percent: 0 })
const bank = atom({ plugin: 'godeye', key: 'bank' } as const, null)
const flow = atom({ plugin: 'godeye', key: 'flow' } as const, EMPTY_FLOW)
const cacheLong = atom({ plugin: 'godeye', key: 'cacheLong' } as const, false)

const SEED: Plan = {
  id: 'godeye-mod',
  title: 'godeye mod',
  description: [
    'Claude pane: eye + clock, usage cost cards, sessions table',
    'You-should-know scanner for what matters in the chat',
  ],
  aiAddition: [],
  examples: ['Names considered: god-eye (chosen), panopticon, argus, overwatch, sentinel, oculus'],
  fyi: ['Animation is picked in the lab tab', 'Look is Claude orange on dark'],
}

// The four sections of a plan, each a heading over any number of points.
const FIELDS = [
  { key: 'description', label: 'DESCRIPTION', color: '#4da3ff' },
  { key: 'aiAddition', label: 'AI ADDITION', color: '#b78cf5' },
  { key: 'examples', label: 'EXAMPLES', color: '#3ddc84' },
  { key: 'fyi', label: 'FYI', color: '#f5d142' },
] as const

// A section saved as one string (an older plan) becomes a list of points.
const points = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v.trim()] : []

// Mirrors of the atoms the timer needs: it only redraws while something moves.
let working = false
let agentsRunning = false
let labOpen = false

let knowEnabled = false
let lastPrompt = ''
let myId = ''
let myProject = ''
let lastWrite = 0
let lastSent = ''
let lastCost = -1
let lastOthers = ''
let lastBank = 0
let lastTick = 0
let lastResponse = 0
let cacheTtlLong = false

const isMain = (e: unknown) => !(e as { agentId?: string }).agentId

// Sessions loaded from different sources (skills dir, --plugin-dir, dev-mods) get
// separate $.store files, so what sessions share lives in one folder of plain files.
// One file a session, as the fs API has no delete and concurrent writers would race
// on a single file.
let sharedDir = ''
const dirOf = async ($: any) => {
  if (!sharedDir) sharedDir = `${(await $.env.get('HOME')) ?? ''}/.claude/godeye-shared`
  return sharedDir
}
const putShared = async ($: any, name: string, value: unknown) =>
  $.fs.write(`${await dirOf($)}/${name}`, JSON.stringify(value))
const getShared = async ($: any, name: string): Promise<unknown> => {
  try {
    return JSON.parse(await $.fs.read(`${await dirOf($)}/${name}`))
  } catch {
    return undefined
  }
}
// Files named `prefix…` changed within `maxAgeMs`, as [name, mtimeMs].
const listShared = async ($: any, prefix: string, maxAgeMs: number): Promise<[string, number][]> => {
  const entries: { name: string; kind: string; mtimeMs: number }[] = await $.fs.list(await dirOf($)).catch(() => [])
  const oldest = Date.now() - maxAgeMs
  return entries
    .filter(f => f.kind === 'file' && f.name.startsWith(prefix) && f.name.endsWith('.json') && f.mtimeMs >= oldest)
    .map(f => [f.name, f.mtimeMs])
}

type LiveAgent = { id: string; name?: string; type: string; description: string; status: string }

// The engine's agent list laid over the rows already held: what the engine knows
// (name, task, status) is refreshed, what the hooks gathered (model, context,
// cost, steps) stays.
const mergeAgents = (rows: AgentRow[], live: LiveAgent[], now: number): AgentRow[] => {
  const byId = new Map(rows.map(r => [r.id, r]))
  const next = live.map(a => {
    const old = byId.get(a.id)
    const state = agentState(a.status)

    return {
      ...old,
      id: a.id,
      name: a.name ?? a.type,
      desc: a.description,
      state,
      startedAt: old?.startedAt ?? now,
      endedAt: state === 'working' ? 0 : old?.endedAt || now,
      tokens: old?.tokens ?? 0,
    } as AgentRow
  })
  const gone = rows
    .filter(r => !live.some(a => a.id === r.id))
    .map(r => (r.state === 'working' ? { ...r, state: 'done' as const, endedAt: now } : r))

  return [...gone, ...next].slice(-12)
}

// The main turn ending is not the end while a subagent still runs.
const effective = (st: Status, rows: AgentRow[]): Status =>
  (st === 'done' || st === 'idle') && rows.some(r => r.state === 'working') ? 'working' : st

// The engine's cost total starts over at /clear. What the cleared windows had
// cost is carried, so the figure shown only ever grows.
const runningCost = async ($: any, raw: number): Promise<number> => {
  const before: number = await read($, rawCost)
  let banked: number = await read($, carry)
  if (raw < before) {
    banked += before
    await update($, carry, () => banked)
  }
  if (raw !== before) await update($, rawCost, () => raw)

  return banked + raw
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The context breakdown is the engine's own estimate (no request is sent), and
// only worth reading now and then.
const readBank = async ($: any) => {
  lastBank = Date.now()
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    if (!context.breakdown) return
    const next: Bank = toBank(context.breakdown)
    if (!sameJson(next, await read($, bank))) await update($, bank, () => next)
  } catch {
    // the readout keeps its last figures
  }
}

// Neural core and the start of a fresh window: figures from the status line's
// own usage, and a reset of this session's totals when /clear starts it over.
const watchSession = async ($: any, usage: { startedAt: number; context: { tokens?: number; window: number; percent?: number } }) => {
  const f: Flow = await read($, flow)
  if (f.startedAt !== usage.startedAt) {
    await update($, flow, () => ({ ...EMPTY_FLOW, startedAt: usage.startedAt }))
    await update($, bank, () => null)
  }
  const c: Core = await read($, core)
  const next: Core = {
    ...c,
    model: c.model || f.lastModel,
    tokens: usage.context.tokens ?? 0,
    window: usage.context.window,
    percent: usage.context.percent ?? 0,
  }
  if (!sameJson(next, c)) await update($, core, () => next)
  if (Date.now() - lastBank > 15_000) await readBank($)
}

// Refreshes the session's agents from the engine, writes this session's record
// where the other sessions read it, and reads theirs.
const poll = async ($: any) => {
  const now = Date.now()
  myId = await $.session.id()
  const live: LiveAgent[] = await $.agent.list()
  const before: AgentRow[] = await read($, agents)
  // Draw again only when something changed: an idle pane should sit still.
  if (JSON.stringify(mergeAgents(before, live, now)) !== JSON.stringify(before)) {
    await update($, agents, (cur: AgentRow[]) => mergeAgents(cur, live, now))
  }
  const rows: AgentRow[] = await read($, agents)
  agentsRunning = rows.some(r => r.state === 'working')
  const usage = await $.session.usage()
  const usd = await runningCost($, usage.cost?.usd ?? 0)
  await watchSession($, usage)
  if (usd !== lastCost) {
    lastCost = usd
    await update($, cost, () => usd)
  }
  const record: SessionRecord = {
    id: myId,
    project: myProject,
    title: await read($, title),
    status: effective(await read($, status), rows),
    since: await read($, since),
    cost: usd,
    agents: rows,
    beat: now,
  }
  const body = JSON.stringify({ ...record, beat: 0 })
  if (body !== lastSent || now - lastWrite > 5000) {
    lastSent = body
    lastWrite = now
    await putShared($, `session-${myId}.json`, record)
  }
  const found: SessionRecord[] = []
  for (const [name] of await listShared($, 'session-', STALE_MS)) {
    if (name === `session-${myId}.json`) continue
    const other = (await getShared($, name)) as SessionRecord | undefined
    if (other && now - other.beat < STALE_MS) found.push(other)
  }
  const seenOthers = JSON.stringify(found.map(o => ({ ...o, beat: 0 })))
  if (seenOthers !== lastOthers) {
    lastOthers = seenOthers
    await update($, others, () => found)
  }
}

const WATCH = `You watch a coding conversation for the user and flag only what they truly should know: risky or destructive actions, security problems, failing or skipped tests, silent assumptions, unfinished work, decisions waiting on them, surprising cost or side effects. Skip routine progress and anything already flagged. Reply with a JSON array of at most 3 objects {"level":"info"|"warn"|"risk","text":"one short sentence"} and nothing else. Reply [] when nothing matters.`

// One cheap model call over the latest exchange and the notes so far.
const scan = async ($: any, answer: string) => {
  await update($, scanning, () => true)
  try {
    const known: Note[] = await read($, notes)
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 400,
      system: WATCH,
      prompt:
        `Already flagged:\n${known.slice(-10).map(n => `- ${n.text}`).join('\n') || '(none)'}\n\n` +
        `User asked:\n${lastPrompt.slice(0, 2000)}\n\nAssistant answered:\n${answer.slice(0, 6000)}`,
    })
    if (!reply.isAnswered) {
      await update($, knowStatus, () => `scan failed: ${reply.reason}`)
      return
    }
    const match = reply.text.match(/\[[\s\S]*\]/)
    const found: { level?: string; text?: string }[] = match ? JSON.parse(match[0]) : []
    const fresh: Note[] = found
      .filter(f => typeof f.text === 'string' && f.text.trim())
      .slice(0, 3)
      .map((f, i) => ({
        id: `${Date.now()}-${i}`,
        level: f.level === 'risk' || f.level === 'warn' ? f.level : 'info',
        text: f.text!.trim(),
      }))
    await update($, notes, list => [...list, ...fresh].slice(-30))
    await update($, knowStatus, () => '')
  } catch (err) {
    await update($, knowStatus, () => 'scan failed')
  } finally {
    await update($, scanning, () => false)
  }
}

type SpendRec = { seen: number; days: Spend }

const SPEND_KEEP_MS = 62 * 86_400_000
// A file is parsed again only when its modified time moves.
const spendCache = new Map<string, { mtime: number; rec: SpendRec | undefined }>()

// Sums every session's own spend record into day totals: the shared files of all
// sessions, over any records this plugin's own store still holds from before.
const totals = async ($: any) => {
  const byId = new Map<string, SpendRec>()
  for (const key of (await $.store.keys()) as string[]) {
    if (!key.startsWith('spend:')) continue
    const rec = (await $.store.get(key)) as SpendRec | undefined
    if (rec) byId.set(key.slice('spend:'.length), rec)
  }
  for (const [name, mtime] of await listShared($, 'spend-', SPEND_KEEP_MS)) {
    let hit = spendCache.get(name)
    if (!hit || hit.mtime !== mtime) {
      hit = { mtime, rec: (await getShared($, name)) as SpendRec | undefined }
      spendCache.set(name, hit)
    }
    if (hit.rec) byId.set(name.slice('spend-'.length, -'.json'.length), hit.rec)
  }
  const sum: Spend = {}
  for (const rec of byId.values()) {
    for (const [d, usd] of Object.entries(rec.days ?? {})) sum[d] = (sum[d] ?? 0) + usd
  }
  await update($, spend, () => sum)
}

// Adds what this session has cost since the last look to today's day total.
// The record is the session's own (by id), so a reload or a restart never
// counts the same dollars twice: a session begun today counts from its first
// dollar, a resumed one only from now on.
const record = async ($: any) => {
  const usage = await $.session.usage()
  const usd: number = usage.cost?.usd ?? 0
  const file = `spend-${myId}.json`
  const today = dayKey(new Date())
  const rec: SpendRec = ((await getShared($, file)) as SpendRec | undefined) ??
    ((await $.store.get(`spend:${myId}`)) as SpendRec | undefined) ?? {
      seen: dayKey(new Date(usage.startedAt)) === today ? 0 : usd,
      days: {},
    }
  const reset = usd < rec.seen
  const delta = reset ? usd : usd - rec.seen
  if (delta > 0 || reset) {
    rec.days[today] = (rec.days[today] ?? 0) + delta
    rec.seen = usd
    await putShared($, file, rec)
  }
  await totals($)
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    lastPrompt = e.text
    await update($, title, () => clip(e.text.replace(/\s+/g, ' ').trim(), 70))
    await update($, since, () => Date.now())
    await update($, status, () => 'working')
    await update($, agents, (rows: AgentRow[]) => rows.filter(r => r.state === 'working'))
    await update($, todos, (list: Todo[]) =>
      list.every(t => t.status === 'completed') ? [] : list,
    )

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (isMain(e)) {
      working = true
      await update($, busy, () => true)
      await update($, status, () => 'working')
    }

    return next(e)
  })

  // A permission dialog is coming: the call waits on the person.
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    if (result.decision === 'ask' && isMain(e)) await update($, status, () => 'input')

    return result
  })

  on('session.end', async ($, e, next) => {
    if (myId) await putShared($, `session-${myId}.json`, { id: myId, beat: 0 })

    return next(e)
  })

  // Each model request of a subagent: its live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    const began = Date.now()
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId && usage) {
      lastResponse = Date.now()
      await update($, flow, (f: Flow) => addStep(f, usage, Date.now() - began, Date.now()))
      await update($, core, (c: Core) => ({
        ...c,
        model: usage.model || e.model,
        effort: e.effort === undefined ? '' : String(e.effort),
      }))
    }
    if (!agentId || !usage) return result

    const model = usage.model || e.model
    await update($, agents, (rows: AgentRow[]) =>
      rows.map(r =>
        r.id !== agentId
          ? r
          : {
              ...r,
              model,
              effort: e.effort === undefined ? r.effort : String(e.effort),
              contextTokens: contextOf(usage),
              contextMax: windowOf(model),
              tokens: (r.tokens || 0) + contextOf(usage),
              costUsd: (r.costUsd ?? 0) + costOf(model, usage),
            },
      ),
    )

    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!isMain(e)) {
      await update($, agents, (rows: AgentRow[]) =>
        rows.map(r => {
          if (r.id !== e.agentId) return r
          // A run whose steps went unseen still gets the turn's own sum.
          const fallback = r.costUsd === undefined && e.usage
          const state = e.reason === 'answer' ? ('done' as const) : ('failed' as const)

          return {
            ...r,
            state,
            endedAt: Date.now(),
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || r.model,
                  tokens: contextOf(e.usage),
                  costUsd: costOf(e.usage.model || r.model || '', e.usage),
                }
              : {}),
          }
        }),
      )

      return next(e)
    }
    working = false
    await update($, busy, () => false)
    await update($, flow, (f: Flow) => ({ ...f, turns: f.turns + 1 }))
    void readBank($)
    await update($, status, () =>
      e.reason === 'error' || e.reason === 'refusal' ? 'failed' : 'done',
    )
    await record($)
    if (knowEnabled && !e.agentId && e.answer.trim()) void scan($, e.answer)

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'godeye',
      description: 'Open the GOD-EYE pane: live tool calls, plans and animation lab',
    })
    const saved = await $.store.get('plans')
    const list: Plan[] = Array.isArray(saved)
      ? (saved as Record<string, unknown>[]).map(p => ({
          id: String(p.id),
          title: String(p.title),
          description: [...points(p.description), ...points(p.items)],
          aiAddition: points(p.aiAddition),
          examples: points(p.examples),
          fyi: points(p.fyi),
        }))
      : [SEED]
    await update($, plans, () => list)
    if (!Array.isArray(saved)) await $.store.set('plans', list)
    await $.store.delete('spend')
    knowEnabled = (await $.store.get('knowOn')) === true
    await update($, knowOn, () => knowEnabled)
    const gone = await $.store.get('hiddenAnims')
    if (Array.isArray(gone)) await update($, hidden, () => gone as string[])
    const savedLimit = await $.store.get('dayLimit')
    if (typeof savedLimit === 'number' && savedLimit > 0) await update($, dayLimit, () => savedLimit)
    cacheTtlLong = (await $.store.get('cacheLong')) === true
    await update($, cacheLong, () => cacheTtlLong)
    lastResponse = (await read($, flow)).lastAt
    const chosen = await $.store.get('anim')
    if (typeof chosen === 'string') await update($, anim, () => chosen)
    myId = await $.session.id()
    myProject = (await $.session.cwd()).split('/').filter(Boolean).pop() ?? ''
    await record($)
    $.clock.every(2000, () => void poll($))
    void poll($)
    // Redraw while something moves, and once a second while the cache counts down.
    $.clock.every(250, async () => {
      const now = Date.now()
      const tick = working || agentsRunning || labOpen
      const counting = lastResponse > 0 && now - lastResponse < (cacheTtlLong ? ONE_HOUR : FIVE_MIN) + 1000
      if (!tick && !(counting && now - lastTick >= 1000)) return
      lastTick = now
      void update($, frame, n => n + 1)
    })
    void $.ui.open({ id: PANE, title: 'GOD-EYE' })

    return next(e)
  })

  on('command.run', { command: 'godeye' }, async $ => {
    await $.ui.open({ id: PANE, title: 'GOD-EYE' })

    return { text: 'GOD-EYE opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const call: ToolCall = { id: e.tool_use_id, tool: e.tool, isDone: false }
    await update($, calls, list => [...list, call].slice(-200))
    if (isMain(e) && e.tool === 'TodoWrite') {
      const list = (e as unknown as { todos?: Todo[] }).todos
      if (Array.isArray(list)) await update($, todos, () => list)
    }
    const asks = isMain(e) && e.tool === 'AskUserQuestion'
    if (isMain(e)) await update($, status, () => (asks ? 'input' : 'working'))
    const ran = await next(e)
    if (isMain(e)) await update($, status, () => 'working')
    await update($, calls, list =>
      list.map(one => (one.id === call.id ? { ...one, isDone: true } : one)),
    )
    await record($)

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows: AgentRow[] = await read($, agents)
    const st: Status = effective(await read($, status), rows)
    const n = await read($, frame)
    if (e.props.hasSurvey || (st !== 'working' && st !== 'input' && rows.length === 0)) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = Date.now()
    const started: number = await read($, since)
    const spent: number = await read($, cost)
    const color = STATUS_COLOR[st]
    const running = rows.filter(r => r.state === 'working').length

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={color}>
            {STATUS_DOT[st]} {STATUS_LABEL[st]}
          </Text>
          {started > 0 && <Text dimColor>  {elapsed(now - started)}</Text>}
          <Text dimColor>  ${spent.toFixed(2)}</Text>
          {rows.length > 0 && (
            <Text dimColor>  {rows.length} agents, {running} running</Text>
          )}
          {rows.length > 0 && st !== 'working' && st !== 'input' && (
            <Button key="agents-hide" onPress={() => void update($, agents, () => [])}>
              <Text dimColor>  [hide]</Text>
            </Button>
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const current: Tab = await read($, tab)
    const list = await read($, calls)
    const saved = await read($, plans)
    const openId = await read($, openPlan)
    const n = await read($, frame)
    const chosen = await read($, anim)
    const isBusy = await read($, busy)
    const know = await read($, knowOn)
    const noted: Note[] = await read($, notes)
    const isScanning = await read($, scanning)
    const knowMsg = await read($, knowStatus)
    const toggleKnow = async () => {
      knowEnabled = !know
      await update($, knowOn, () => knowEnabled)
      await $.store.set('knowOn', knowEnabled)
    }
    const totals = await read($, spend)
    const limit: number = await read($, dayLimit)
    const rows = summarize(totals, new Date(), limit)
    const wide = (e.viewport?.columns ?? 120) >= 96
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 6 - 9)
    const show = (next: Tab) => () => {
      labOpen = next === 'lab'
      void update($, tab, () => next)
    }
    const draw = (rows: Seg[][], busyNow: boolean) =>
      rows.map(row => (
        <Box>
          {row.map(seg => (
            <Text color={seg.color} dimColor={seg.dim}>
              {seg.text}
            </Text>
          ))}
        </Box>
      ))
    const save = async (next: Plan[]) => {
      await update($, plans, () => next)
      await $.store.set('plans', next)
    }
    const pick = async (id: string) => {
      await update($, anim, () => id)
      await $.store.set('anim', id)
    }
    const tabText = (name: Tab, label: string) => (
      <Text
        bold={current === name}
        dimColor={current !== name}
        color={current === name ? 'claude' : undefined}
      >
        {` ${label} `}
      </Text>
    )
    const myAgents: AgentRow[] = await read($, agents)
    const myStatus: Status = effective(await read($, status), myAgents)
    const mine: SessionRecord = {
      id: myId,
      project: myProject,
      title: await read($, title),
      status: myStatus,
      since: await read($, since),
      cost: await read($, cost),
      agents: await read($, agents),
      beat: Date.now(),
    }
    const all: SessionRecord[] = [mine, ...(await read($, others))].sort(
      (a, b) => b.since - a.since,
    )
    const task = todoProgress(await read($, todos))
    const coreNow: Core = await read($, core)
    const bankNow: Bank | null = await read($, bank)
    const flowNow: Flow = await read($, flow)
    const longCache: boolean = await read($, cacheLong)
    const ttl = longCache ? ONE_HOUR : FIVE_MIN
    const cache = cacheState(flowNow, ttl, Date.now())
    const penalty = coldPenalty(flowNow)
    const legion = mine.agents
    const legionRun = legion.filter(a => a.state === 'working').length
    const legionDone = legion.filter(a => a.state === 'done').length
    const legionBad = legion.filter(a => a.state === 'failed').length
    const legionTok = legion.reduce((sum, a) => sum + (a.tokens || 0), 0)
    const legionUsd = legion.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
    const ctxPercent = bankNow ? bankNow.percent : coreNow.percent
    const card = { flexDirection: 'column', borderStyle: 'round', borderColor: 'claude', paddingX: 1, marginRight: 1, width: 40 } as const
    const meter = (ratio: number, width: number) =>
      bar(ratio, width).map((seg, i) => (
        <Text key={`m${i}`} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
      ))
    const mainActive = myStatus === 'working' || myStatus === 'input'
    // The chat's own bar: the todo list when there is one, else a sweep while it
    // works; full green once it, and every agent under it, is done.
    const mainBar: Seg[] =
      myStatus === 'done'
        ? filled(1, 30, '#3ddc84')
        : myStatus === 'failed'
          ? filled(1, 30, '#ff5c5c')
          : task.total > 0
            ? filled(task.done / task.total, 30, '#ff9d3d')
            : mainActive
              ? sweep(n, 30, '#ff9d3d')
              : filled(0, 30, '#9a9a96')
    const plan = saved.find(p => p.id === openId)
    const renaming: boolean = await read($, editTitle)
    const gone: string[] = await read($, hidden)
    const visible = ANIMATIONS.filter(a => !gone.includes(a.id))
    const active: Animation = visible.find(a => a.id === chosen) ?? visible[0] ?? ANIMATIONS[0]
    const setGone = async (next: string[]) => {
      await update($, hidden, () => next)
      await $.store.set('hiddenAnims', next)
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Button key="tab-godeye" onPress={show('godeye')}>
            {tabText('godeye', 'godeye')}
          </Button>
          <Text>   </Text>
          <Button key="tab-plans" onPress={show('plans')}>
            {tabText('plans', `plans ${saved.length}`)}
          </Button>
          <Text>   </Text>
          <Button key="tab-lab" onPress={show('lab')}>
            {tabText('lab', 'lab')}
          </Button>
          <Text>   </Text>
          <Button key="tab-settings" onPress={show('settings')}>
            {tabText('settings', 'settings')}
          </Button>
        </Box>
        <Text> </Text>
        {current === 'godeye' && (
          <Box flexDirection="column">
            <Box flexDirection={wide ? 'row' : 'column'} alignItems="center">
              <Box flexDirection="column" marginRight={wide ? 8 : 0} marginBottom={wide ? 0 : 1}>
                {draw(active.lines(n, isBusy), isBusy)}
              </Box>
              <Box flexDirection="column">
                <Text bold color="claude">USAGE COST</Text>
                <Box>
                  {rows.map(row => {
                    const ratio = row.usd / row.limit
                    const color = levelColor(ratio)
                    return (
                      <Box
                        key={`use-${row.label}`}
                        flexDirection="column"
                        alignItems="center"
                        borderStyle="round"
                        paddingX={1}
                        marginRight={1}
                      >
                        <Text dimColor>{row.label}</Text>
                        <Text bold color={color}>{money(row.usd)}</Text>
                        <Text dimColor>of ${row.limit}</Text>
                        {draw(bucket(ratio), false)}
                        <Text color={color}>
                          {ratio >= 1 ? 'OVER' : `${Math.round(ratio * 100)}%`}
                        </Text>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            </Box>
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="claude" paddingX={1}>
              <Text bold color="claude">PROGRESS</Text>
              <Box key="progress-main" flexDirection="column" marginTop={1}>
                <Text>
                  <Text bold color={STATUS_COLOR[myStatus]}>
                    {STATUS_DOT[myStatus]} {STATUS_LABEL[myStatus]}
                  </Text>
                  <Text bold> {myProject || 'this chat'}</Text>
                  <Text dimColor>  {clip(mine.title, 40)}</Text>
                </Text>
                {task.current !== '' && (
                  <Text dimColor>  {task.done}/{task.total} · {clip(task.current, 50)}</Text>
                )}
                <Box>
                  <Text dimColor>  </Text>
                  {mainBar.map((seg, i) => (
                    <Text key={`b${i}`} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
                  ))}
                  <Text dimColor>
                    {' '}
                    {task.total > 0 ? `${task.done}/${task.total} tasks · ` : ''}${mine.cost.toFixed(2)}
                    {mainActive && mine.since > 0 ? ` · ${elapsed(Date.now() - mine.since)}` : ''}
                  </Text>
                </Box>
              </Box>
              {mine.agents.length === 0 && <Text dimColor>No agents</Text>}
              {mine.agents.map(agent => {
                const isWorking = agent.state === 'working'
                const icon = isWorking ? SPIN[n % SPIN.length] : agent.state === 'done' ? '✔' : agent.state === 'failed' ? '✘' : '○'
                const iconColor = isWorking ? 'claude' : agent.state === 'done' ? '#3ddc84' : agent.state === 'failed' ? '#ff5c5c' : undefined

                // Progress: step-based if available, otherwise context-based
                const stepTotal = agent.stepTotal ?? 0
                const hasSteps = stepTotal > 0
                const progress = agent.state === 'done' ? 1 : hasSteps ? Math.min(1, (agent.stepDone || 0) / stepTotal) : (agent.contextTokens && agent.contextMax ? Math.min(1, agent.contextTokens / agent.contextMax) : 0)
                const ctx = agent.contextTokens && agent.contextMax ? Math.min(100, Math.round((agent.contextTokens / agent.contextMax) * 100)) : 0

                const barWidth = 30
                const barSegs = isWorking && !hasSteps
                  ? sweep(n, barWidth, '#ff9d3d')
                  : filled(
                      progress,
                      barWidth,
                      agent.state === 'done' ? '#3ddc84' : agent.state === 'failed' ? '#ff5c5c' : hasSteps ? '#ff9d3d' : '#9a9a96',
                    )

                const meta = []
                if (agent.model) meta.push(agent.model)
                if (agent.effort) meta.push(agent.effort)
                if ((agent.round || 1) > 1) meta.push(`round ${agent.round}`)
                if (agent.state === 'failed') meta.push('error')

                const stats = []
                if (agent.contextTokens && agent.contextMax) stats.push(`ctx ${ctx}%`)
                stats.push(`${tokens(agent.contextTokens || agent.tokens || 0)} tok`)
                if (agent.costUsd !== undefined) stats.push(`$${agent.costUsd < 0.01 ? agent.costUsd.toFixed(3) : agent.costUsd.toFixed(2)}`)
                stats.push(elapsed((agent.endedAt || Date.now()) - agent.startedAt))

                return (
                  <Box key={`progress-${agent.id}`} flexDirection="column" marginTop={1}>
                    <Text>
                      <Text color={iconColor}>{icon}</Text>
                      <Text dimColor> </Text>
                      <Text color="claude">{clip(agent.name, 25)}</Text>
                      <Text dimColor> {clip(agent.desc, 35)}</Text>
                    </Text>
                    {meta.length > 0 && (
                      <Text dimColor>  {meta.join(' · ')}</Text>
                    )}
                    {hasSteps && agent.stepNote && (
                      <Text dimColor>  {agent.stepDone}/{agent.stepTotal} · {clip(agent.stepNote, 40)}</Text>
                    )}
                    <Box>
                      <Text dimColor>  </Text>
                      {barSegs.map((seg, i) => (
                        <Text key={`b${i}`} color={seg.color} dimColor={seg.dim}>{seg.text}</Text>
                      ))}
                      <Text dimColor> {stats.join(' · ')}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
              <Box key="core-card" {...card}>
                <Text bold color="claude">NEURAL CORE</Text>
                <Text>
                  <Text bold>{coreNow.model || flowNow.lastModel || 'no response yet'}</Text>
                  {coreNow.effort !== '' && <Text dimColor>  effort {coreNow.effort}</Text>}
                </Text>
                <Text dimColor>
                  window {short(coreNow.window)} · context {Math.round(ctxPercent)}%
                </Text>
                <Text dimColor>
                  {flowNow.turns} turns · {flowNow.steps} requests · ${mine.cost.toFixed(2)}
                </Text>
                <Text dimColor>
                  last request {short(flowNow.lastContext)} tok in context
                </Text>
              </Box>
              <Box key="bank-card" {...card}>
                <Text bold color="claude">MEMORY BANK</Text>
                <Box>
                  {meter(ctxPercent / 100, 22)}
                  <Text> {Math.round(ctxPercent)}%</Text>
                </Box>
                {bankNow ? (
                  <Box flexDirection="column">
                    <Text dimColor>
                      {short(bankNow.used)} of {short(bankNow.window)} tokens
                      {bankNow.compactOn && bankNow.compactAt > 0 ? ` · compacts at ${short(bankNow.compactAt)}` : ' · auto-compact off'}
                    </Text>
                    {bankNow.categories.map(c => (
                      <Text key={`cat-${c.name}`} dimColor>  {clip(c.name, 24).padEnd(24)} {short(c.tokens)}</Text>
                    ))}
                    <Text dimColor>
                      memory files {bankNow.fileCount} ({short(bankNow.fileTokens)})
                      {bankNow.mcpTokens > 0 ? ` · mcp ${short(bankNow.mcpTokens)}` : ''}
                    </Text>
                    {bankNow.files.map(f => (
                      <Text key={`file-${f.name}`} dimColor>  {clip(f.name, 24).padEnd(24)} {short(f.tokens)}</Text>
                    ))}
                  </Box>
                ) : (
                  <Text dimColor>reading the window…</Text>
                )}
              </Box>
              <Box key="cache-card" {...card}>
                <Text bold color="claude">CACHE GUARD</Text>
                {cache.kind === 'none' && <Text dimColor>No response yet, nothing cached.</Text>}
                {cache.kind === 'warm' && (
                  <Box flexDirection="column">
                    <Text>
                      <Text bold color={levelColor(cache.ratio)}>WARM {clock(cache.left)}</Text>
                      <Text dimColor> left of {longCache ? '1h' : '5m'}</Text>
                    </Text>
                    <Box>{meter(cache.ratio, 28)}</Box>
                    <Text dimColor>
                      {cache.left < 60_000
                        ? 'Expiring: send now to keep it, or the next prompt re-caches.'
                        : `A prompt before then reads it at ${money(penalty.warm)}.`}
                    </Text>
                  </Box>
                )}
                {cache.kind === 'cold' && (
                  <Box flexDirection="column">
                    <Text bold color="#ff5c5c">COLD</Text>
                    <Text dimColor>Expired {elapsed(cache.ago)} ago.</Text>
                    <Text dimColor>
                      Next prompt re-caches {short(flowNow.lastContext)} tok: {money(penalty.cold)} instead of {money(penalty.warm)}.
                    </Text>
                  </Box>
                )}
                <Text dimColor>
                  hit rate {Math.round(hitRate(flowNow) * 100)}% · read {short(flowNow.readTotal)} · wrote {short(flowNow.writeTotal)}
                </Text>
              </Box>
              <Box key="out-card" {...card}>
                <Text bold color="claude">REPULSOR OUTPUT</Text>
                <Text>
                  <Text bold>{short(flowNow.outTotal)}</Text>
                  <Text dimColor> output tokens this session</Text>
                </Text>
                <Text dimColor>
                  last {short(flowNow.outLast)}
                  {flowNow.rate > 0 ? ` · ${Math.round(flowNow.rate)} tok/s` : ''}
                  {flowNow.turns > 0 ? ` · avg ${short(flowNow.outTotal / flowNow.turns)} a turn` : ''}
                </Text>
                <Text color="claude">{flowNow.hist.length > 0 ? spark(flowNow.hist) : ' '}</Text>
                <Text dimColor>per request, newest right</Text>
              </Box>
              <Box key="legion-card" {...card}>
                <Text bold color="claude">IRON LEGION</Text>
                {legion.length === 0 && <Text dimColor>No subagents this session.</Text>}
                {legion.length > 0 && (
                  <Box flexDirection="column">
                    <Text>
                      <Text color="claude">{legionRun} running</Text>
                      <Text color="#3ddc84">  {legionDone} done</Text>
                      <Text color={legionBad > 0 ? '#ff5c5c' : undefined} dimColor={legionBad === 0}>  {legionBad} failed</Text>
                    </Text>
                    <Text>
                      {legion.map(a => (
                        <Text
                          key={`unit-${a.id}`}
                          color={a.state === 'working' ? 'claude' : a.state === 'done' ? '#3ddc84' : a.state === 'failed' ? '#ff5c5c' : undefined}
                        >
                          {a.state === 'working' ? SPIN[n % SPIN.length] : a.state === 'done' ? '■' : a.state === 'failed' ? '✘' : '□'}
                        </Text>
                      ))}
                    </Text>
                    <Text dimColor>
                      {short(legionTok)} tok · ${legionUsd.toFixed(2)} est.
                    </Text>
                    {legion.filter(a => a.state === 'working').slice(0, 3).map(a => (
                      <Text key={`unit-run-${a.id}`} dimColor>  {clip(a.name, 18)} {clip(a.desc, 18)}</Text>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
            <Box flexDirection="column" marginTop={1}>
              <Box marginTop={1}>
                {(['working', 'input', 'done', 'failed'] as Status[]).map(st => (
                  <Text key={`legend-${st}`} color={STATUS_COLOR[st]}>
                    {STATUS_DOT[st]} {STATUS_LABEL[st]} {all.filter(x => x.status === st).length}
                    {'   '}
                  </Text>
                ))}
              </Box>
              {all.map(x => {
                const color = STATUS_COLOR[x.status]
                const running = x.agents.filter(a => a.state === 'working').length
                return (
                  <Box key={`sess-${x.id}`} flexDirection="column" marginTop={1}>
                    <Text>
                      <Text bold color={color}>
                        {STATUS_DOT[x.status]} {STATUS_LABEL[x.status].padEnd(11)}
                      </Text>
                      <Text bold> {x.project || 'session'}</Text>
                      {x.id === myId && <Text dimColor> (this one)</Text>}
                      <Text dimColor>  ${x.cost.toFixed(2)}</Text>
                      {x.since > 0 && <Text dimColor>  {elapsed(Date.now() - x.since)}</Text>}
                    </Text>
                    {x.title && <Text dimColor>  {clip(x.title, 80)}</Text>}
                    {x.agents.length > 0 && (
                      <Text dimColor>
                        {`  ↳ ${x.agents.length} agents: ${running} running, ${x.agents.filter(a => a.state === 'done').length} done, ${x.agents.filter(a => a.state === 'failed').length} failed`}
                      </Text>
                    )}
                  </Box>
                )
              })}
            </Box>
            <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
              <Box marginTop={1} marginBottom={1}>
                <Text bold color="claude">YOU SHOULD KNOW</Text>
                <Text dimColor>  {noted.length} noted</Text>
                {know && isScanning && <Text color="claude">  scanning…</Text>}
                {noted.length > 0 && (
                  <Button key="know-clear" onPress={() => void update($, notes, () => [])}>
                    <Text dimColor>  [clear]</Text>
                  </Button>
                )}
              </Box>
              {!know && <Text dimColor>Off. Turn it on in settings to scan each reply with a small model (uses tokens).</Text>}
              {know && noted.length === 0 && !knowMsg && <Text dimColor>Nothing to flag so far.</Text>}
              {knowMsg && <Text color="red">{knowMsg}</Text>}
              {noted.slice(-4).map(note => (
                <Button
                  key={`note-${note.id}`}
                  onPress={() => void update($, notes, l => l.filter(x => x.id !== note.id))}
                >
                  <Text color={note.level === 'risk' ? 'red' : note.level === 'warn' ? 'yellow' : 'blue'}>
                    ● <Text>{note.text}</Text>
                  </Text>
                </Button>
              ))}
              {noted.length > 4 && <Text dimColor>+{noted.length - 4} older</Text>}
              {noted.length > 0 && <Text dimColor>press a note to dismiss it</Text>}
            </Box>
            {list.filter(c => !c.isDone).slice(-3).map(call => (
              <Text key={`run-${call.id}`} color="claude">⠿ running {call.tool}</Text>
            ))}
          </Box>
        )}
        {current === 'plans' && !plan && (
          <Box flexDirection="column">
            <Input
              key="plan-new"
              label="New plan"
              placeholder="heading, Enter to create its card"
              submitLabel="add"
              onSubmit={(text: string) => {
                const heading = text.trim()
                if (heading)
                  void save([
                    ...saved,
                    {
                      id: String(Date.now()),
                      title: heading,
                      description: [],
                      aiAddition: [],
                      examples: [],
                      fyi: [],
                    },
                  ])
              }}
            />
            {saved.length === 0 && <Text dimColor>No plans yet.</Text>}
            <Box flexDirection="row" flexWrap="wrap">
              {saved.map(one => {
                const total = FIELDS.reduce((sum, f) => sum + one[f.key].length, 0)
                return (
                  <Box
                    key={`plan-card-${one.id}`}
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="claude"
                    paddingX={1}
                    marginRight={1}
                    width={38}
                  >
                    <Button
                      key={`plan-${one.id}`}
                      onPress={() => void update($, openPlan, () => one.id)}
                    >
                      <Text bold color="claude">{clip(one.title, 34)} ›</Text>
                    </Button>
                    <Text dimColor>{clip(one.description[0] ?? 'no description yet', 34)}</Text>
                    <Text dimColor>
                      {FIELDS.map(f => `${one[f.key].length}`).join(' · ')}  ({total} points)
                    </Text>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}
        {current === 'plans' && plan && (
          <Box flexDirection="column">
            <Box>
              <Button key="plan-back" onPress={() => void update($, openPlan, () => '')}>
                <Text dimColor> ‹ back  </Text>
              </Button>
              <Button
                key="plan-rename"
                onPress={() => void update($, editTitle, v => !v)}
              >
                <Text dimColor>[rename]  </Text>
              </Button>
              <Button
                key="plan-delete"
                onPress={() => {
                  void save(saved.filter(p => p.id !== plan.id))
                  void update($, openPlan, () => '')
                  void update($, editTitle, () => false)
                }}
              >
                <Text color="#ff5c5c">[x] delete</Text>
              </Button>
            </Box>
            <Box marginTop={2} marginBottom={1} flexDirection="column">
              <Text bold color="claude">{plan.title.toUpperCase()}</Text>
              <Text color="claude">{'━'.repeat(Math.max(8, Math.min(60, plan.title.length + 4)))}</Text>
            </Box>
            {renaming && (
              <Input
                key="f-title"
                label="Heading"
                value={plan.title}
                placeholder="heading"
                submitLabel="save"
                onSubmit={text => {
                  const v = text.trim()
                  if (v) void save(saved.map(p => (p.id === plan.id ? { ...p, title: v } : p)))
                  void update($, editTitle, () => false)
                }}
              />
            )}
            {FIELDS.map(f => (
              <Box key={`sec-${f.key}`} flexDirection="column" marginTop={2}>
                <Text bold color={f.color}>
                  {f.label} <Text dimColor>({plan[f.key].length})</Text>
                </Text>
                <Text color={f.color} dimColor>{'─'.repeat(f.label.length + 4)}</Text>
                {plan[f.key].map((point, i) => (
                  <Box key={`pt-${f.key}-${i}`}>
                    <Text color="claude">  • {point}</Text>
                    <Button
                      key={`pt-del-${f.key}-${i}`}
                      onPress={() =>
                        void save(
                          saved.map(p =>
                            p.id === plan.id
                              ? { ...p, [f.key]: p[f.key].filter((_, j) => j !== i) }
                              : p,
                          ),
                        )
                      }
                    >
                      <Text color="#ff5c5c">  [x]</Text>
                    </Button>
                  </Box>
                ))}
                <Input
                  key={`add-${f.key}`}
                  label="  +"
                  placeholder="add a point, Enter to save"
                  submitLabel="add"
                  onSubmit={text => {
                    const v = text.trim()
                    if (v)
                      void save(
                        saved.map(p =>
                          p.id === plan.id ? { ...p, [f.key]: [...p[f.key], v] } : p,
                        ),
                      )
                  }}
                />
              </Box>
            ))}
          </Box>
        )}
        {current === 'settings' && (
          <Box flexDirection="column">
            <Box marginTop={2} marginBottom={1}>
              <Button key="know-toggle" onPress={() => void toggleKnow()}>
                <Text bold color={know ? 'green' : undefined} dimColor={!know}>
                  {know ? '[ ON ] ' : '[ OFF ]'}
                </Text>
              </Button>
              <Text bold>  You should know</Text>
            </Box>
            <Text dimColor>
              Scans each reply with a small model and flags what matters. Uses tokens.
            </Text>
            <Box marginTop={2} flexDirection="column">
              <Input
                key="day-limit"
                label="Daily limit $"
                value={String(limit)}
                placeholder="e.g. 20"
                submitLabel="save"
                onSubmit={async text => {
                  const v = Number(text.replace(/[$,\s]/g, ''))
                  if (!Number.isFinite(v) || v <= 0) return
                  await update($, dayLimit, () => v)
                  await $.store.set('dayLimit', v)
                }}
              />
              <Text dimColor>Week and month limits follow from it (7× and days in the month).</Text>
            </Box>
            <Box marginTop={2} flexDirection="column">
              <Box>
                <Button
                  key="cache-ttl"
                  onPress={async () => {
                    cacheTtlLong = !longCache
                    await update($, cacheLong, () => cacheTtlLong)
                    await $.store.set('cacheLong', cacheTtlLong)
                  }}
                >
                  <Text bold color="claude">[ {longCache ? '1 hour' : '5 minutes'} ]</Text>
                </Button>
                <Text bold>  Cache lifetime</Text>
              </Box>
              <Text dimColor>How long the cache guard counts. Press to switch if your setup caches for an hour.</Text>
            </Box>
          </Box>
        )}
        {current === 'lab' && (
          <Box flexDirection="column">
            <Text dimColor>Press Select under the one you like. It plays in the godeye tab (the eye+clock shows working, then idle).</Text>
            <Box flexDirection="row" flexWrap="wrap">
              {visible.map(a => (
                <Box
                  key={`anim-${a.id}`}
                  flexDirection="column"
                  borderStyle="round"
                  width={34}
                >
                  <Text bold color={a.id === active.id ? 'claude' : undefined}>
                    {a.name}
                    {a.id === active.id ? '  ✔ selected' : ''}
                  </Text>
                  {draw(a.lines(n, true), true)}
                  {a.id === 'eyeclock' && draw(a.lines(n, false), false)}
                  <Box>
                    <Button key={`pick-${a.id}`} onPress={() => void pick(a.id)}>
                      <Text bold>[ Select ]</Text>
                    </Button>
                    <Button key={`del-${a.id}`} onPress={() => void setGone([...gone, a.id])}>
                      <Text color="#ff5c5c">  [x]</Text>
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
            {gone.length > 0 && (
              <Button key="restore-anims" onPress={() => void setGone([])}>
                <Text dimColor>[restore {gone.length} deleted]</Text>
              </Button>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
