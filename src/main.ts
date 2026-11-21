// Henka entry point: the kit wrapper drives stdin/stdout; all decisions are in Brain.
import { run, type Hello, type Observation } from "./mechfight.ts"
import { yawTo, dist2, unit } from "./vec.ts"

run((hello: Hello) => {
  const cfg = hello.config
  return {
    name: "henka",
    act(obs: Observation) {
      const me = obs.self
      const [x, y, z] = me.pos
      const g = obs.zone.next_center
      const mv = unit(g[0] - x, g[1] - y)
      const act: any = { move: dist2(x, y, g[0], g[1]) > obs.zone.next_radius * 0.3 ? mv : [0, 0], aim: [Math.atan2(mv[1], mv[0]), 0] }
      if (obs.offer) act.pick = 0
      let best: any = null
      let bd = 1e9
      for (const m of obs.mechs) {
        if (m.kind !== "mech") continue
        const d = dist2(x, y, m.pos[0], m.pos[1])
        if (d < bd) (bd = d), (best = m)
      }
      if (best) {
        const speed = cfg.weapons.gun.speed
        let tx = best.pos[0], ty = best.pos[1]
        for (let i = 0; i < 4; i++) {
          const tt = dist2(x, y, tx, ty) / speed + 0.1
          tx = best.pos[0] + best.vel[0] * tt
          ty = best.pos[1] + best.vel[1] * tt
        }
        const d = dist2(x, y, tx, ty)
        act.aim = [yawTo(x, y, tx, ty), Math.atan2(best.pos[2] + 4.5 - (z + 7), d)]
        act.fire = [d < cfg.weapons.gun.range, false]
      }
      return act
    },
  }
})
