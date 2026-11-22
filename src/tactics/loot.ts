// Weapon pickups remembered across ticks (they never despawn), and which one to go for.
import type { Observation, WeaponKind } from "../mechfight.ts"
import type { World } from "../world/world.ts"
import { PARAMS } from "../config.ts"

export type Pick = { id: number; kind: WeaponKind; x: number; y: number; z: number; seenT: number }

export class LootMemory {
  picks = new Map<number, Pick>()
  banned = new Map<number, number>() // id -> until t

  update(obs: Observation, nearRange: number) {
    const seen = new Set<number>()
    for (const p of obs.pickups ?? []) {
      seen.add(p.id)
      this.picks.set(p.id, { id: p.id, kind: p.kind, x: p.pos[0], y: p.pos[1], z: p.pos[2], seenT: obs.t })
    }
    const [x, y] = obs.self.pos
    // A remembered pickup inside our all-round sensor range that is not listed any more is gone.
    for (const [id, p] of this.picks) {
      if (!seen.has(id) && Math.hypot(p.x - x, p.y - y) < nearRange * 0.8) this.picks.delete(id)
    }
    for (const e of obs.events ?? []) {
      if (e.type === "take_failed") {
        if (e.reason === "gone") this.picks.delete(e.id)
        else this.banned.set(e.id, obs.t + 10)
      } else if (e.type === "took") this.picks.delete(e.id)
    }
  }

  /** Best weapon to fetch given what we hold; null if nothing worth it. */
  choose(obs: Observation, w: World): Pick | null {
    const me = obs.self
    const slot1 = me.weapons[1]
    const have = slot1?.kind
    if (have === "laser") return null
    const [x, y] = me.pos
    let best: Pick | null = null
    let bs = 1e9
    for (const p of this.picks.values()) {
      if ((this.banned.get(p.id) ?? -1) > obs.t) continue
      if (p.kind !== "laser" && p.kind !== "lightning") continue
      if (have === "lightning" && p.kind !== "laser") continue
      // roof loot needs a jet: skip in v1
      if (p.z - w.ground(p.x, p.y) > 3) continue
      const d = Math.hypot(p.x - x, p.y - y)
      const lim = p.kind === "laser" ? PARAMS.common.laserPickupRange : PARAMS.common.lightningPickupRange
      if (d > lim) continue
      const s = p.kind === "laser" ? d : d + 150
      if (s < bs) (bs = s), (best = p)
    }
    return best
  }
}

/** Power cubes remembered after they leave view (obs lists them only while seen), so kill drops are collected. */
export class CubeMemory {
  cubes = new Map<number, { x: number; y: number; z: number; seenT: number }>()

  update(obs: Observation, nearRange: number, mechs: { x: number; y: number }[]) {
    const seen = new Set<number>()
    for (const c of obs.cubes ?? []) {
      seen.add(c.id)
      this.cubes.set(c.id, { x: c.pos[0], y: c.pos[1], z: c.pos[2], seenT: obs.t })
    }
    const [x, y] = obs.self.pos
    for (const [id, c] of this.cubes) {
      const d = Math.hypot(c.x - x, c.y - y)
      // gone: inside our all-round sensor and not listed, picked up by someone standing on it, or stale
      if ((!seen.has(id) && d < nearRange * 0.8) || obs.t - c.seenT > PARAMS.common.cubeMemoryS || mechs.some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 3.5)) this.cubes.delete(id)
    }
  }

  list(): { x: number; y: number; z: number }[] {
    return [...this.cubes.values()]
  }
}
