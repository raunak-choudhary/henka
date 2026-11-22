// Upgrade pick: first available in the mode's priority list.
import type { Offer } from "../mechfight.ts"
import { PARAMS, UPGRADES_AVOID, UPGRADES_FFA, UPGRADES_SQUAD, UPGRADES_SQUAD_CORE } from "../config.ts"

export function pickUpgrade(offer: Offer, ffa: boolean): number {
  const ch = Array.isArray(offer?.choices) ? offer.choices : []
  if (!ch.length) return 0
  const order = ffa ? UPGRADES_FFA : PARAMS.core.upgradeOrder ? UPGRADES_SQUAD_CORE : UPGRADES_SQUAD
  for (const id of order) {
    const i = ch.findIndex((c) => c && c.id === id)
    if (i >= 0) return i
  }
  const i = ch.findIndex((c) => c && !UPGRADES_AVOID.includes(c.id))
  return i >= 0 ? i : 0
}
