// Incoming projectile check: which shot will pass within our radius + margin soon, and which way to step.
import type { ProjectileObs } from "../mechfight.ts"

export type Dodge = { dx: number; dy: number; tHit: number } | null

export function dodgeVector(px: number, py: number, pz: number, height: number, radius: number, projectiles: ProjectileObs[], horizon: number, margin: number): Dodge {
  let best: Dodge = null
  const cz = pz + height / 2
  for (const p of projectiles ?? []) {
    if (p.kind === "mortar") continue
    const rx = p.pos[0] - px, ry = p.pos[1] - py, rz = p.pos[2] - cz
    const vx = p.vel[0], vy = p.vel[1], vz = p.vel[2]
    const vv = vx * vx + vy * vy
    if (vv < 1) continue
    const tc = -(rx * vx + ry * vy) / vv // time of closest horizontal approach
    if (tc < 0 || tc > horizon) continue
    const cx = rx + vx * tc, cy = ry + vy * tc
    const miss = Math.hypot(cx, cy)
    const zAt = rz + vz * tc
    if (miss > radius + margin || Math.abs(zAt) > height / 2 + 1) continue
    if (best && best.tHit <= tc) continue
    // step perpendicular to the shot, to the side the shot already misses on
    const l = Math.sqrt(vv)
    let nx = -vy / l, ny = vx / l
    if (cx * nx + cy * ny > 0) (nx = -nx), (ny = -ny) // move away from the closest-approach point
    best = { dx: nx, dy: ny, tHit: tc }
  }
  return best
}
