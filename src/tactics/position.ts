// Fight position: score a ring of candidate cells around us each tick and steer to the best.
import type { World } from "../world/world.ts"
import type { Track } from "../state/tracker.ts"
import type { ZoneObs } from "../mechfight.ts"
import { outsideNextLate } from "./zone.ts"

const RING: [number, number][] = []
for (let k = 0; k < 16; k++) RING.push([6, (k / 16) * Math.PI * 2])
for (let k = 0; k < 8; k++) RING.push([12, (k / 8) * Math.PI * 2 + Math.PI / 8])

export type PosCtx = {
  w: World
  t: number
  x: number; y: number; z: number
  eye: number
  target: Track
  others: Track[]
  preferred: number
  strafe: number // +1 / -1
  zone: ZoneObs
  cubes: { x: number; y: number }[]
}

export type PosResult = { x: number; y: number; score: number; los: boolean }

export function choosePosition(c: PosCtx): PosResult | null {
  const { w, x, y, target: tg } = c
  const g = w.grid
  const here = g.nearestPass(g.idx(x, y), -1, 3, c.z)
  const comp = here >= 0 ? g.comp[here] : -1
  const tz = tg.z + 4.5
  const bearing = Math.atan2(tg.y - y, tg.x - x)
  const px = -Math.sin(bearing) * c.strafe, py = Math.cos(bearing) * c.strafe
  const n = RING.length
  const ok = new Uint8Array(n)
  const los = new Uint8Array(n)
  const cx = new Float64Array(n), cy = new Float64Array(n), cz = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const [r, a] = RING[k]
    const qx = x + r * Math.cos(a), qy = y + r * Math.sin(a)
    cx[k] = qx
    cy[k] = qy
    if (w.loaded) {
      const K = g.idx(qx, qy)
      if (!g.pass[K] || (comp >= 0 && g.comp[K] !== comp) || !g.walkLine(x, y, qx, qy)) continue
      cz[k] = g.height[K]
    } else cz[k] = c.z
    ok[k] = 1
    los[k] = w.los(qx, qy, cz[k] + c.eye, tg.x, tg.y, tz) ? 1 : 0
  }
  let best: PosResult | null = null
  for (let k = 0; k < n; k++) {
    if (!ok[k]) continue
    const qx = cx[k], qy = cy[k]
    const d = Math.hypot(tg.x - qx, tg.y - qy)
    let s = -Math.abs(d - c.preferred)
    if (los[k]) s += 40
    for (const o of c.others) {
      if (Math.hypot(o.x - qx, o.y - qy) > 220) continue
      if (w.los(o.x, o.y, o.z + 8, qx, qy, cz[k] + 4.5)) s -= 30
    }
    // a corner: next to a ring cell that hides us from the target
    const ringN = k < 16 ? 16 : 8, base = k < 16 ? 0 : 16, j = k - base
    const a = base + ((j + 1) % ringN), b = base + ((j + ringN - 1) % ringN)
    if (los[k] && ((ok[a] && !los[a]) || (ok[b] && !los[b]))) s += 15
    if (w.loaded && g.clear[g.idx(qx, qy)] < 3) s -= 20
    if (outsideNextLate(c.t, qx, qy, c.zone)) s -= 200
    const r = RING[k][0]
    s += 10 * (((qx - x) * px + (qy - y) * py) / r)
    for (const cb of c.cubes) {
      const dc = Math.hypot(cb.x - qx, cb.y - qy)
      if (dc < 40 && dc < Math.hypot(cb.x - x, cb.y - y) - 3) {
        s += 8
        break
      }
    }
    if (!best || s > best.score) best = { x: qx, y: qy, score: s, los: !!los[k] }
  }
  return best
}

/** Nearest reachable cell within maxR that none of `from` can see. */
export function findCover(w: World, x: number, y: number, z: number, from: Track[], maxR: number): { x: number; y: number } | null {
  if (!w.loaded || !from.length) return null
  const g = w.grid
  const here = g.nearestPass(g.idx(x, y), -1, 3, z)
  const comp = here >= 0 ? g.comp[here] : -1
  for (let r = 4; r <= maxR; r += 4) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 4))
    let best: { x: number; y: number } | null = null
    let bd = Infinity
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2
      const qx = x + r * Math.cos(a), qy = y + r * Math.sin(a)
      const K = g.idx(qx, qy)
      if (!g.pass[K] || (comp >= 0 && g.comp[K] !== comp)) continue
      const qz = g.height[K]
      let seen = false
      for (const o of from) {
        if (w.los(o.x, o.y, o.z + 8, qx, qy, qz + 4.5) || w.los(o.x, o.y, o.z + 8, qx, qy, qz + 8.5)) {
          seen = true
          break
        }
      }
      if (seen) continue
      // prefer cells away from the threats
      let away = 0
      for (const o of from) away += Math.hypot(o.x - qx, o.y - qy)
      const score = r - away * 0.01
      if (score < bd && g.walkLine(x, y, qx, qy)) (bd = score), (best = { x: qx, y: qy })
    }
    if (best) return best
  }
  return null
}
