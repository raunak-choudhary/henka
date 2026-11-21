// 2 m walk grid derived from the 1 m surface: wall cells, clearance, connected components.
import type { GridSpec } from "./terrain.ts"

export class NavGrid {
  W: number
  H: number
  minX: number
  minY: number
  cell = 2
  height: Float32Array // mean surface height of the cell
  wall: Uint8Array // 1 = step or slope too large inside or at the border of the cell
  clear: Float32Array // metres to the nearest wall cell, capped
  pass: Uint8Array // walkable for a mech centre
  comp: Int32Array // component id of passable cells, -1 otherwise

  constructor(spec: GridSpec, surf: Float32Array, stepUp: number, minClear = 2, cap = 20) {
    const nx = spec.nx, ny = spec.ny
    const W = (this.W = nx >> 1)
    const H = (this.H = ny >> 1)
    this.minX = spec.minX
    this.minY = spec.minY
    const N = W * H
    this.height = new Float32Array(N)
    this.wall = new Uint8Array(N)
    this.clear = new Float32Array(N)
    this.pass = new Uint8Array(N)
    this.comp = new Int32Array(N).fill(-1)
    // 1 m edge test: right and up neighbours within the step limit.
    const bad = (i: number, j: number, i2: number, j2: number) => {
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) return true
      return Math.abs(surf[j * nx + i] - surf[j2 * nx + i2]) > stepUp
    }
    for (let J = 0; J < H; J++)
      for (let I = 0; I < W; I++) {
        const i = 2 * I, j = 2 * J
        const K = J * W + I
        this.height[K] = (surf[j * nx + i] + surf[j * nx + i + 1] + surf[(j + 1) * nx + i] + surf[(j + 1) * nx + i + 1]) * 0.25
        let w = 0
        for (let dj = 0; dj < 2 && !w; dj++)
          for (let di = 0; di < 2 && !w; di++) {
            const a = i + di, b = j + dj
            if (bad(a, b, a + 1, b) || bad(a, b, a - 1, b) || bad(a, b, a, b + 1) || bad(a, b, a, b - 1)) w = 1
          }
        if (I === 0 || J === 0 || I === W - 1 || J === H - 1) w = 1
        this.wall[K] = w
      }
    // Two-pass chamfer distance (2 m orthogonal, 2.83 m diagonal).
    const d = this.clear
    for (let K = 0; K < N; K++) d[K] = this.wall[K] ? 0 : cap
    const D = 2, DD = 2.828
    for (let J = 0; J < H; J++)
      for (let I = 0; I < W; I++) {
        const K = J * W + I
        let v = d[K]
        if (I > 0) v = Math.min(v, d[K - 1] + D)
        if (J > 0) {
          v = Math.min(v, d[K - W] + D)
          if (I > 0) v = Math.min(v, d[K - W - 1] + DD)
          if (I < W - 1) v = Math.min(v, d[K - W + 1] + DD)
        }
        d[K] = v
      }
    for (let J = H - 1; J >= 0; J--)
      for (let I = W - 1; I >= 0; I--) {
        const K = J * W + I
        let v = d[K]
        if (I < W - 1) v = Math.min(v, d[K + 1] + D)
        if (J < H - 1) {
          v = Math.min(v, d[K + W] + D)
          if (I < W - 1) v = Math.min(v, d[K + W + 1] + DD)
          if (I > 0) v = Math.min(v, d[K + W - 1] + DD)
        }
        d[K] = v
      }
    for (let K = 0; K < N; K++) this.pass[K] = d[K] >= minClear ? 1 : 0
    // Components (4-connected flood fill).
    const stack = new Int32Array(N)
    let id = 0
    for (let s = 0; s < N; s++) {
      if (!this.pass[s] || this.comp[s] >= 0) continue
      let top = 0
      stack[top++] = s
      this.comp[s] = id
      while (top) {
        const K = stack[--top]
        const I = K % W
        const nb = [I > 0 ? K - 1 : -1, I < W - 1 ? K + 1 : -1, K - W, K + W]
        for (const n of nb) {
          if (n < 0 || n >= N || !this.pass[n] || this.comp[n] >= 0) continue
          this.comp[n] = id
          stack[top++] = n
        }
      }
      id++
    }
  }

  idx(x: number, y: number): number {
    let I = Math.floor((x - this.minX) / 2)
    let J = Math.floor((y - this.minY) / 2)
    if (I < 0) I = 0
    if (J < 0) J = 0
    if (I >= this.W) I = this.W - 1
    if (J >= this.H) J = this.H - 1
    return J * this.W + I
  }
  cx(K: number): number {
    return this.minX + (K % this.W) * 2 + 1
  }
  cy(K: number): number {
    return this.minY + Math.floor(K / this.W) * 2 + 1
  }

  /** Nearest passable cell to K (optionally in component c), searching rings up to r cells. */
  nearestPass(K: number, comp = -1, r = 25, z = NaN): number {
    const ok = (n: number) => this.pass[n] && (comp < 0 || this.comp[n] === comp) && !(Math.abs(this.height[n] - z) > 2.5)
    if (ok(K)) return K
    const I0 = K % this.W, J0 = Math.floor(K / this.W)
    for (let rr = 1; rr <= r; rr++) {
      let best = -1, bd = 1e9
      for (let dj = -rr; dj <= rr; dj++)
        for (let di = -rr; di <= rr; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== rr) continue
          const I = I0 + di, J = J0 + dj
          if (I < 0 || J < 0 || I >= this.W || J >= this.H) continue
          const n = J * this.W + I
          if (!ok(n)) continue
          const dd = di * di + dj * dj
          if (dd < bd) (bd = dd), (best = n)
        }
      if (best >= 0) return best
    }
    return -1
  }

  /** True if the straight segment between two points stays on passable cells (sampled every metre). */
  walkLine(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.ceil(d)
    for (let k = 1; k <= n; k++) {
      const t = k / n
      if (!this.pass[this.idx(ax + (bx - ax) * t, ay + (by - ay) * t)]) return false
    }
    return true
  }
}
