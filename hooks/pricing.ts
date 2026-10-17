// USD per million tokens: input, output, cache read, cache write. The first row
// matching a model id wins, so a release sits above its family. The engine reports
// tokens, not money, so a subagent's cost is an estimate.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 charges more for a request whose prompt is over 100,000 tokens.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export const costOf = (model: string, u: Usage): number => {
  const id = model.toLowerCase()
  const inT = u.input_tokens || 0
  const cr = u.cache_read_input_tokens || 0
  const cw = u.cache_creation_input_tokens || 0
  const prompt = inT + cr + cw
  const [i, o, r, w] =
    prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)
      ? HAIKU_LONG
      : (PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8])

  return (inT * i + (u.output_tokens || 0) * o + cr * r + cw * w) / 1e6
}

export const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

export const contextOf = (u: Usage): number =>
  (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
