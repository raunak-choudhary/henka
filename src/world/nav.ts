// Capped A* on the 2 m walk grid: 8-connected, octile heuristic, wall-hugging cells cost extra.
import type { NavGrid } from "./navgrid.ts"

export class Nav {
  g: NavGrid
  private cost: Float32Array
  private from: Int32Array
  private stamp: Uint32Array
  private closed: Uint32Array
  private gen = 0
  private heap: Int32Array
  private heapF: Float32Array
  private hn = 0
  lastExpanded = 0

  constructor(g: NavGrid) {
    this.g = g
    const N = g.W * g.H
    this.cost = new Float32Array(N)
    this.from = new Int32Array(N)
    this.stamp = new Uint32Array(N)
    this.closed = new Uint32Array(N)
    this.heap = new Int32Array(N + 8)
    this.heapF = new Float32Array(N + 8)
  }

  private push(k: number, f: number) {
    let i = this.hn++
    const h = this.heap, hf = this.heapF
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hf[p] <= f) break
      h[i] = h[p]
      hf[i] = hf[p]
      i = p
    }
    h[i] = k
    hf[i] = f
  }
  private pop(): number {
    const h = this.heap, hf = this.heapF
    const top = h[0]
    const n = --this.hn
    const k = h[n], f = hf[n]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && hf[c + 1] < hf[c]) c++
      if (hf[c] >= f) break
      h[i] = h[c]
      hf[i] = hf[c]
      i = c
    }
    h[i] = k
    hf[i] = f
    return top
  }

  /** Path of cell indices from start to goal (or to the closest node reached when capped). */
  find(start: number, goal: number, cap: number): number[] {
    const g = this.g
    const W = g.W, H = g.H
    if (++this.gen >= 0xffffffff) {
      this.gen = 1
      this.stamp.fill(0)
      this.closed.fill(0)
    }
    const gen = this.gen
    const gx = goal % W, gy = Math.floor(goal / W)
    const hOf = (k: number) => {
      const dx = Math.abs((k % W) - gx), dy = Math.abs(Math.floor(k / W) - gy)
      return 2 * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy))
    }
    this.hn = 0
    this.cost[start] = 0
    this.from[start] = -1
    this.stamp[start] = gen
    this.push(start, hOf(start))
    let best = start, bestH = hOf(start)
    let exp = 0
    while (this.hn > 0 && exp < cap) {
      const k = this.pop()
      if (this.closed[k] === gen) continue
      this.closed[k] = gen
      exp++
      if (k === goal) {
        best = k
        break
      }
      const hk = hOf(k)
      if (hk < bestH) (bestH = hk), (best = k)
      const I = k % W, J = (k - I) / W
      const ck = this.cost[k]
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          const I2 = I + di, J2 = J + dj
          if (I2 < 0 || J2 < 0 || I2 >= W || J2 >= H) continue
          const n = J2 * W + I2
          if (!g.pass[n] || this.closed[n] === gen) continue
          if (di && dj && (!g.pass[J * W + I2] || !g.pass[J2 * W + I])) continue
          let step = di && dj ? 2.828 : 2
          if (g.clear[n] < 3) step *= 3
          const c = ck + step
          if (this.stamp[n] === gen && this.cost[n] <= c) continue
          this.stamp[n] = gen
          this.cost[n] = c
          this.from[n] = k
          this.push(n, c + hOf(n))
        }
    }
    this.lastExpanded = exp
    const out: number[] = []
    for (let k = best; k >= 0 && out.length < 100000; k = this.from[k]) out.push(k)
    out.reverse()
    return out
  }
}
