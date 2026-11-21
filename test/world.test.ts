import { test } from "node:test"
import assert from "node:assert/strict"
import { world, worldJson } from "./helpers.ts"

test("map loads and builds fast", () => {
  const w = world()
  assert.equal(w.loaded, true)
  assert.ok(w.buildMs < 2000)
})

test("known spot heights from terrain.i16", () => {
  const w = world()
  const { minX, minY, nx } = w.spec
  // the value at a grid vertex is the raw sample
  const i = 500, j = 300
  assert.ok(Math.abs(w.ground(minX + i, minY + j) - w.terrain.ground[j * nx + i]) < 1e-4)
})

function tallBuilding() {
  const w = world()
  const wj = worldJson()
  for (const p of wj.prisms) {
    if (p.kind !== "building" || p.holes?.length) continue
    const xs = p.ring.filter((_: number, k: number) => k % 2 === 0), ys = p.ring.filter((_: number, k: number) => k % 2 === 1)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    if (x1 - x0 < 25 || y1 - y0 < 25 || x0 < -480 || x1 > 520 || y0 < -300 || y1 > 360) continue
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    if (p.top - w.ground(cx, cy) < 15 || w.surfaceAt(cx, cy) < p.top - 0.01) continue
    return { p, cx, cy, x0, x1, y0, y1 }
  }
  throw new Error("no building found")
}

test("solid: point inside a building ring is raised to its top", () => {
  const w = world()
  const b = tallBuilding()
  assert.ok(w.surfaceAt(b.cx, b.cy) >= b.p.top - 0.01)
  assert.equal(w.grid.pass[w.grid.idx(b.cx, b.cy)] === 1 && Math.abs(w.grid.height[w.grid.idx(b.cx, b.cy)] - w.ground(b.cx, b.cy)) < 2, false)
})

test("solid: a raised bridge does not block below", () => {
  const w = world()
  const wj = worldJson()
  let checked = 0
  for (const p of wj.prisms) {
    if (p.kind !== "bridge") continue
    const x = p.ring[0] * 0.5 + p.ring[4] * 0.5, y = p.ring[1] * 0.5 + p.ring[5] * 0.5
    const g = w.ground(x, y)
    if (p.base - g < 9.5) continue
    assert.ok(w.surfaceAt(x, y) < p.base, "surface under a raised bridge must stay below its base")
    checked++
  }
  assert.ok(checked >= 1)
})

test("los: blocked through a building, clear over open ground, clear from roof to ground beside it", () => {
  const w = world()
  const b = tallBuilding()
  const ax = b.x0 - 15, bx = b.x1 + 15, y = b.cy
  const az = w.ground(ax, y) + 8, bz = w.ground(bx, y) + 4.5
  assert.equal(w.los(ax, y, az, bx, y, bz), false)
  // roof centre to a point 10 m beyond the edge, looking down
  let ex = b.cx
  while (w.surfaceAt(ex + 1, b.cy) >= b.p.top - 0.01) ex++
  const rx = ex - 3, rz = w.surfaceAt(rx, b.cy) + 8
  assert.equal(w.los(rx, b.cy, rz, ex + 10, b.cy, w.surfaceAt(ex + 10, b.cy) + 4.5), true)
  // and from the roof centre the same ground point is hidden by the roof edge
  assert.equal(w.los(b.cx, b.cy, w.surfaceAt(b.cx, b.cy) + 8, ex + 10, b.cy, w.surfaceAt(ex + 10, b.cy) + 4.5), false)
  // open lawn: find two passable points 60 m apart with flat ground and nothing above
  let found = false
  for (let k = 0; k < w.grid.pass.length && !found; k += 997) {
    if (!w.grid.pass[k] || w.grid.clear[k] < 20) continue
    const x = w.grid.cx(k), yy = w.grid.cy(k)
    if (w.grid.clear[w.grid.idx(x + 30, yy)] < 20) continue
    const z1 = w.ground(x, yy), z2 = w.ground(x + 30, yy)
    if (Math.abs(z1 - z2) > 1) continue
    assert.equal(w.los(x, yy, z1 + 8, x + 30, yy, z2 + 4.5), true)
    found = true
  }
  assert.ok(found)
})

test("nav: 20 seeded pairs in the main component get full paths that never cross a wall", () => {
  const w = world()
  const g = w.grid
  const counts = new Map<number, number>()
  for (let k = 0; k < g.comp.length; k++) if (g.comp[k] >= 0) counts.set(g.comp[k], (counts.get(g.comp[k]) ?? 0) + 1)
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const cells: number[] = []
  for (let k = 0; k < g.comp.length; k++) if (g.comp[k] === main) cells.push(k)
  let s = 7
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  let ok = 0
  for (let q = 0; q < 20; q++) {
    const a = cells[Math.floor(rnd() * cells.length)]
    // pairs within 150 m (the range the bot actually plans over)
    let b = -1
    for (let tries = 0; tries < 200 && b < 0; tries++) {
      const c = cells[Math.floor(rnd() * cells.length)]
      if (Math.hypot(g.cx(c) - g.cx(a), g.cy(c) - g.cy(a)) < 150) b = c
    }
    if (b < 0) continue
    const p = w.nav.find(a, b, 60000)
    assert.equal(p[0], a)
    for (const k of p) assert.equal(g.pass[k], 1)
    if (p[p.length - 1] === b) ok++
  }
  assert.equal(ok, 20)
})

test("nav: a capped search returns a partial path, not nothing", () => {
  const w = world()
  const g = w.grid
  const a = g.nearestPass(g.idx(-400, -200)), b = g.nearestPass(g.idx(450, 300))
  const p = w.nav.find(a, b, 200)
  assert.ok(p.length > 1)
  assert.notEqual(p[p.length - 1], b)
})
