// Height-field line of sight: blocked if the surface rises above the segment anywhere along it.
import type { GridSpec } from "./terrain.ts"

export function los(spec: GridSpec, surf: Float32Array, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const d = Math.hypot(dx, dy)
  const n = Math.ceil(d)
  if (n < 2) return true
  const { minX, minY, nx, ny } = spec
  const inv = 1 / n
  for (let k = 1; k < n; k++) {
    const t = k * inv
    const i = Math.round(ax + dx * t - minX)
    const j = Math.round(ay + dy * t - minY)
    if (i < 0 || j < 0 || i >= nx || j >= ny) continue
    if (surf[j * nx + i] > az + dz * t) return false
  }
  return true
}
