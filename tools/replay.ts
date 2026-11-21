// Drive the bot in-process over a recorded stream (hello, obs..., end) and report timing and stalls.
//   node --experimental-strip-types tools/replay.ts <stream.jsonl[.gz]> [arena dir]
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Brain } from "../src/brain.ts"
import type { Hello, Observation } from "../src/mechfight.ts"

export function loadStream(path: string): any[] {
  let buf = readFileSync(path)
  if (path.endsWith(".gz")) buf = gunzipSync(buf)
  return buf.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
}

export function replay(msgs: any[], arena?: string) {
  const hello = msgs.find((m) => m.type === "hello") as Hello
  if (arena) hello.map.dir = arena
  const t0 = performance.now()
  const brain = new Brain(hello)
  const readyMs = performance.now() - t0
  const times: number[] = []
  const actions: any[] = []
  let errors = 0
  const origErr = console.error
  console.error = (...a: unknown[]) => {
    errors++
    origErr(...a)
  }
  for (const m of msgs) {
    if (m.type !== "obs") continue
    const s = performance.now()
    const a = brain.act(m as Observation)
    times.push(performance.now() - s)
    actions.push(a)
  }
  console.error = origErr
  const sorted = [...times].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return { readyMs, n: times.length, p50: q(0.5), p99: q(0.99), max: q(1), errors, actions, brain }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? "../internal/research/kits/mech/mechfight-kit/check/stream.jsonl.gz"
  const arena = process.argv[3] ?? "../internal/research/kits/mech/mechfight-kit/arena"
  const r = replay(loadStream(path), arena)
  console.log(`ready ${r.readyMs.toFixed(0)} ms, ${r.n} decisions, p50 ${r.p50.toFixed(2)} p99 ${r.p99.toFixed(2)} max ${r.max.toFixed(2)} ms, errors ${r.errors}, plans ${r.brain.motion.plans}, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`)
}
