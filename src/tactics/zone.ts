// Zone handling: where to stand to be inside the next circle, and when we must leave now.
import type { ZoneObs } from "../mechfight.ts"
import { PARAMS } from "../config.ts"

export type ZonePlan = { mustGo: boolean; late: boolean; tx: number; ty: number; insideNext: boolean; distNext: number }

/** Seconds of walking needed to reach the safe point inside the next circle. */
export function zoneTravel(x: number, y: number, z: ZoneObs, speed: number): number {
  const d = Math.hypot(x - z.next_center[0], y - z.next_center[1])
  const safe = z.next_radius * (1 - PARAMS.common.zoneInsideFrac)
  return Math.max(0, d - safe) / Math.max(1, speed)
}

export function zonePlan(t: number, x: number, y: number, inZone: boolean, z: ZoneObs, speed: number): ZonePlan {
  const P = PARAMS.common
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
  return { mustGo, late, tx, ty, insideNext, distNext: d }
}

/** True if a candidate point should be discarded because it is outside the next circle late in the hold. */
export function outsideNextLate(t: number, px: number, py: number, z: ZoneObs): boolean {
  if (t < z.shrink_start - PARAMS.common.zoneDiscardLead) return false
  return Math.hypot(px - z.next_center[0], py - z.next_center[1]) > z.next_radius - 2
}
