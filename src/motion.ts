// Path following with periodic re-planning and stuck recovery.
import type { World } from "./world/world.ts"
import { PARAMS } from "./config.ts"
import type { Rng } from "./rng.ts"

export type MoveCmd = { move: [number, number]; jump: boolean; boost: boolean; jet: boolean; conserve: boolean }

export class Motion {
  w: World
  rng: Rng
  path: number[] = []
  pi = 0
  goalX = NaN
  goalY = NaN
  planT = -1e9
  // stuck detection
  hist: { t: number; x: number; y: number }[] = []
  stuckN = 0
  lastStuckT = -1e9
  jetUntil = -1
  conserveUntil = -1
  detour: { x: number; y: number; until: number } | null = null
  lastSteer: [number, number] = [0, 0]
  plans = 0
  snapKey = -1
  snapTo = -1
  snapComp = -1
  edgeUntil = -1

  constructor(w: World, rng: Rng) {
    this.w = w
    this.rng = rng
  }

  private plan(x: number, y: number, z: number, gx: number, gy: number) {
    const g = this.w.grid
    const s = g.nearestPass(g.idx(x, y), -1, 3, z)
    this.path = []
    this.pi = 0
    if (s < 0) return
    const goal = g.nearestPass(g.idx(gx, gy), g.comp[s])
    if (goal < 0) return
    this.path = this.w.nav.find(s, goal, PARAMS.common.pathCap)
    this.plans++
  }

  /**
   * Move toward (gx, gy). `canPlan` is false when the deadline guard says to skip expensive work.
   * Returns a unit move vector plus jump/jet requests.
   */
  steer(t: number, x: number, y: number, z: number, gx: number, gy: number, energy: number, canPlan: boolean, moving = true): MoveCmd {
    const out: MoveCmd = { move: [0, 0], jump: false, boost: false, jet: false, conserve: false }
    if (this.detour && t < this.detour.until) {
      gx = this.detour.x
      gy = this.detour.y
    } else this.detour = null
    const g = this.w.grid
    // Snap a goal that sits on a wall or in another pocket to the nearest passable cell we can reach.
    // The cell we stand on is found at our own height, so on a roof we plan on that roof.
    const realX = gx, realY = gy
    let here = -1
    if (this.w.loaded) {
      here = g.nearestPass(g.idx(x, y), -1, 3, z)
      const myComp = here >= 0 ? g.comp[here] : -1
      const gk = g.idx(gx, gy)
      if (myComp >= 0 && (!g.pass[gk] || g.comp[gk] !== myComp)) {
        if (this.snapKey !== gk || this.snapComp !== myComp) {
          this.snapKey = gk
          this.snapComp = myComp
          this.snapTo = g.nearestPass(gk, myComp, 40)
        }
        if (this.snapTo >= 0) {
          gx = g.cx(this.snapTo)
          gy = g.cy(this.snapTo)
        }
      }
    }
    let dGoal = Math.hypot(gx - x, gy - y)
    const dReal = Math.hypot(realX - x, realY - y)
    // hysteresis: standing on a wall cell, the cell we snap to can flip between two pockets every
    // tick and pull us back and forth across 1 m forever; once at the edge, keep heading straight on
    if (dGoal < 3 && dReal > 5) this.edgeUntil = t + 1.5
    if (t < this.edgeUntil && dReal > 5) {
      // At the edge of our pocket: keep going straight (drop off a roof edge; stuck recovery jets over walls).
      gx = realX
      gy = realY
      dGoal = dReal
      here = -1
      // the goal is outside our pocket: save energy, then jump and jet over the edge toward it
      if (this.w.loaded) {
        if (energy >= 35 && t >= this.jetUntil) this.jetUntil = t + 1.0
        else if (t >= this.jetUntil) out.conserve = true
      }
    }
    // stuck detection, only while we actually command movement
    if (moving && dGoal > 3) {
      this.hist.push({ t, x, y })
      while (this.hist.length && this.hist[0].t < t - 1.5) this.hist.shift()
      const h0 = this.hist[0]
      if (h0 && t - h0.t >= 1.4 && Math.hypot(x - h0.x, y - h0.y) < 1 && t - this.lastStuckT > 1.5) {
        this.stuckN++
        this.lastStuckT = t
        this.hist = []
        this.planT = -1e9
        if (this.stuckN >= 2 && energy >= 40) this.jetUntil = t + 1.2
        if (this.stuckN >= 2 && energy < 40) {
          // save energy for the jet instead of moving on
          this.stuckN = 1
          this.conserveUntil = t + 3
        }
        if (this.stuckN >= 3) {
          const a = this.rng.range(-Math.PI, Math.PI)
          this.detour = { x: x + Math.cos(a) * 25, y: y + Math.sin(a) * 25, until: t + 2.5 }
          this.stuckN = 0
        }
      } else if (h0 && Math.hypot(x - h0.x, y - h0.y) > 4) this.stuckN = 0
    } else this.hist = []
    if (t < this.conserveUntil && t >= this.jetUntil) out.conserve = true
    if (t < this.jetUntil) {
      out.jump = true
      out.jet = true
    }
    if (dGoal < 3) return out
    if (!this.w.loaded || here < 0 || g.walkLine(x, y, gx, gy)) {
      out.move = [(gx - x) / dGoal, (gy - y) / dGoal]
      this.lastSteer = out.move
      return out
    }
    const moved = Math.hypot(gx - this.goalX, gy - this.goalY)
    if (canPlan && (moved > PARAMS.common.replanGoalMove || t - this.planT > PARAMS.common.replanS || !this.path.length)) {
      this.plan(x, y, z, gx, gy)
      this.planT = t
      this.goalX = gx
      this.goalY = gy
    }
    const p = this.path
    if (!p.length) {
      out.move = [(gx - x) / dGoal, (gy - y) / dGoal]
      this.lastSteer = out.move
      return out
    }
    // advance past cells we have reached
    while (this.pi < p.length - 1 && Math.hypot(g.cx(p[this.pi]) - x, g.cy(p[this.pi]) - y) < 2.5) this.pi++
    // nearest cell ahead (handles drifting off the path)
    let bi = this.pi, bd = 1e9
    for (let k = this.pi; k < Math.min(p.length, this.pi + 20); k++) {
      const d = Math.hypot(g.cx(p[k]) - x, g.cy(p[k]) - y)
      if (d < bd) (bd = d), (bi = k)
    }
    this.pi = bi
    // string pulling over at most 12 cells
    let tk = Math.min(p.length - 1, this.pi + 1)
    for (let k = Math.min(p.length - 1, this.pi + 12); k > this.pi; k--) {
      if (g.walkLine(x, y, g.cx(p[k]), g.cy(p[k]))) {
        tk = k
        break
      }
    }
    let tx = g.cx(p[tk]), ty = g.cy(p[tk])
    if (tk === p.length - 1 && g.walkLine(x, y, gx, gy)) (tx = gx), (ty = gy)
    const d = Math.hypot(tx - x, ty - y)
    out.move = d > 1e-6 ? [(tx - x) / d, (ty - y) / d] : [0, 0]
    this.lastSteer = out.move
    return out
  }
}
