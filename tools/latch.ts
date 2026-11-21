// Mode detector latency over recorded showdowns: run the bot in every seat for 90 s and report when it
// latched free-for-all. Usage: bun tools/latch.ts <live.jsonl>
import { loadMatches } from "./cast.ts"
import { simulate } from "./sim.ts"
import { Brain } from "../src/brain.ts"
const Ms = loadMatches(process.argv[2]).filter((m) => m.h.showdown && m.f.length > 1000)
const seen = new Set<number>()
const orig = Brain.prototype.act
let latched = -1, last: any = null
Brain.prototype.act = function (obs: any) { const a = orig.call(this, obs); last = this; return a }
const lat: number[] = []
const intents = new Map<string, number>()
for (const M of Ms) {
  if (seen.has(M.h.seed)) continue
  seen.add(M.h.seed)
  for (let s = 0; s < 16; s++) {
    const r = simulate(M, s, { maxT: 90 })
    const md = last.mode
    lat.push(md.mode === "ffa" ? md.latchedAt : Infinity)
  }
}
lat.sort((a, b) => a - b)
const by30 = lat.filter((v) => v <= 30).length
console.log(`seats ${lat.length}, latched by 30 s: ${by30} (${((100 * by30) / lat.length).toFixed(0)}%), median ${lat[lat.length >> 1].toFixed(1)} s, never ${lat.filter((v) => v === Infinity).length}`)
