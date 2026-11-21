// World build and query benchmark: node --experimental-strip-types tools/bench.ts <arena dir>
import { World } from "../src/world/world.ts"
const dir = process.argv[2] ?? "../internal/research/kits/mech/mechfight-kit/arena"
const t0 = performance.now()
const w = World.load(dir, ["v2/world.json", "v2/terrain.i16"])
console.log("load+build ms", (performance.now() - t0).toFixed(1), "build", w.buildMs.toFixed(1), "loaded", w.loaded)
const g = w.grid
let pass = 0
for (let k = 0; k < g.pass.length; k++) pass += g.pass[k]
const comps = new Map<number, number>()
for (let k = 0; k < g.comp.length; k++) if (g.comp[k] >= 0) comps.set(g.comp[k], (comps.get(g.comp[k]) ?? 0) + 1)
const sizes = [...comps.values()].sort((a, b) => b - a)
console.log("passable", pass, "of", g.pass.length, "components", sizes.length, "largest", sizes.slice(0, 5))
let s = 12345
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
const main = sizes.length ? [...comps.entries()].find(([, v]) => v === sizes[0])![0] : -1
const cells: number[] = []
for (let k = 0; k < g.comp.length; k++) if (g.comp[k] === main) cells.push(k)
const times: number[] = []
let partial = 0
for (let q = 0; q < 40; q++) {
  const a = cells[Math.floor(rnd() * cells.length)], b = cells[Math.floor(rnd() * cells.length)]
  const t = performance.now()
  const p = w.nav.find(a, b, 6000)
  times.push(performance.now() - t)
  if (p[p.length - 1] !== b) partial++
}
times.sort((a, b) => a - b)
console.log("A* cap 6000: median ms", times[20].toFixed(2), "max", times[39].toFixed(2), "partial", partial, "of 40")
const t2 = performance.now()
let vis = 0
for (let q = 0; q < 20000; q++) {
  const ax = -400 + rnd() * 800, ay = -250 + rnd() * 500, bx = ax + (rnd() - 0.5) * 300, by = ay + (rnd() - 0.5) * 300
  if (w.los(ax, ay, w.ground(ax, ay) + 8, bx, by, w.ground(bx, by) + 4.5)) vis++
}
console.log("los us/ray", (((performance.now() - t2) * 1000) / 20000).toFixed(2), "visible", vis / 20000)
console.log("rss MB", (process.memoryUsage().rss / 1e6).toFixed(0))
