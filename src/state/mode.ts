// Squad (practice) or free-for-all, from observations only. Latches to ffa for the rest of the match.
import type { Observation } from "../mechfight.ts"
import type { Tracker } from "./tracker.ts"

export class ModeDetector {
  mode: "squad" | "ffa" = "squad"
  score = 0
  latchedAt = -1
  reasons: string[] = []
  private lossCounted = new Set<number>()
  private beamCounted = false
  private earlyCounted = false
  private foreignCounted = false
  enabled = true

  constructor(enabled = true) {
    this.enabled = enabled
  }

  update(obs: Observation, tr: Tracker) {
    if (this.mode === "ffa" || !this.enabled) return
    if (!this.foreignCounted && tr.foreignDeaths >= 1) {
      this.foreignCounted = true
      this.add(2, "foreign death", obs.t)
    }
    for (const m of tr.mechs.values()) {
      if (m.unexplainedLoss >= 150 && !this.lossCounted.has(m.id)) {
        this.lossCounted.add(m.id)
        this.add(1, `mech ${m.id} lost ${Math.round(m.unexplainedLoss)} HP to others`, obs.t)
      }
    }
    if (!this.beamCounted) {
      for (const b of obs.beams ?? []) {
        const end = b.path?.[b.path.length - 1]
        if (!end || b.by === obs.self.id) continue
        for (const m of obs.mechs) {
          if (m.kind !== "mech" || m.id === b.by || m.id === obs.self.id) continue
          if (Math.hypot(m.pos[0] - end[0], m.pos[1] - end[1]) < 4) {
            this.beamCounted = true
            this.add(1, `beam by ${b.by} on ${m.id}`, obs.t)
            break
          }
        }
        if (this.beamCounted) break
      }
    }
    if (!this.earlyCounted && tr.firstMechDamageT >= 0 && tr.firstMechDamageT < 12) {
      this.earlyCounted = true
      this.add(1, "shot before 12 s", obs.t)
    }
  }

  private add(s: number, why: string, t: number) {
    this.score += s
    this.reasons.push(why)
    if (this.score >= 2) {
      this.mode = "ffa"
      this.latchedAt = t
    }
  }
}
