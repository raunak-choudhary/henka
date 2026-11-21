// Rasterise prisms into a 1 m "surface" height field used for walls and line of sight.
import type { Terrain } from "./terrain.ts"

export type Prism = { kind?: string; base: number; top: number; ring: number[]; holes?: number[][] }

/**
 * surface[k] = max(ground, top of every prism covering cell k), except prisms whose base is at least
 * `headroom` above the ground there (raised bridges: mechs walk and shoot under them).
 */
export function rasterise(terrain: Terrain, prisms: Prism[], headroom: number): Float32Array {
  const { minX, minY, step, nx, ny } = terrain.spec
  const ground = terrain.ground
  const surf = Float32Array.from(ground)
  const xs: number[] = []
  for (const p of prisms) {
    const rings = [p.ring, ...(p.holes ?? [])].filter((r) => Array.isArray(r) && r.length >= 6)
    if (!rings.length || !Number.isFinite(p.top) || !Number.isFinite(p.base)) continue
    let y0 = Infinity
    let y1 = -Infinity
    for (let k = 1; k < p.ring.length; k += 2) {
      if (p.ring[k] < y0) y0 = p.ring[k]
      if (p.ring[k] > y1) y1 = p.ring[k]
    }
    const j0 = Math.max(0, Math.ceil((y0 - minY) / step))
    const j1 = Math.min(ny - 1, Math.floor((y1 - minY) / step))
    for (let j = j0; j <= j1; j++) {
      const y = minY + j * step
      xs.length = 0
      for (const r of rings) {
        const n = r.length >> 1
        for (let a = 0; a < n; a++) {
          const b = (a + 1) % n
          const ax = r[2 * a], ay = r[2 * a + 1], bx = r[2 * b], by = r[2 * b + 1]
          if (ay <= y === by <= y) continue
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
        }
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - minX) / step))
        const i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - minX) / step))
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i
          if (p.base - ground[k] >= headroom) continue
          if (p.top > surf[k]) surf[k] = p.top
        }
      }
    }
  }
  return surf
}
