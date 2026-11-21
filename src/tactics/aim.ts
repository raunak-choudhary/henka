// Aim solution: lead for the gun, latency compensation, and the fire gate.
import { wrap } from "../vec.ts"

export const LATENCY = 0.1 // an action takes effect for the 2 ticks after the observation

export type AimSol = { yaw: number; pitch: number; dist: number; tof: number; px: number; py: number; pz: number }

/**
 * Lead a target from a muzzle point. `tz` is the target's aim point height (centre of mass).
 * Projectile speed Infinity means hitscan (laser): only latency is compensated.
 */
export function solveAim(mx: number, my: number, mz: number, tx: number, ty: number, tz: number, vx: number, vy: number, vz: number, speed: number, latency = LATENCY): AimSol {
  let px = tx + vx * latency, py = ty + vy * latency, pz = tz + vz * latency
  let tof = 0
  if (Number.isFinite(speed) && speed > 0) {
    for (let k = 0; k < 4; k++) {
      tof = Math.hypot(px - mx, py - my, pz - mz) / speed
      px = tx + vx * (latency + tof)
      py = ty + vy * (latency + tof)
      pz = tz + vz * (latency + tof)
    }
  }
  const h = Math.hypot(px - mx, py - my)
  return { yaw: Math.atan2(py - my, px - mx), pitch: Math.atan2(pz - mz, h), dist: Math.hypot(h, pz - mz), tof, px, py, pz }
}

/** Remaining aim error (rad) after this decision's slew from the actual aim toward the desired one. */
export function errorAfterSlew(actualYaw: number, actualPitch: number, yaw: number, pitch: number, turnRate: number, pitchRate: number, dt = LATENCY): number {
  const ey = Math.max(0, Math.abs(wrap(yaw - actualYaw)) - turnRate * dt)
  const ep = Math.max(0, Math.abs(pitch - actualPitch) - pitchRate * dt)
  return Math.hypot(ey, ep)
}

/** Angular tolerance for a hit on a cylinder of radius r at distance d. */
export function tolerance(r: number, d: number, frac = 0.75): number {
  return Math.atan2(frac * r, Math.max(1, d))
}
