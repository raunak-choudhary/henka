// Zone handling: where to stand to be inside the next circle, and when we must leave now.
import type { ZoneObs } from "../mechfight.ts"
import { PARAMS } from "../config.ts"

export type ZonePlan = { mustGo: boolean; late: boolean; should: boolean; tx: number; ty: number; insideNext: boolean; distNext: number }

/** Seconds of walking needed to reach the safe point inside the next circle. */
export function zoneTravel(x: number, y: number, z: ZoneObs, speed: number): number {
  const d = Math.hypot(x - z.next_center[0], y - z.next_center[1])
  const safe = z.next_radius * (1 - PARAMS.common.zoneInsideFrac)
  return Math.max(0, d - safe) / Math.max(1, speed)
}

/**
 * When the moving edge (circle interpolated from the current to the next one over the shrink window)
 * first comes within `pad` m of (x, y). Infinity when it never does before the next circle is set.
 */
export function edgeDeadline(x: number, y: number, z: ZoneObs, pad: number, now = -Infinity): number {
  const S = 24
  const t0 = z.shrink_start, t1 = z.shrink_end
  const out = (cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) > r - pad
  if (now < t0 && out(z.center[0], z.center[1], z.radius)) return now
  for (let k = 0; k <= S; k++) {
    const ts = t0 + ((t1 - t0) * k) / S
    if (ts < now) continue
    const f = t1 > t0 ? (ts - t0) / (t1 - t0) : 1
    const cx = z.center[0] + (z.next_center[0] - z.center[0]) * f
    const cy = z.center[1] + (z.next_center[1] - z.center[1]) * f
    const r = z.radius + (z.next_radius - z.radius) * f
    if (out(cx, cy, r)) return ts
  }
  return Infinity
}

/**
 * Rim hold (squad mode): stay where we are while we are inside the next circle by a margin; otherwise
 * go to the nearest point of that inner ring. Leave only when the moving edge would reach us first.
 */
export function rimPlan(t: number, x: number, y: number, inZone: boolean, z: ZoneObs, speed: number): ZonePlan {
  const P = PARAMS.common
  const cx = z.next_center[0], cy = z.next_center[1]
  const R = z.next_radius
  const d = Math.hypot(x - cx, y - cy)
  const ring = R - (Math.min(30, Math.max(3, 0.3 * R)) + 5)
  let tx = x, ty = y
  if (R <= 30 || ring <= 0) (tx = cx), (ty = cy)
  else if (d > ring) (tx = cx + ((x - cx) / d) * ring), (ty = cy + ((y - cy) / d) * ring)
  const plan: ZonePlan = { mustGo: false, late: false, should: false, tx, ty, insideNext: d <= R - 3, distNext: d }
  rimTiming(plan, t, x, y, inZone, z, Math.hypot(tx - x, ty - y), speed)
  return plan
}

/** Set mustGo / late / should from the walking distance to the hold point (straight line or path length). */
export function rimTiming(plan: ZonePlan, t: number, x: number, y: number, inZone: boolean, z: ZoneObs, walkDist: number, speed: number) {
  const P = PARAMS.common
  const away = Math.hypot(plan.tx - x, plan.ty - y) > 0.5
  const lead = t + (walkDist / Math.max(1, speed)) * P.rimTravelMult
  // leave by the earlier of: the moving edge reaching us, and the end of the shrink (sim: holding at the rim
  // and leaving on the edge time alone got caught outside where the walk in detours around buildings)
  const dl = P.rimLeaveByEnd ? Math.min(edgeDeadline(x, y, z, 8, t), z.shrink_end) : edgeDeadline(x, y, z, 8, t)
  plan.mustGo = !inZone || (away && lead + P.rimSlackS >= dl)
  plan.late = !inZone || (away && lead + 2 >= dl)
  plan.should = away && lead + P.rimSoftS >= dl
}

export function zonePlan(t: number, x: number, y: number, inZone: boolean, z: ZoneObs, speed: number): ZonePlan {
  const P = PARAMS.common
  if (P.rimHold && (inZone || !P.rimOutsideOld)) return rimPlan(t, x, y, inZone, z, speed)
  const cx = z.next_center[0], cy = z.next_center[1]
  const d = Math.hypot(x - cx, y - cy)
  const safeR = z.next_radius * (1 - P.zoneInsideFrac)
  let tx = cx, ty = cy
  if (d > 1e-6 && safeR > 0) {
    tx = cx + ((x - cx) / d) * safeR
    ty = cy + ((y - cy) / d) * safeR
  }
  const travel = zoneTravel(x, y, z, speed)
  const timeLeft = z.shrink_end - t
  const insideNext = d <= z.next_radius - 3
  const mustGo = !inZone || (!insideNext && travel * P.zoneSafety + P.zoneSlackS >= timeLeft)
  const late = !inZone || (!insideNext && travel * P.zoneSafety + 2 >= timeLeft - 4)
  return { mustGo, late, should: false, tx, ty, insideNext, distNext: d }
}

/** True if a candidate point should be discarded because it is outside the next circle late in the hold. */
export function outsideNextLate(t: number, px: number, py: number, z: ZoneObs): boolean {
  if (t < z.shrink_start - PARAMS.common.zoneDiscardLead) return false
  return Math.hypot(px - z.next_center[0], py - z.next_center[1]) > z.next_radius - 2
}
