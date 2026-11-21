// Decision loop: one movement intent per tick, first match wins (SDD section 4). Aim and fire are
// decided separately, so we keep shooting while we loot, dodge or walk to the zone.
import type { Action, Hello, Observation, WeaponObs } from "./mechfight.ts"
import { draw } from "./mechfight.ts"
import { PARAMS } from "./config.ts"
import { Rng } from "./rng.ts"
import { Guard } from "./guard.ts"
import { World } from "./world/world.ts"
import { Motion } from "./motion.ts"
import { Tracker, type Track } from "./state/tracker.ts"
import { ModeDetector } from "./state/mode.ts"
import { zonePlan } from "./tactics/zone.ts"
import { solveAim, errorAfterSlew, tolerance } from "./tactics/aim.ts"
import { pickUpgrade } from "./tactics/upgrades.ts"
import { LootMemory } from "./tactics/loot.ts"
import { chooseTarget } from "./tactics/target.ts"
import { choosePosition, findCover } from "./tactics/position.ts"
import { dodgeVector } from "./tactics/dodge.ts"
import { clamp, finite, wrap } from "./vec.ts"

type Act = Omit<Action, "tick">

export class Brain {
  cfg: Hello["config"]
  w: World
  rng: Rng
  guard: Guard
  motion: Motion
  tk = new Tracker()
  mode: ModeDetector
  loot = new LootMemory()
  lastMove: [number, number] = [0, 0]
  lastAim: [number, number] = [0, 0]
  intent = "idle"
  targetId = -1
  strafe = 1
  strafeFlipT = 0
  retreatUntil = -1
  retreatCooldown = -1
  laserStartT = -1
  wander: { x: number; y: number; until: number } | null = null
  scanDir = 1
  slow = 0 // decisions that hit the guard

  constructor(hello: Hello, world?: World, opts: { detectMode?: boolean } = {}) {
    this.cfg = hello.config
    this.w = world ?? World.load(hello.map.dir, hello.map.files, this.cfg.mech?.step_up ?? 1.2, this.cfg.mech?.height ?? 9)
    this.seedUsed = hello.seed
    this.rng = new Rng(hello.seed)
    this.guard = new Guard(PARAMS.common.guardMs)
    this.motion = new Motion(this.w, this.rng)
    this.mode = new ModeDetector(opts.detectMode ?? PARAMS.common.detectMode)
    this.warmUp()
  }

  /** Exercise the hot paths once at hello so the JIT has compiled them before the first decision. */
  private warmUp() {
    const g = this.w.grid
    const a = g.nearestPass(g.idx(-100, -50)), b = g.nearestPass(g.idx(100, 60))
    if (a >= 0 && b >= 0) for (let k = 0; k < 3; k++) this.w.nav.find(a, b, PARAMS.common.pathCap)
    for (let k = 0; k < 3000; k++) this.w.los(-200 + k * 0.1, -50, 10, 150, 40 + (k % 50), 5)
    for (let k = 0; k < 200; k++) g.walkLine(-50, -50, -50 + (k % 40), 0)
    // Run the whole decision path on synthetic observations (fight, laser, dodge, loot, zone) so the
    // first real fight does not pay for compilation, then reset every piece of match state.
    const seed = this.seedUsed
    const t0 = performance.now()
    try {
      const start = g.nearestPass(g.idx(-60, -20))
      const sx = start >= 0 ? g.cx(start) : 0, sy = start >= 0 ? g.cy(start) : 0
      const sz = this.w.ground(sx, sy)
      const gunW = { kind: "gun", cooldown: 0, ammo: 12, reload: 0, stats: { ...(this.cfg.weapons?.gun ?? {}) } }
      for (let k = 0; k < 400 && performance.now() - t0 < 2500; k++) {
        const t = 15 + k * 0.1
        const withLaser = k >= 100
        const ch = withLaser ? ((k % 25) / 25) * 1.2 : 0
        const laserW = { kind: "laser", cooldown: k % 25 === 0 ? 0 : 0, charge: ch, stats: { ...(this.cfg.weapons?.laser ?? {}) } }
        const ex = sx + 90 * Math.cos(k * 0.05), ey = sy + 90 * Math.sin(k * 0.05)
        const obs = {
          type: "obs", tick: 300 + k * 2, t, alive: 16 - (k > 300 ? 1 : 0),
          self: { id: 0, pos: [sx + (k % 7), sy, sz], vel: [1, 0, 0], aim: [k * 0.03, 0], hp: 1400 - (k % 200) * 5, max_hp: 1400, energy: 60, max_energy: 100, grounded: true, cubes: k > 200 ? 2 : 0, upgrades: [], weapons: [gunW, withLaser ? laserW : null], in_zone: k % 50 !== 0, stats: { ...(this.cfg.mech ?? {}) } },
          mechs: k % 40 < 30 ? [{ id: 5, kind: "mech", pos: [ex, ey, this.w.ground(ex, ey)], vel: [5, -4, 0], aim: [Math.atan2(sy - ey, sx - ex), 0], hp: 1400 - (k % 300) * 4, max_hp: 1400, cubes: 0, weapons: ["gun", "laser"], charging: k % 30 > 15 }, { id: 104, kind: "npc", pos: [sx + 30, sy + 10, sz], vel: [0, 0, 0], aim: [0, 0], hp: 350, max_hp: 350 }] : [],
          projectiles: k % 9 === 0 ? [{ id: 900 + k, kind: "gun", pos: [sx + 40, sy + 1, sz + 4], vel: [-252, 0, 0] }] : [],
          crates: [], cubes: k % 13 === 0 ? [{ id: 5000 + k, pos: [sx + 10, sy + 5, sz] }] : [],
          pickups: k < 100 ? [{ id: 8000, kind: "laser", pos: [sx + 20, sy - 10, sz] }] : [],
          sounds: [{ kind: "gun", bearing: 1, dist: "mid", age: 0.1 }], beams: [],
          events: k % 11 === 0 ? [{ type: "damaged", amount: 45, weapon: "gun", bearing: 0.5, by: 5 }, { type: "hit", target: 5, amount: 45, weapon: "gun" }] : [],
          zone: { center: [41.3, -72.8], radius: 560, next_center: [sx + 300 * (k % 2), sy], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 },
          offer: k % 97 === 0 ? { id: 1, expires: t + 5, choices: [{ id: "armor", name: "", desc: "" }, { id: "plating", name: "", desc: "" }, { id: "gyros", name: "", desc: "" }] } : null,
          drops: [],
        } as unknown as Observation
        this.act(obs)
      }
    } catch (e) {
      console.error("warm-up failed (ignored)", e)
    }
    this.warmMs = performance.now() - t0
    this.tk = new Tracker()
    this.mode = new ModeDetector(this.mode.enabled)
    this.loot = new LootMemory()
    this.rng = new Rng(seed)
    this.motion = new Motion(this.w, this.rng)
    this.targetId = -1
    this.strafe = 1
    this.strafeFlipT = 0
    this.retreatUntil = -1
    this.retreatCooldown = -1
    this.laserStartT = -1
    this.wander = null
    this.slow = 0
    this.breakOff = false
    this.zoneCache = null
    this.zoneHold = false
    draw.clear()
  }
  warmMs = 0
  seedUsed = 0

  act(obs: Observation): Act {
    this.guard.start()
    try {
      return this.sanitize(this.decide(obs), obs)
    } catch (e) {
      console.error("decide failed", obs?.tick, e)
      return { move: this.lastMove, aim: this.lastAim }
    }
  }

  private decide(obs: Observation): Act {
    const P = PARAMS.common
    const S = PARAMS.squad
    const me = obs.self
    const st = me.stats ?? {}
    const [x, y, z] = me.pos
    const t = obs.t
    const act: Act = {}
    this.tk.update(obs)
    this.mode.update(obs, this.tk)
    const ffa = this.mode.mode === "ffa"
    if (obs.offer) act.pick = pickUpgrade(obs.offer, ffa)
    this.loot.update(obs, this.cfg.vision?.near_range ?? 45)

    const hpFrac = me.hp / Math.max(1, me.max_hp)
    const walk = st.walk_speed ?? 11.7
    const eye = st.eye_height ?? 8
    const muzzle = st.muzzle_height ?? 7
    const sizeK = 1 + ((this.cfg.cubes?.size_per_cube as number) ?? 0.05) * (me.cubes ?? 0)
    const myR = (st.radius ?? 2.5) * (st.radius ? 1 : sizeK)
    const myH = (st.height ?? 9) * (st.height ? 1 : sizeK)
    const gun = me.weapons[0]?.kind === "gun" ? me.weapons[0] : null
    const sec = me.weapons[1]
    const laser = sec?.kind === "laser" ? sec : null
    const lightning = sec?.kind === "lightning" ? sec : null
    const zp = zonePlan(t, x, y, me.in_zone, obs.zone, walk)
    this.reachableZonePoint(zp, obs, x, y, z)
    // hysteresis: once we head for the zone, keep going until well inside, so a goal just outside the edge
    // cannot pull us back and forth across it
    const zn = obs.zone
    const inside = (px: number, py: number, m: number) => Math.hypot(px - zn.center[0], py - zn.center[1]) <= zn.radius - m
    if (zp.mustGo) this.zoneHold = true
    else if (this.zoneHold && !inside(x, y, 8)) zp.mustGo = true
    else this.zoneHold = false
    const safeGoal = (px: number, py: number) => inside(px, py, 6) && (t < zn.shrink_start - 15 || Math.hypot(px - zn.next_center[0], py - zn.next_center[1]) <= zn.next_radius - 6)
    const live = this.tk.live()
    const opening = t < P.quietUntil

    // ---- target
    const engage = (tr: Track, d: number) => {
      const hitUs = t - tr.lastHitUsT < 6
      if (opening) return hitUs || d <= P.openingShootRange
      if (!ffa) return true
      return this.ffaEngage(tr, d, t, hpFrac, obs)
    }
    const target = chooseTarget(this.tk, x, y, t, this.targetId, engage, ffa)
    this.targetId = target ? target.id : -1
    const tDist = target ? Math.hypot(target.x - x, target.y - y) : Infinity
    const tSize = target ? 1 + 0.05 * target.cubes : 1
    const tCz = target ? target.z + 4.5 * tSize : 0
    const seeTarget = target ? this.w.los(x, y, z + eye, target.x, target.y, tCz) || this.w.los(x, y, z + eye, target.x, target.y, target.z + 8.5 * tSize) : false
    // NPC fallback: shoot a drone only if it is shooting us
    let npc: { x: number; y: number; z: number; vx: number; vy: number } | null = null
    if (!target) {
      let bd = 1e9
      for (const n of this.tk.npcs.values()) {
        if (t - n.lastHitUsT > 5) continue
        const d = Math.hypot(n.pos[0] - x, n.pos[1] - y)
        if (d < bd) (bd = d), (npc = { x: n.pos[0], y: n.pos[1], z: n.pos[2] - 2.75, vx: n.vel[0], vy: n.vel[1] })
      }
    }

    // ---- strafe direction flips at random intervals
    if (t >= this.strafeFlipT) {
      this.strafe = -this.strafe
      this.strafeFlipT = t + this.rng.range(P.strafeMin, P.strafeMax)
    }

    // ---- movement intent
    let gx = x, gy = y
    let boost = false
    let moving = true
    let intent = "reposition"
    let pick = this.loot.choose(obs, this.w)
    if (pick && !safeGoal(pick.x, pick.y)) pick = null
    const pickD = pick ? Math.hypot(pick.x - x, pick.y - y) : Infinity
    const cubesSeen = (obs.cubes ?? []).map((c) => ({ x: c.pos[0], y: c.pos[1], z: c.pos[2] }))
    const cubeCap = P.cubeCap
    let nearCube: { x: number; y: number } | null = null
    {
      const lim = target ? P.cubeDetourFight : P.cubeDetourIdle
      let bd = lim
      for (const c of cubesSeen) {
        if (Math.abs(c.z - z) > 4) continue
        const d = Math.hypot(c.x - x, c.y - y)
        if (d < bd && ((me.cubes ?? 0) < cubeCap || d < 12) && safeGoal(c.x, c.y)) (bd = d), (nearCube = c)
      }
    }
    const enemiesNear = live.filter((tr) => Math.hypot(tr.x - x, tr.y - y) < S.retreatCrowdRange).length
    const berserk = P.berserk

    // breakSight: a laser has been charging at us for a while and cover is close
    let breakFrom: Track | null = null
    if (!berserk && P.breakSight) {
      for (const tr of live) {
        if (tr.charging && tr.aimingAtUs && tr.chargingSince >= 0 && t - tr.chargingSince > P.breakSightChargeS && Math.hypot(tr.x - x, tr.y - y) < 280) {
          if (this.w.los(tr.x, tr.y, tr.z + 8, x, y, z + 4.5)) {
            breakFrom = tr
            break
          }
        }
      }
    }
    // retreat (squad rule)
    if (!berserk && target && t >= this.retreatCooldown && t >= this.retreatUntil) {
      const tFrac = target.hp / Math.max(1, target.maxHp)
      const want = ((enemiesNear >= S.retreatCrowd && hpFrac < S.retreatHpCrowd) || (hpFrac < S.retreatHpAlone && tFrac > hpFrac)) && tFrac >= S.retreatCancelTarget
      if (want) {
        this.retreatUntil = t + S.retreatS
        this.retreatCooldown = t + S.retreatS + 3
      }
    }
    if (target && target.hp / Math.max(1, target.maxHp) < S.retreatCancelTarget) this.retreatUntil = -1

    // free-for-all: break off to heal when hurt and cover is near; no new fights until healed
    const F = PARAMS.ffa
    const ffaLate = ffa && (obs.alive <= F.lateAlive || obs.zone.next_radius <= F.lateRadius)
    if (ffa && !ffaLate && t >= F.quietUntil) {
      if (!this.breakOff && hpFrac < F.breakOffHp && live.length && !this.guard.over() && findCover(this.w, x, y, z, live, F.breakOffCover)) this.breakOff = true
      if (this.breakOff && hpFrac >= F.reengageHp) this.breakOff = false
    } else this.breakOff = false
    const ffaQuiet = ffa && t < F.quietUntil && !ffaLate
    const drop = (ffa || P.dropsInSquad) && !zp.mustGo ? this.chooseDrop(obs, x, y, walk, hpFrac) : null

    let cover: { x: number; y: number } | null = null
    if (zp.mustGo) {
      intent = "zone"
      gx = zp.tx
      gy = zp.ty
      boost = zp.late
    } else if (breakFrom && !this.guard.over() && (cover = findCover(this.w, x, y, z, [breakFrom], P.breakSightCoverM))) {
      intent = "breakSight"
      gx = cover.x
      gy = cover.y
      boost = me.energy > 20
    } else if (t < this.retreatUntil && !this.guard.over() && (cover = findCover(this.w, x, y, z, live, 24))) {
      intent = "retreat"
      gx = cover.x
      gy = cover.y
      boost = me.energy > 30
    } else if (pick && (!target || pickD < 60) && !laser) {
      intent = "loot"
      gx = pick.x
      gy = pick.y
      if (pickD <= (this.cfg.loot?.pickup_radius ?? 4) - 0.3 && Math.abs(pick.z - z) < 3.5) {
        act.take = pick.id
        if (sec) act.drop = 1
      }
    } else if (ffaQuiet && target && !this.guard.over()) {
      // first minute of a free-for-all: return fire, break line of sight, never chase
      intent = "evade"
      cover = findCover(this.w, x, y, z, [target], 24)
      if (cover) (gx = cover.x), (gy = cover.y)
      else {
        const b = Math.atan2(y - target.y, x - target.x)
        gx = x + Math.cos(b) * 20
        gy = y + Math.sin(b) * 20
      }
    } else if (this.breakOff && !this.guard.over() && (cover = findCover(this.w, x, y, z, live.length ? live : this.recentTracks(t), 24))) {
      intent = "heal"
      gx = cover.x
      gy = cover.y
    } else if (drop && (!target || ffa)) {
      intent = "drop"
      const d = Math.hypot(drop.pos[0] - x, drop.pos[1] - y)
      if (d < drop.radius - 2) {
        // inside the ring: keep moving a little so we are not a still target
        const a = t * 1.3
        gx = drop.pos[0] + Math.cos(a) * (drop.radius * 0.45)
        gy = drop.pos[1] + Math.sin(a) * (drop.radius * 0.45)
      } else {
        gx = drop.pos[0]
        gy = drop.pos[1]
        boost = me.energy > 50 && d > 40
      }
    } else if (target) {
      intent = "fight"
      let pref = laser ? S.rangeLaser : lightning ? S.rangeLightning : S.rangeGun
      const tFrac = target.hp / Math.max(1, target.maxHp)
      if (tFrac < S.finishTargetFrac && hpFrac > S.finishSelfFrac && enemiesNear <= 2) pref = S.finishRange
      if (ffa && t < PARAMS.ffa.quietUntil) pref = Math.max(pref, 120)
      const pos = this.guard.over()
        ? null
        : choosePosition({ w: this.w, t, x, y, z, eye, target, others: live.filter((o) => o.id !== target.id), preferred: pref, strafe: this.strafe, zone: obs.zone, cubes: cubesSeen })
      if (pos) {
        gx = pos.x
        gy = pos.y
      } else {
        // no candidate: strafe around the target in place
        const b = Math.atan2(target.y - y, target.x - x)
        gx = x - Math.sin(b) * this.strafe * 6
        gy = y + Math.cos(b) * this.strafe * 6
      }
      if (nearCube && Math.hypot(nearCube.x - x, nearCube.y - y) < P.cubeDetourFight) {
        gx = nearCube.x
        gy = nearCube.y
        intent = "fight+cube"
      }
    } else if (nearCube) {
      intent = "cube"
      gx = nearCube.x
      gy = nearCube.y
    } else if (t - this.tk.lastKillT < 10 && live.length && !this.guard.over() && (cover = findCover(this.w, x, y, z, live, 24))) {
      intent = "regen"
      gx = cover.x
      gy = cover.y
    } else if (!zp.insideNext || zp.distNext > obs.zone.next_radius * 0.6) {
      intent = "toZone"
      gx = zp.tx
      gy = zp.ty
    } else {
      intent = "wander"
      if (!this.wander || t > this.wander.until || Math.hypot(this.wander.x - x, this.wander.y - y) < 4) this.wander = this.pickWander(obs, x, y)
      gx = this.wander.x
      gy = this.wander.y
    }
    this.intent = intent

    const mv = this.motion.steer(t, x, y, z, gx, gy, me.energy, !this.guard.over(), moving)
    let move = mv.move
    boost = (boost && !mv.conserve) || mv.jet
    if (opening && intent !== "zone" && !mv.jet) boost = false
    // dodge overlays movement
    const dz = dodgeVector(x, y, z, myH, myR, obs.projectiles, P.dodgeHorizon, P.dodgeMargin)
    if (dz && intent !== "zone") {
      move = [dz.dx * 0.85 + move[0] * 0.15, dz.dy * 0.85 + move[1] * 0.15]
      if (me.energy > 15) boost = true
      this.intent = intent + "+dodge"
    }
    act.move = move
    act.boost = boost
    act.jump = mv.jump

    // ---- aim and fire
    const fire: [boolean, boolean] = [false, false]
    const turn = st.turn_rate ?? 4, pitchRate = st.pitch_rate ?? 3
    const mx = x + me.vel[0] * 0.1, my = y + me.vel[1] * 0.1, mz = z + muzzle
    let aimYaw: number, aimPitch = 0
    const moveYaw = Math.hypot(move[0], move[1]) > 0.1 ? Math.atan2(move[1], move[0]) : NaN
    if (target || npc) {
      const tx = target ? target.x : npc!.x, ty = target ? target.y : npc!.y
      const tz = target ? tCz : npc!.z + 1.75
      const tvx = target ? target.vx : npc!.vx, tvy = target ? target.vy : npc!.vy
      const tR = target ? 2.5 * tSize : 1.8
      const see = target ? seeTarget : this.w.los(x, y, z + eye, tx, ty, tz)
      const gunSpeed = gun?.stats?.speed ?? 252
      const gs = solveAim(mx, my, mz, tx, ty, tz, tvx, tvy, 0, gunSpeed)
      const ls = solveAim(mx, my, mz, tx, ty, tz, tvx, tvy, 0, Infinity, 0.1)
      // laser state
      let laserAim = false
      if (laser) {
        const full = laser.stats?.charge ?? 0.75
        const ch = laser.charge ?? 0
        if (ch > 0 && this.laserStartT < 0) this.laserStartT = t - ch
        if (ch <= 0) this.laserStartT = -1
        const inRange = ls.dist <= (laser.stats?.range ?? 280)
        const errL = errorAfterSlew(me.aim[0], me.aim[1], ls.yaw, ls.pitch, turn, pitchRate)
        const onL = errL < tolerance(tR, ls.dist, 0.8)
        const dmgNow = this.laserDamage(laser, ch, me.cubes ?? 0)
        const tHp = target ? target.hp : 350
        const heldFull = ch >= full - 0.02 ? t - (this.laserStartT + full) : -1
        if (ch <= 0) {
          // start charging when a target is in range (in sight or about to be)
          if (laser.cooldown <= 0.1 && inRange && (see || ls.dist < 200)) fire[1] = true
        } else {
          const ready = ch >= full - 0.02 || (dmgNow * PARAMS.common.laserKillFrac >= tHp && ch >= (laser.stats?.min_charge ?? 0.15))
          if (ready) laserAim = true
          if (ready && see && inRange && onL) fire[1] = false // release
          else if (heldFull >= P.laserHoldMax) fire[1] = false // it would fire on its own soon anyway
          else fire[1] = true
        }
      }
      const sol = laserAim ? ls : gs
      aimYaw = sol.yaw
      aimPitch = sol.pitch
      // gun gate
      if (gun) {
        const err = errorAfterSlew(me.aim[0], me.aim[1], gs.yaw, gs.pitch, turn, pitchRate)
        const lateral = Math.abs(-Math.sin(gs.yaw) * tvx + Math.cos(gs.yaw) * tvy)
        const longShot = gs.dist > P.longShotRange && lateral > P.longShotLateral
        const openingOk = !opening || !target || t - target.lastHitUsT < 6 || gs.dist <= P.openingShootRange
        if (!laserAim && see && gs.dist <= (gun.stats?.range ?? 230) && err < tolerance(tR, gs.dist) && !longShot && openingOk && (gun.ammo ?? 1) > 0 && (gun.reload ?? 0) <= 0) fire[0] = true
        if ((gun.ammo ?? 1) <= 0 && (gun.reload ?? 0) <= 0) act.reload = true
      }
      if (lightning && see) {
        const cone = (((lightning.stats?.cone_deg ?? 30) / 2) * Math.PI) / 180
        if (ls.dist <= (lightning.stats?.range ?? 45) && Math.abs(wrap(me.aim[0] - ls.yaw)) < cone * 0.8 && me.energy > 10) fire[1] = true
      }
    } else {
      // no target: face the most recent damage, else the nearest remembered enemy, else where we walk
      let face = NaN
      if (t - this.tk.lastDamagedT < 3 && this.tk.lastDamagedBearing !== null) face = this.tk.lastDamagedBearing
      if (!Number.isFinite(face)) {
        let bd = 1e9
        for (const tr of this.tk.mechs.values()) {
          if (t - tr.lastSeenT > 12) continue
          const d = Math.hypot(tr.x - x, tr.y - y)
          if (d < bd) (bd = d), (face = Math.atan2(tr.y - y, tr.x - x))
        }
      }
      if (!Number.isFinite(face)) {
        // a recent heard gun or laser
        for (const s of obs.sounds ?? []) if ((s.kind === "gun" || s.kind === "laser" || s.kind === "laser_charge" || s.kind === "step" || s.kind === "boost") && s.dist !== "far") face = s.bearing
      }
      if (!Number.isFinite(face)) {
        // sweep around the walking direction to see more of the map
        const base = Number.isFinite(moveYaw) ? moveYaw : me.aim[0]
        const sweep = Math.sin(t * 0.9) * 0.9
        face = base + sweep
      }
      aimYaw = face
      aimPitch = 0
      if (gun && (gun.ammo ?? 12) <= 6 && (gun.reload ?? 0) <= 0) act.reload = true
      // a held laser charge with nothing to shoot: let it go before it fires on its own
      if (laser && (laser.charge ?? 0) > 0) {
        const full = laser.stats?.charge ?? 0.75
        const heldFull = (laser.charge ?? 0) >= full - 0.02 && this.laserStartT >= 0 ? t - (this.laserStartT + full) : -1
        fire[1] = heldFull < P.laserHoldMax && t - this.tk.lastDamagedT < 4
      }
      if (laser && (laser.charge ?? 0) <= 0) this.laserStartT = -1
    }
    act.aim = [aimYaw, aimPitch]
    act.fire = fire
    if (this.guard.over()) this.slow++
    draw.label(`${this.mode.mode} ${this.intent} ${target ? target.id : "-"} ${Math.round(me.hp)}`)
    return act
  }

  private laserDamage(l: WeaponObs, charge: number, cubes: number): number {
    const s = l.stats ?? {}
    const full = s.charge ?? 0.75
    const minF = s.min_frac ?? 0.35
    const f = minF + (1 - minF) * Math.min(1, charge / full)
    const cap = (this.cfg.cubes?.stat_cap as number) ?? 10
    const per = (this.cfg.cubes?.damage_per_cube as number) ?? 0.04
    return (s.damage ?? 315) * f * (1 + per * Math.min(cubes, cap))
  }

  /** Free-for-all engage rule (SDD 5.4). */
  private ffaEngage(tr: Track, d: number, t: number, hpFrac: number, obs: Observation): boolean {
    const F = PARAMS.ffa
    const hitUs = t - tr.lastHitUsT < 6
    const late = obs.alive <= F.lateAlive || obs.zone.next_radius <= F.lateRadius
    if (late) return true
    if (t < F.quietUntil) return hitUs && tr.listed
    if (hitUs || d <= F.engageClose) return true
    if (this.breakOff) return false
    if (tr.hp <= F.engageHpFrac * tr.maxHp) return true
    const away = Math.abs(wrap(tr.aimYaw - Math.atan2(obs.self.pos[1] - tr.y, obs.self.pos[0] - tr.x))) > Math.PI / 3
    if (tr.unexplainedLoss > 0 && away) return true
    return false
  }
  breakOff = false
  zoneHold = false
  private zoneCache: { key: string; comp: number; x: number; y: number } | null = null

  /**
   * The zone plan's target can sit in a pocket we cannot walk into (a plateau or walled yard). Replace it
   * with the nearest point inside the next circle that is in our own walkable component.
   */
  private reachableZonePoint(zp: { tx: number; ty: number }, obs: Observation, x: number, y: number, z: number) {
    if (!this.w.loaded) return
    const g = this.w.grid
    const here = g.nearestPass(g.idx(x, y), -1, 3, z)
    if (here < 0) return
    const comp = g.comp[here]
    const k = g.idx(zp.tx, zp.ty)
    if (g.pass[k] && g.comp[k] === comp) return
    const near = g.nearestPass(k, comp, 6)
    if (near >= 0) {
      zp.tx = g.cx(near)
      zp.ty = g.cy(near)
      return
    }
    const zn = obs.zone
    const key = `${zn.next_center[0].toFixed(0)},${zn.next_center[1].toFixed(0)},${zn.next_radius}`
    if (!this.zoneCache || this.zoneCache.key !== key || this.zoneCache.comp !== comp) {
      let best = -1, bd = Infinity
      for (const f of [0.2, 0.45, 0.7]) {
        for (let a = 0; a < 24; a++) {
          const ang = (a / 24) * 2 * Math.PI
          const c = g.nearestPass(g.idx(zn.next_center[0] + Math.cos(ang) * zn.next_radius * f, zn.next_center[1] + Math.sin(ang) * zn.next_radius * f), comp, 4)
          if (c < 0) continue
          if (Math.hypot(g.cx(c) - zn.next_center[0], g.cy(c) - zn.next_center[1]) > zn.next_radius * 0.85) continue
          const d = Math.hypot(g.cx(c) - x, g.cy(c) - y)
          if (d < bd) (bd = d), (best = c)
        }
      }
      if (best < 0) {
        // our pocket does not reach the next circle: go to its cell closest to the next centre;
        // motion then jumps and jets over the edge from there
        for (let i = 0; i < g.comp.length; i++) {
          if (!g.pass[i] || g.comp[i] !== comp) continue
          const d = Math.hypot(g.cx(i) - zn.next_center[0], g.cy(i) - zn.next_center[1])
          if (d < bd) (bd = d), (best = i)
        }
        if (best >= 0) {
          // aim 20 m past that edge cell so motion walks off it (or jets over it)
          const ex = g.cx(best), ey = g.cy(best)
          const dl = Math.max(1e-6, Math.hypot(zn.next_center[0] - ex, zn.next_center[1] - ey))
          this.zoneCache = { key, comp, x: ex + ((zn.next_center[0] - ex) / dl) * 20, y: ey + ((zn.next_center[1] - ey) / dl) * 20 }
        } else this.zoneCache = { key, comp, x: zp.tx, y: zp.ty }
      } else this.zoneCache = { key, comp, x: g.cx(best), y: g.cy(best) }
    }
    zp.tx = this.zoneCache.x
    zp.ty = this.zoneCache.y
  }

  /** Tracks seen in the last 20 s (positions may be stale): used only for where not to stand. */
  private recentTracks(t: number): Track[] {
    const out: Track[] = []
    for (const tr of this.tk.mechs.values()) if (t - tr.lastSeenT < 20) out.push(tr)
    return out
  }

  /** Supply drop worth taking now (SDD 5.5), or null. */
  private chooseDrop(obs: Observation, x: number, y: number, walk: number, hpFrac: number) {
    if (!(hpFrac < 0.8 || (obs.self.cubes ?? 0) < 10)) return null
    let best: Observation["drops"][number] | null = null
    let bd = Infinity
    for (const d of obs.drops ?? []) {
      if (d.holder !== null && d.holder !== undefined && d.holder !== obs.self.id) continue
      const dist = Math.hypot(d.pos[0] - x, d.pos[1] - y)
      if (dist * 1.2 > 150) continue
      if (d.lands_in > dist / walk + 3) continue
      if (this.w.loaded && Math.abs(d.pos[2] - this.w.ground(d.pos[0], d.pos[1])) > 3) continue // on a roof
      let crowded = false
      for (const tr of this.tk.mechs.values()) {
        if (obs.t - tr.lastSeenT < 5 && Math.hypot(tr.x - d.pos[0], tr.y - d.pos[1]) < 60) crowded = true
      }
      if (crowded) continue
      if (dist < bd) (bd = dist), (best = d)
    }
    return best
  }

  private pickWander(obs: Observation, x: number, y: number): { x: number; y: number; until: number } {
    const z = obs.zone
    const g = this.w.grid
    let best: { x: number; y: number; until: number } | null = null
    let bestS = -Infinity
    for (let k = 0; k < 12; k++) {
      const a = this.rng.range(-Math.PI, Math.PI)
      const r = this.rng.range(15, 50)
      const qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r
      if (Math.hypot(qx - z.next_center[0], qy - z.next_center[1]) > z.next_radius * 0.6) continue
      if (this.w.loaded && !g.pass[g.idx(qx, qy)]) continue
      if (this.mode.mode !== "ffa") return { x: qx, y: qy, until: obs.t + 8 }
      // free-for-all: prefer spots far from every mech we know about and hidden from them
      let near = Infinity, seen = 0
      for (const tr of this.recentTracks(obs.t)) {
        near = Math.min(near, Math.hypot(tr.x - qx, tr.y - qy))
        if (Math.hypot(tr.x - qx, tr.y - qy) < 220 && this.w.los(tr.x, tr.y, tr.z + 8, qx, qy, this.w.grid.height[g.idx(qx, qy)] + 4.5)) seen++
      }
      const sc = Math.min(near, PARAMS.ffa.keepAway) - 60 * seen
      if (sc > bestS) (bestS = sc), (best = { x: qx, y: qy, until: obs.t + 6 })
    }
    if (best) return best
    return { x: z.next_center[0], y: z.next_center[1], until: obs.t + 4 }
  }

  private sanitize(a: Act, obs: Observation): Act {
    const st = obs.self.stats ?? {}
    let mx = finite(a.move?.[0] ?? 0), my = finite(a.move?.[1] ?? 0)
    const l = Math.hypot(mx, my)
    if (l > 1) (mx /= l), (my /= l)
    a.move = [mx, my]
    const yaw = wrap(finite(a.aim?.[0] ?? obs.self.aim[0], obs.self.aim[0]))
    const pitch = clamp(finite(a.aim?.[1] ?? 0), st.min_pitch ?? -0.7, st.max_pitch ?? 1.3)
    a.aim = [yaw, pitch]
    a.fire = [!!a.fire?.[0], !!a.fire?.[1]]
    a.boost = !!a.boost
    a.jump = !!a.jump
    a.reload = !!a.reload
    if (a.pick !== undefined && !(Number.isInteger(a.pick) && a.pick >= 0 && a.pick <= 2)) delete a.pick
    if (a.take === undefined || !Number.isFinite(a.take)) {
      delete a.take
      delete a.drop
    }
    this.lastMove = a.move
    this.lastAim = a.aim
    return a
  }
}
