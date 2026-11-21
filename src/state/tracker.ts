// What we know about every other mech, incoming shots, and our own damage log.
import type { Observation, ActorObs } from "../mechfight.ts"
import { wrap } from "../vec.ts"

export type Track = {
  id: number
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  aimYaw: number; aimPitch: number
  hp: number; maxHp: number; cubes: number
  weapons: string[]
  charging: boolean
  chargingSince: number // -1 when not charging
  lastSeenT: number // last time it was listed in obs.mechs
  firstSeenT: number
  lastHitUsT: number // last time it damaged us
  hitUsRecent: number // damage it dealt us in the last 6 s (decayed)
  damageFromUs: number
  lastWeHitT: number
  unexplainedLoss: number // HP it lost that our hits do not explain
  aimingAtUs: boolean
  listed: boolean // in obs.mechs this tick
}

export class Tracker {
  mechs = new Map<number, Track>()
  npcs = new Map<number, ActorObs & { lastHitUsT: number }>()
  selfId = -1
  t = 0
  ourKills = 0
  foreignDeaths = 0
  lastDamagedT = -1e9
  lastDamagedBearing: number | null = null
  lastDamagedBy: number | null = null
  lastDealtT = -1e9
  damageTaken = 0
  firstMechDamageT = -1 // first time a mech damaged us
  lastKillT = -1e9
  private prevAlive = 16
  private hitThisTick = new Map<number, number>()

  update(obs: Observation) {
    const t = obs.t
    const dt = Math.max(0.05, t - this.t)
    this.t = t
    const me = obs.self
    this.selfId = me.id
    this.hitThisTick.clear()
    for (const e of obs.events ?? []) {
      if (e.type === "damaged") {
        this.lastDamagedT = t
        this.damageTaken += e.amount
        if (e.bearing !== null && e.bearing !== undefined) this.lastDamagedBearing = e.bearing
        this.lastDamagedBy = e.by ?? null
        if (e.by !== null && e.by !== undefined) {
          if (e.by < 100) {
            const tr = this.mechs.get(e.by)
            if (tr) {
              tr.lastHitUsT = t
              tr.hitUsRecent += e.amount
            } else this.pendingHits.set(e.by, t)
            if (this.firstMechDamageT < 0) this.firstMechDamageT = t
          } else {
            const n = this.npcs.get(e.by)
            if (n) n.lastHitUsT = t
            this.npcHitT.set(e.by, t)
          }
        }
      } else if (e.type === "hit") {
        this.lastDealtT = t
        this.hitThisTick.set(e.target, (this.hitThisTick.get(e.target) ?? 0) + e.amount)
      } else if (e.type === "kill") {
        this.ourKills++
        this.lastKillT = t
        this.mechs.delete(e.target)
      }
    }
    const killedByOthers = Math.max(0, 16 - obs.alive - this.ourKills)
    this.foreignDeaths = Math.max(this.foreignDeaths, killedByOthers)
    this.prevAlive = obs.alive
    for (const tr of this.mechs.values()) {
      tr.listed = false
      tr.hitUsRecent *= Math.exp(-dt / 6)
    }
    const [mx, my] = me.pos
    for (const m of obs.mechs ?? []) {
      if (m.kind === "npc") {
        const prev = this.npcs.get(m.id)
        this.npcs.set(m.id, { ...m, lastHitUsT: prev?.lastHitUsT ?? this.npcHitT.get(m.id) ?? -1e9 })
        continue
      }
      if (m.id === me.id) continue
      let tr = this.mechs.get(m.id)
      const hp = m.hp ?? tr?.hp ?? 1400
      const maxHp = m.max_hp ?? tr?.maxHp ?? 1400
      if (!tr) {
        tr = {
          id: m.id, x: m.pos[0], y: m.pos[1], z: m.pos[2], vx: 0, vy: 0, vz: 0, aimYaw: m.aim[0], aimPitch: m.aim[1], hp, maxHp, cubes: m.cubes ?? 0,
          weapons: (m.weapons ?? []) as string[], charging: !!m.charging, chargingSince: -1, lastSeenT: t, firstSeenT: t,
          lastHitUsT: this.pendingHits.get(m.id) ?? -1e9, hitUsRecent: 0, damageFromUs: 0, lastWeHitT: -1e9, unexplainedLoss: 0, aimingAtUs: false, listed: true,
        }
        this.mechs.set(m.id, tr)
      } else {
        const gap = t - tr.lastSeenT
        const ours = this.hitThisTick.get(m.id) ?? 0
        // Count only drops a weapon explains (one drone hit is 25 HP) taken inside the zone (zone damage is not a fight).
        const lost = tr.hp - hp - ours
        const zn = obs.zone
        const inZone = !zn || Math.hypot(m.pos[0] - zn.center[0], m.pos[1] - zn.center[1]) < zn.radius - 2
        if (gap < 0.35 && lost >= 35 && inZone) tr.unexplainedLoss += lost
        const v = m.vel
        if (v && (v[0] !== 0 || v[1] !== 0 || v[2] !== 0)) (tr.vx = v[0]), (tr.vy = v[1]), (tr.vz = v[2])
        else if (gap > 0 && gap < 0.5) {
          tr.vx = (m.pos[0] - tr.x) / gap
          tr.vy = (m.pos[1] - tr.y) / gap
          tr.vz = 0
        }
        tr.x = m.pos[0]
        tr.y = m.pos[1]
        tr.z = m.pos[2]
        tr.aimYaw = m.aim[0]
        tr.aimPitch = m.aim[1]
        tr.hp = hp
        tr.maxHp = maxHp
        tr.cubes = m.cubes ?? tr.cubes
        tr.weapons = (m.weapons ?? tr.weapons) as string[]
        tr.lastSeenT = t
        tr.listed = true
      }
      const ours = this.hitThisTick.get(m.id) ?? 0
      if (ours) {
        tr.damageFromUs += ours
        tr.lastWeHitT = t
      }
      const charging = !!m.charging
      if (charging && !tr.charging) tr.chargingSince = t
      if (!charging) tr.chargingSince = -1
      tr.charging = charging
      tr.aimingAtUs = Math.abs(wrap(Math.atan2(my - tr.y, mx - tr.x) - tr.aimYaw)) < 0.15
    }
    // forget long-gone tracks (kept 20 s as "where not to walk")
    for (const [id, tr] of this.mechs) if (t - tr.lastSeenT > 20) this.mechs.delete(id)
    for (const [id, n] of this.npcs) if (!obs.mechs.some((m) => m.id === id)) this.npcs.delete(id)
  }

  pendingHits = new Map<number, number>()
  npcHitT = new Map<number, number>()

  /** Tracks currently listed by the server (seen, or within its 5 s memory). */
  live(): Track[] {
    const out: Track[] = []
    for (const tr of this.mechs.values()) if (tr.listed) out.push(tr)
    return out
  }
}
