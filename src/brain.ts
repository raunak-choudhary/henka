// Decision loop: one intent per tick, first match wins (SDD section 4).
import type { Action, Hello, Observation, ActorObs } from "./mechfight.ts"
import { draw } from "./mechfight.ts"
import { PARAMS } from "./config.ts"
import { Rng } from "./rng.ts"
import { Guard } from "./guard.ts"
import { World } from "./world/world.ts"
import { Motion } from "./motion.ts"
import { zonePlan } from "./tactics/zone.ts"
import { solveAim, errorAfterSlew, tolerance } from "./tactics/aim.ts"
import { pickUpgrade } from "./tactics/upgrades.ts"
import { LootMemory } from "./tactics/loot.ts"
import { clamp, finite } from "./vec.ts"

type Act = Omit<Action, "tick">

export class Brain {
  cfg: Hello["config"]
  w: World
  rng: Rng
  guard: Guard
  motion: Motion
  loot = new LootMemory()
  lastMove: [number, number] = [0, 0]
  lastAim: [number, number] = [0, 0]
  intent = "idle"

  constructor(hello: Hello, world?: World) {
    this.cfg = hello.config
    this.w = world ?? World.load(hello.map.dir, hello.map.files, this.cfg.mech?.step_up ?? 1.2, this.cfg.mech?.height ?? 9)
    this.rng = new Rng(hello.seed)
    this.guard = new Guard(PARAMS.common.guardMs)
    this.motion = new Motion(this.w, this.rng)
    this.warmUp()
  }

  /** Exercise the hot paths once at hello so the JIT has compiled them before the first decision. */
  private warmUp() {
    const g = this.w.grid
    const a = g.nearestPass(g.idx(-100, -50)), b = g.nearestPass(g.idx(100, 60))
    if (a >= 0 && b >= 0) for (let k = 0; k < 3; k++) this.w.nav.find(a, b, PARAMS.common.pathCap)
    for (let k = 0; k < 3000; k++) this.w.los(-200 + k * 0.1, -50, 10, 150, 40 + (k % 50), 5)
    for (let k = 0; k < 200; k++) g.walkLine(-50, -50, -50 + (k % 40), 0)
  }

  act(obs: Observation): Act {
    this.guard.start()
    try {
      return this.sanitize(this.decide(obs), obs)
    } catch (e) {
      console.error("decide failed", obs.tick, e)
      return { move: this.lastMove, aim: this.lastAim }
    }
  }

  private decide(obs: Observation): Act {
    const me = obs.self
    const st = me.stats ?? {}
    const [x, y, z] = me.pos
    const t = obs.t
    const act: Act = {}
    if (obs.offer) act.pick = pickUpgrade(obs.offer, false)
    this.loot.update(obs, this.cfg.vision?.near_range ?? 45)

    const walk = st.walk_speed ?? 11.7
    const zp = zonePlan(t, x, y, me.in_zone, obs.zone, walk)
    let gx = x, gy = y
    let boost = false
    this.intent = "reposition"

    // target: nearest visible mech
    let target: ActorObs | null = null
    let td = 1e9
    for (const m of obs.mechs) {
      if (m.kind !== "mech") continue
      const d = Math.hypot(m.pos[0] - x, m.pos[1] - y)
      if (d < td) (td = d), (target = m)
    }
    const pick = this.loot.choose(obs, this.w)
    if (zp.mustGo) {
      this.intent = "zone"
      gx = zp.tx
      gy = zp.ty
      boost = zp.late
    } else if (pick) {
      this.intent = "loot"
      gx = pick.x
      gy = pick.y
      const dz = Math.abs(pick.z - z)
      if (Math.hypot(pick.x - x, pick.y - y) <= (this.cfg.loot?.pickup_radius ?? 4) - 0.3 && dz < 3.5) {
        act.take = pick.id
        if (me.weapons[1]) act.drop = 1
      }
    } else if (!zp.insideNext || zp.distNext > obs.zone.next_radius * 0.5) {
      gx = zp.tx
      gy = zp.ty
    } else if (target) {
      gx = target.pos[0]
      gy = target.pos[1]
    }

    const mv = this.motion.steer(t, x, y, z, gx, gy, me.energy, !this.guard.over())
    act.move = mv.move
    act.boost = boost || mv.jet
    act.jump = mv.jump

    // aim and fire
    let aimYaw = Math.atan2(act.move[1], act.move[0])
    let aimPitch = 0
    if (Math.hypot(act.move[0], act.move[1]) < 0.1) aimYaw = me.aim[0]
    const fire: [boolean, boolean] = [false, false]
    if (target) {
      const muz = z + (st.muzzle_height ?? 7)
      const th = (this.cfg.mech?.height ?? 9) * (1 + (this.cfg.cubes?.size_per_cube as number ?? 0.05) * (target.cubes ?? 0))
      const gun = me.weapons[0]
      const speed = gun?.stats?.speed ?? 252
      const sol = solveAim(x + me.vel[0] * 0.1, y + me.vel[1] * 0.1, muz, target.pos[0], target.pos[1], target.pos[2] + th / 2, target.vel[0], target.vel[1], 0, speed)
      aimYaw = sol.yaw
      aimPitch = sol.pitch
      const see = this.w.los(x, y, z + (st.eye_height ?? 8), target.pos[0], target.pos[1], target.pos[2] + th / 2)
      const err = errorAfterSlew(me.aim[0], me.aim[1], sol.yaw, sol.pitch, st.turn_rate ?? 4, st.pitch_rate ?? 3)
      const rad = (this.cfg.mech?.radius ?? 2.5) * (th / 9)
      const onAim = err < tolerance(rad, sol.dist)
      if (gun && see && sol.dist <= (gun.stats?.range ?? 230) && onAim && (gun.ammo ?? 1) > 0 && (gun.reload ?? 0) <= 0) fire[0] = true
      if (gun && (gun.ammo ?? 1) === 0 && (gun.reload ?? 0) <= 0) act.reload = true
      const w1 = me.weapons[1]
      if (w1 && w1.kind === "laser" && see && sol.dist <= (w1.stats?.range ?? 280)) {
        const full = w1.stats?.charge ?? 0.75
        const ch = w1.charge ?? 0
        if (ch <= 0 && w1.cooldown <= 0.05) fire[1] = true
        else if (ch > 0 && ch < full - 0.01) fire[1] = true
        else if (ch > 0) fire[1] = !onAim // release on aim
      } else if (w1 && w1.kind === "laser" && (w1.charge ?? 0) > 0) fire[1] = (w1.charge ?? 0) < 2.5
      if (w1 && w1.kind === "lightning" && see && sol.dist <= (w1.stats?.range ?? 45) && Math.abs(errorAfterSlew(me.aim[0], 0, sol.yaw, 0, st.turn_rate ?? 4, 0)) < 0.2) fire[1] = true
    } else {
      const gun = me.weapons[0]
      if (gun && (gun.ammo ?? 12) <= 6 && (gun.reload ?? 0) <= 0) act.reload = true
    }
    act.aim = [aimYaw, aimPitch]
    act.fire = fire
    draw.label(`${this.intent} ${target ? target.id : "-"} ${Math.round(me.hp)}`)
    return act
  }

  private sanitize(a: Act, obs: Observation): Act {
    const st = obs.self.stats ?? {}
    let mx = finite(a.move?.[0] ?? 0), my = finite(a.move?.[1] ?? 0)
    const l = Math.hypot(mx, my)
    if (l > 1) (mx /= l), (my /= l)
    a.move = [mx, my]
    const yaw = finite(a.aim?.[0] ?? obs.self.aim[0], obs.self.aim[0])
    const pitch = clamp(finite(a.aim?.[1] ?? 0), st.min_pitch ?? -0.7, st.max_pitch ?? 1.3)
    a.aim = [yaw, pitch]
    a.fire = [!!a.fire?.[0], !!a.fire?.[1]]
    a.boost = !!a.boost
    a.jump = !!a.jump
    a.reload = !!a.reload
    if (a.pick !== undefined && !(Number.isInteger(a.pick) && a.pick >= 0 && a.pick <= 2)) delete a.pick
    if (a.take === undefined) delete a.drop
    this.lastMove = a.move
    this.lastAim = a.aim
    return a
  }
}
