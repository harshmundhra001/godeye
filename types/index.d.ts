export type ToolCall = { id: string; tool: string; isDone: boolean }
export type Plan = {
  id: string
  title: string
  description: string[]
  aiAddition: string[]
  examples: string[]
  fyi: string[]
}
export type Note = { id: string; level: 'info' | 'warn' | 'risk'; text: string }
export type Status = 'working' | 'input' | 'done' | 'failed' | 'idle'
export type AgentRow = {
  id: string
  name: string
  desc: string
  state: 'working' | 'done' | 'failed' | 'idle'
  startedAt: number
  endedAt: number
  tokens: number
  model?: string
  effort?: string
  contextTokens?: number
  contextMax?: number
  costUsd?: number
  round?: number
  stepDone?: number
  stepTotal?: number
  stepNote?: string
}
export type SessionRecord = {
  id: string
  project: string
  title: string
  status: Status
  since: number
  cost: number
  agents: AgentRow[]
  beat: number
}
// This session's live readouts (kept in $.state only, never shared).
export type Core = { model: string; effort: string; tokens: number; window: number; percent: number }
export type Bank = {
  percent: number
  used: number
  window: number
  compactAt: number
  compactOn: boolean
  categories: { name: string; tokens: number }[]
  files: { name: string; kind: string; tokens: number }[]
  fileCount: number
  fileTokens: number
  mcpTokens: number
}
export type Flow = {
  startedAt: number
  turns: number
  steps: number
  inputTotal: number
  outTotal: number
  readTotal: number
  writeTotal: number
  outLast: number
  rate: number
  lastAt: number
  lastContext: number
  lastModel: string
  hist: number[]
}
export type Tab ='godeye' | 'plans' | 'lab' | 'settings'

declare module 'claude-code' {
  interface PluginState {
    godeye: {
      calls: ToolCall[]
      tab: Tab
      plans: Plan[]
      hidden: string[]
      editTitle: boolean
      dayLimit: number
      todos: { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }[]
      openPlan: string
      frame: number
      anim: string
      busy: boolean
      status: Status
      since: number
      title: string
      agents: AgentRow[]
      others: SessionRecord[]
      cost: number
      carry: number
      rawCost: number
      knowOn: boolean
      notes: Note[]
      scanning: boolean
      knowStatus: string
      spend: Record<string, number>
      core: Core
      bank: Bank | null
      flow: Flow
      cacheLong: boolean
    }
  }
}
