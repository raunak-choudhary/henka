// Target choice (lower score is better) and the engage rules for each mode.
import type { Track, Tracker } from "../state/tracker.ts"
import { PARAMS } from "../config.ts"
import { wrap } from "../vec.ts"

export function targetScore(tr: Track, x: number, y: number, t: number, currentId: number, ffa = false): number {
  const d = Math.hypot(tr.x - x, tr.y - y)
  let s = d + 0.15 * tr.hp
  // free-for-all: prefer mechs whose back is to us (x1.5 damage)
  if (ffa && Math.abs(wrap(tr.aimYaw - Math.atan2(y - tr.y, x - tr.x))) > Math.PI / 2) s -= 60
  if (tr.id === currentId) s -= 150
  if (tr.hp <= 0.3 * tr.maxHp) s -= 150
  if (t - tr.lastHitUsT < 6) s -= 40
  return s
}

export function chooseTarget(tk: Tracker, x: number, y: number, t: number, currentId: number, allow: (tr: Track, d: number) => boolean, ffa = false): Track | null {
  let best: Track | null = null
  let bs = Infinity
  for (const tr of tk.live()) {
    const d = Math.hypot(tr.x - x, tr.y - y)
    if (d > PARAMS.squad.maxTargetRange) continue
    if (!allow(tr, d)) continue
    const s = targetScore(tr, x, y, t, currentId, ffa)
    if (s < bs) (bs = s), (best = tr)
  }
  return best
}
