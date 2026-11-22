import { test } from "node:test"
import assert from "node:assert/strict"
import { dodgeVector } from "../src/tactics/dodge.ts"
import { Tracker } from "../src/state/tracker.ts"
import { ModeDetector } from "../src/state/mode.ts"
import { Brain } from "../src/brain.ts"
import { PARAMS } from "../src/config.ts"
import { kitStream, ARENA } from "./helpers.ts"

const baseObs = (t: number, extra: any = {}) => ({
  type: "obs", tick: Math.round(t * 20), t, alive: 16,
  self: { id: 0, pos: [0, 0, 0], vel: [0, 0, 0], aim: [0, 0], hp: 1400, max_hp: 1400, energy: 100, max_energy: 100, grounded: true, cubes: 0, upgrades: [], weapons: [null, null], in_zone: true, stats: {} },
  mechs: [], projectiles: [], crates: [], cubes: [], pickups: [], sounds: [], beams: [], events: [], drops: [], offer: null,
  zone: { center: [0, 0], radius: 560, next_center: [0, 0], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 },
  ...extra,
}) as any

test("dodge: a bullet aimed at us is flagged, one passing 10 m wide is not", () => {
  const hit = dodgeVector(0, 0, 0, 9, 2.5, [{ id: 1, kind: "gun", pos: [-100, 0.5, 4.5], vel: [252, 0, 0] }] as any, 0.6, 1.2)
  assert.ok(hit)
  assert.ok(Math.abs(hit!.dx) < 1e-9 && Math.abs(Math.abs(hit!.dy) - 1) < 1e-9)
  assert.ok(hit!.dy < 0, "steps to the side away from where the shot passes")
  const wide = dodgeVector(0, 0, 0, 9, 2.5, [{ id: 1, kind: "gun", pos: [-100, 10, 4.5], vel: [252, 0, 0] }] as any, 0.6, 1.2)
  assert.equal(wide, null)
  const far = dodgeVector(0, 0, 0, 9, 2.5, [{ id: 1, kind: "gun", pos: [-200, 0, 4.5], vel: [252, 0, 0] }] as any, 0.6, 1.2)
  assert.equal(far, null, "beyond the 0.6 s horizon")
})

const mech = (id: number, x: number, hp: number) => ({ id, kind: "mech", pos: [x, 0, 0], vel: [0, 0, 0], aim: [Math.PI / 2, 0], hp, max_hp: 1400, cubes: 0, weapons: ["gun"], charging: false })

test("mode: one foreign death latches ffa; our own kill does not", () => {
  let tk = new Tracker(), md = new ModeDetector(true)
  let o = baseObs(30, { alive: 15, events: [{ type: "kill", target: 3 }] })
  tk.update(o); md.update(o, tk)
  assert.equal(md.mode, "squad")
  o = baseObs(30.1, { alive: 14 })
  tk.update(o); md.update(o, tk)
  assert.equal(md.mode, "ffa")
  tk = new Tracker(); md = new ModeDetector(true)
  o = baseObs(25, { alive: 15 })
  tk.update(o); md.update(o, tk)
  assert.equal(md.mode, "ffa")
})

test("mode: 100 HP of drone damage does not count; 150+ unexplained HP counts once per mech", () => {
  const tk = new Tracker(), md = new ModeDetector(true)
  for (let k = 0; k <= 4; k++) {
    const o = baseObs(30 + k * 0.1, { mechs: [mech(4, 80, 1400 - k * 25)] })
    tk.update(o); md.update(o, tk)
  }
  assert.equal(md.score, 0)
  for (let k = 5; k <= 9; k++) {
    const o = baseObs(30 + k * 0.1, { mechs: [mech(4, 80, 1400 - k * 45)] })
    tk.update(o); md.update(o, tk)
  }
  assert.equal(md.score, 1)
  assert.equal(md.mode, "squad")
})

test("mode: our own hits are not counted as unexplained", () => {
  const tk = new Tracker(), md = new ModeDetector(true)
  for (let k = 0; k <= 10; k++) {
    const o = baseObs(30 + k * 0.1, { mechs: [mech(4, 80, 1400 - k * 45)], events: k ? [{ type: "hit", target: 4, amount: 45, weapon: "gun" }] : [] })
    tk.update(o); md.update(o, tk)
  }
  assert.equal(md.score, 0)
})

test("brain: answers every kit observation with a valid action and never throws", () => {
  const msgs = kitStream()
  const hello = msgs[0]
  hello.map.dir = ARENA
  const b = new Brain(hello)
  for (const m of msgs) {
    if (m.type !== "obs") continue
    const a = b.act(m)
    assert.ok(Array.isArray(a.move) && a.move.length === 2 && a.move.every(Number.isFinite))
    assert.ok(Math.hypot(a.move![0], a.move![1]) <= 1 + 1e-9)
    assert.ok(Array.isArray(a.aim) && a.aim.every(Number.isFinite))
    assert.ok(a.fire!.length === 2 && a.fire!.every((f) => typeof f === "boolean"))
    if (m.offer) assert.ok(Number.isInteger(a.pick))
  }
})

test("mode: HP lost outside the zone does not count", () => {
  const tk = new Tracker(), md = new ModeDetector(true)
  for (let k = 0; k <= 10; k++) {
    const o = baseObs(30 + k * 0.1, { mechs: [{ ...mech(4, 80, 1400 - k * 45), pos: [600, 0, 0] }] })
    tk.update(o); md.update(o, tk)
  }
  assert.equal(md.score, 0)
})

test("squad engage: skips a far, healthy, idle mech; takes close, weak, closing or attacking ones", () => {
  const hello = kitStream()[0]
  hello.map.dir = ARENA
  const b = new Brain(hello) as any
  const tr = (o: any = {}) => ({ id: 3, x: 200, y: 0, z: 0, vx: 0, vy: 0, hp: 1400, maxHp: 1400, aimingAtUs: false, lastHitUsT: -99, ...o })
  const eng = (o: any, t = 60) => b.squadEngage(tr(o), Math.hypot(tr(o).x, tr(o).y), t, t - tr(o).lastHitUsT < 6, 0, 0)
  assert.equal(eng({}), false)
  assert.equal(eng({ x: 100 }), true)
  assert.equal(eng({ hp: 600 }), true)
  assert.equal(eng({ vx: -5 }), true)
  assert.equal(eng({ aimingAtUs: true }), true)
  assert.equal(eng({ lastHitUsT: 58 }), true)
  assert.equal(eng({}, 250), true)
})

// ---- stalk
function stalkBrain() {
  const hello = kitStream()[0]
  hello.map.dir = ARENA
  return new Brain(hello)
}
function idleObs(b: Brain, t: number, mechs: any[], extra: any = {}) {
  const g = b.w.grid
  const s = g.nearestPass(g.idx(-60, -20))
  const x = g.cx(s), y = g.cy(s)
  return {
    type: "obs", tick: Math.round(t * 20), t, alive: 16,
    self: { id: 0, pos: [x, y, b.w.ground(x, y)], vel: [0, 0, 0], aim: [0, 0], hp: 1400, max_hp: 1400, energy: 100, max_energy: 100, grounded: true, cubes: 0, upgrades: [], weapons: [{ kind: "gun", ammo: 12, reload: 0, cooldown: 0 }, { kind: "laser", charge: 0, cooldown: 0 }], in_zone: true, stats: {} },
    mechs, projectiles: [], crates: [], cubes: [], pickups: [], sounds: [], beams: [], events: [], drops: [], offer: null,
    zone: { center: [41.3, -72.8], radius: 560, next_center: [41.3, -72.8], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 },
    ...extra,
  } as any
}
const prey = (b: Brain, id: number, x: number, y: number, hp = 1400) => ({ id, kind: "mech", pos: [x, y, b.w.ground(x, y)], vel: [0, 0, 0], aim: [Math.PI / 2, 0], hp, max_hp: 1400, cubes: 0, weapons: ["gun", "laser"], charging: false })

test("stalk: idle and healthy with a far house bot known -> walk to a cell ~115 m from it on our side", () => {
  const b = stalkBrain()
  const o = idleObs(b, 40, [])
  const [x, y] = o.self.pos
  o.mechs = [prey(b, 7, x + 180, y)]
  const a = b.act(o)
  assert.equal(b.intent.split("+")[0], "stalk")
  const g = (b as any).stalkCache
  const dPrey = Math.hypot(g.x - (x + 180), g.y - y)
  assert.ok(Math.abs(dPrey - PARAMS.squad.stalkRange) < 1, String(dPrey))
  assert.ok(Math.hypot(g.x - x, g.y - y) < 130) // our side of it (arc of +-0.6 rad), not past it
  assert.ok(Math.hypot(a.move![0], a.move![1]) > 0.5)
})

test("stalk gates: opening, hurt, end game, flag off, out-of-circle prey -> no stalk", () => {
  const cases: [string, (b: Brain, o: any) => void][] = [
    ["opening", (_b, o) => (o.t = 10)],
    ["hurt", (_b, o) => (o.self.hp = 900)],
    ["end game", (_b, o) => ((o.zone.radius = 200), (o.zone.next_radius = 130), (o.zone.next_center = o.self.pos.slice(0, 2)), (o.zone.center = o.self.pos.slice(0, 2)))],
    ["flag off", () => (PARAMS.squad.stalk = false)],
  ]
  for (const [name, mod] of cases) {
    const b = stalkBrain()
    const o = idleObs(b, 40, [])
    const [x, y] = o.self.pos
    o.mechs = [prey(b, 7, x + 180, y)]
    mod(b, o)
    b.act(o)
    PARAMS.squad.stalk = true
    assert.notEqual(b.intent.split("+")[0], "stalk", name)
  }
  // prey outside the next circle: do not follow it out
  const b = stalkBrain()
  const o = idleObs(b, 40, [])
  const [x, y] = o.self.pos
  o.zone.next_center = [x - 200, y]
  o.zone.next_radius = 300
  o.mechs = [prey(b, 7, x + 180, y)]
  assert.equal(b.stalkGoal(o, 40, x, y, o.self.pos[2], 8, 1, () => true), null)
})

test("stalk: prey already within stalk range -> null (engage rule takes over)", () => {
  const b = stalkBrain()
  const o = idleObs(b, 40, [])
  const [x, y] = o.self.pos
  o.mechs = [prey(b, 7, x + 100, y)]
  b.act(o)
  assert.equal(b.stalkGoal(o, 40.05, x, y, o.self.pos[2], 8, 1, () => true), null)
})

test("stalk: nobody known but far gunfire heard -> walk along its bearing; near sounds ignored", () => {
  const b = stalkBrain()
  const o = idleObs(b, 40, [], { sounds: [{ kind: "gun", bearing: 0, dist: "far", age: 0.2 }] })
  const [x, y, z] = o.self.pos
  b.act(o)
  const g = b.stalkGoal(o, 40, x, y, z, 8, 1, () => true)
  assert.ok(g && g.x > x + 20 && Math.abs(g.y - y) < 5, JSON.stringify(g))
  const b2 = stalkBrain()
  const o2 = idleObs(b2, 40, [], { sounds: [{ kind: "gun", bearing: 0, dist: "near", age: 0.2 }] })
  b2.act(o2)
  assert.equal(b2.stalkGoal(o2, 40, x, y, z, 8, 1, () => true), null)
})
