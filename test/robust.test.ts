// Protocol robustness: the bot must always answer with a valid action, whatever the observation holds.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Brain } from "../src/brain.ts"
import { kitStream, ARENA } from "./helpers.ts"

const hello = () => {
  const h = kitStream()[0]
  h.map.dir = ARENA
  return h
}
let shared: Brain | null = null
const brain = () => (shared ??= new Brain(hello()))

const base = (t: number, extra: any = {}, self: any = {}) => ({
  type: "obs", tick: Math.round(t * 20), t, alive: 16,
  self: { id: 0, pos: [-60, -20, -4], vel: [0, 0, 0], aim: [0, 0], hp: 1400, max_hp: 1400, energy: 100, max_energy: 100, grounded: true, cubes: 0, upgrades: [], weapons: [{ kind: "gun", cooldown: 0, ammo: 12, reload: 0, stats: { damage: 45, speed: 252, range: 230 } }, null], in_zone: true, stats: {}, ...self },
  mechs: [], projectiles: [], crates: [], cubes: [], pickups: [], sounds: [], beams: [], events: [], drops: [], offer: null,
  zone: { center: [41.3, -72.8], radius: 560, next_center: [41.3, -72.8], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 },
  ...extra,
}) as any

const valid = (a: any) => {
  assert.ok(Array.isArray(a.move) && a.move.length === 2 && a.move.every(Number.isFinite), "move")
  assert.ok(Math.hypot(a.move[0], a.move[1]) <= 1 + 1e-9, "move norm")
  assert.ok(Array.isArray(a.aim) && a.aim.length === 2 && a.aim.every(Number.isFinite), "aim")
  assert.ok(Array.isArray(a.fire) && a.fire.length === 2 && a.fire.every((f: unknown) => typeof f === "boolean"), "fire")
  for (const k of ["pick", "take", "drop"]) if (a[k] !== undefined) assert.ok(Number.isFinite(a[k]), k)
}
const enemy = (o: any = {}) => ({ id: 5, kind: "mech", pos: [20, -20, -4], vel: [3, 0, 0], aim: [Math.PI, 0], hp: 1400, max_hp: 1400, cubes: 0, weapons: ["gun", "laser"], charging: false, ...o })

const cases: [string, any][] = [
  ["no enemies visible", base(30)],
  ["zero energy, enemy close", base(40, { mechs: [enemy()] }, { energy: 0 })],
  ["our hp at 0", base(41, { mechs: [enemy()] }, { hp: 0 })],
  ["enemy at 0 hp", base(42, { mechs: [enemy({ hp: 0 })] })],
  ["last circle radius 0, outside", base(420, { zone: { center: [0, 0], radius: 0, next_center: [0, 0], next_radius: 0, shrink_start: 400, shrink_end: 415, dps: 260 } }, { in_zone: false })],
  ["unknown event types and odd event fields", base(43, { events: [{ type: "mystery", foo: 1 }, { type: "damaged", amount: 50 }, { type: "damaged", amount: 50, by: 999, bearing: null }, { type: "hit" }, { type: "took" }, { type: "take_failed" }, { type: "pickup" }, { type: "death" }, null, 7] })],
  ["missing arrays", (() => { const o = base(44); for (const k of ["mechs", "projectiles", "crates", "cubes", "pickups", "sounds", "beams", "events", "drops"]) delete o[k]; return o })()],
  ["null arrays", (() => { const o = base(45); for (const k of ["mechs", "projectiles", "crates", "cubes", "pickups", "sounds", "beams", "events", "drops"]) o[k] = null; return o })()],
  ["empty weapons", base(46, { mechs: [enemy()] }, { weapons: [] })],
  ["laser charging, no stats", base(47, { mechs: [enemy()] }, { weapons: [{ kind: "gun" }, { kind: "laser", charge: 0.5, cooldown: 0 }] })],
  ["mortar in slot 1", base(48, { mechs: [enemy()] }, { weapons: [{ kind: "gun", ammo: 0, reload: 0 }, { kind: "mortar", cooldown: 0 }] })],
  ["NaN self position", base(49, {}, { pos: [NaN, 0, 0] })],
  ["far off-map position", base(50, { mechs: [enemy({ pos: [5000, 5000, 0] })] }, { pos: [9999, -9999, 0] })],
  ["malformed mechs entries", base(51, { mechs: [{ id: 6 }, { id: 7, kind: "mech", pos: [10, 10] }, enemy({ vel: null, aim: null })] })],
  ["offer with empty choices", base(52, { offer: { id: 1, expires: 60, choices: [] } })],
  ["offer with unknown ids", base(53, { offer: { id: 2, expires: 60, choices: [{ id: "x" }, { id: "y" }, { id: "z" }] } })],
  ["missing zone", (() => { const o = base(54); delete o.zone; return o })()],
  ["missing self.stats and weapons", base(55, { mechs: [enemy()] }, { stats: undefined, weapons: undefined })],
  ["projectile with no velocity", base(56, { projectiles: [{ id: 1, kind: "gun", pos: [0, -20, 0] }, { id: 2 }] })],
  ["drops and pickups with odd fields", base(57, { drops: [{ id: 20000 }], pickups: [{ id: 8001, kind: "laser" }, { id: 8002, kind: "unknown", pos: [0, 0, 0] }], cubes: [{ id: 5001 }] })],
]

for (const [name, obs] of cases) {
  test(`robust: ${name}`, () => {
    const a = brain().act(obs)
    valid(a)
  })
}

test("robust: a fresh brain answers 200 random garbage observations", () => {
  const b = brain()
  let seed = 7
  const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let k = 0; k < 200; k++) {
    const o = base(60 + k * 0.1, { mechs: r() < 0.5 ? [enemy({ pos: [r() * 400 - 200, r() * 400 - 200, r() * 30], hp: r() * 1400 })] : [] }, { hp: r() * 1400, energy: r() * 100, cubes: Math.floor(r() * 20) })
    if (r() < 0.2) o.self.weapons = [null, { kind: ["laser", "lightning", "mortar"][k % 3], charge: r(), cooldown: r() }]
    if (r() < 0.1) o.events = [{ type: "damaged", amount: r() * 200, by: 5, bearing: r() * 6 }]
    valid(b.act(o))
  }
})

test("robust: an observation with no self still gets a valid action", () => {
  valid(brain().act({ type: "obs", tick: 1 } as any))
  valid(brain().act({} as any))
})

test("robust: a missing zone falls back to the last zone seen, so zone logic keeps working", () => {
  const b = new Brain(hello())
  b.act(base(100, { zone: { center: [500, 0], radius: 50, next_center: [500, 0], next_radius: 30, shrink_start: 90, shrink_end: 120, dps: 35 } }, { in_zone: false }))
  const o = base(100.1, {}, { in_zone: false })
  delete o.zone
  const a = b.act(o)
  valid(a)
  assert.equal(b.intent, "zone", "still walking to the last known zone")
})
