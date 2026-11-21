import { test } from "node:test"
import assert from "node:assert/strict"
import { dodgeVector } from "../src/tactics/dodge.ts"
import { Tracker } from "../src/state/tracker.ts"
import { ModeDetector } from "../src/state/mode.ts"
import { Brain } from "../src/brain.ts"
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

const mech = (id: number, x: number, hp: number) => ({ id, kind: "mech", pos: [x, 0, 0], vel: [0, 0, 0], aim: [Math.PI, 0], hp, max_hp: 1400, cubes: 0, weapons: ["gun"], charging: false })

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
