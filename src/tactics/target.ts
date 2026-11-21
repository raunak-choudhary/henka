// Target choice (lower score is better) and the engage rules for each mode.
import type { Track, Tracker } from "../state/tracker.ts"
import { PARAMS } from "../config.ts"

export function targetScore(tr: Track, x: number, y: number, t: number, currentId: number): number {
  const d = Math.hypot(tr.x - x, tr.y - y)
  let s = d + 0.15 * tr.hp
  if (tr.id === currentId) s -= 150
  if (tr.hp <= 0.3 * tr.maxHp) s -= 150
  if (t - tr.lastHitUsT < 6) s -= 40
  return s
}

export function chooseTarget(tk: Tracker, x: number, y: number, t: number, currentId: number, allow: (tr: Track, d: number) => boolean): Track | null {
  let best: Track | null = null
  let bs = Infinity
  for (const tr of tk.live()) {
    const d = Math.hypot(tr.x - x, tr.y - y)
    if (d > PARAMS.squad.maxTargetRange) continue
    if (!allow(tr, d)) continue
    const s = targetScore(tr, x, y, t, currentId)
    if (s < bs) (bs = s), (best = tr)
  }
  return best
}
