// debate-A squad core: one test group per flag.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Brain } from "../src/brain.ts"
import { PARAMS } from "../src/config.ts"
import { pickUpgrade } from "../src/tactics/upgrades.ts"
import { findCover } from "../src/tactics/position.ts"
import { kitStream, ARENA } from "./helpers.ts"

// These tests exercise each piece with it switched on, whatever the shipped defaults are; a test that
// checks the off state flips its own flag with withFlags.
for (const k of Object.keys(PARAMS.core) as (keyof typeof PARAMS.core)[]) if (typeof PARAMS.core[k] === "boolean") (PARAMS.core as any)[k] = true

function brain() {
  const hello = kitStream()[0]
  hello.map.dir = ARENA
  return new Brain(hello)
}
function base(b: Brain, t = 40, hp = 1400) {
  const g = b.w.grid
  const s = g.nearestPass(g.idx(-60, -20))
  const x = g.cx(s), y = g.cy(s)
  return {
    type: "obs", tick: Math.round(t * 20), t, alive: 16,
    self: { id: 0, pos: [x, y, b.w.ground(x, y)], vel: [0, 0, 0], aim: [0, 0], hp, max_hp: 1400, energy: 100, max_energy: 100, grounded: true, cubes: 0, upgrades: [], weapons: [{ kind: "gun", ammo: 12, reload: 0, cooldown: 0 }, { kind: "laser", charge: 0, cooldown: 0 }], in_zone: true, stats: {} },
    mechs: [] as any[], projectiles: [] as any[], crates: [] as any[], cubes: [], pickups: [], sounds: [], beams: [], events: [], drops: [], offer: null,
    zone: { center: [41.3, -72.8], radius: 560, next_center: [41.3, -72.8], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 },
  } as any
}
/** A ground point at distance r from us that we can (see=true) or cannot (see=false) see. */
function spot(b: Brain, o: any, r: number, see: boolean): [number, number, number] {
  const [x, y, z] = o.self.pos
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * 2 * Math.PI
    const qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r
    const g = b.w.grid
    if (!g.pass[g.idx(qx, qy)]) continue
    const qz = b.w.ground(qx, qy)
    if (Math.abs(qz - z) > 3) continue
    const v = b.w.los(x, y, z + 8, qx, qy, qz + 4.5) && b.w.los(x, y, z + 8, qx, qy, qz + 1)
    const head = b.w.los(x, y, z + 8, qx, qy, qz + 8.5)
    if (see ? v : !v && !head) return [qx, qy, qz]
  }
  throw new Error("no spot")
}
const mech = (id: number, p: number[], extra: any = {}) => ({ id, kind: "mech", pos: p, vel: [0, 0, 0], aim: [0, 0], hp: 1400, max_hp: 1400, cubes: 0, weapons: ["gun", "laser"], charging: false, ...extra })
function withFlags(f: Partial<typeof PARAMS.core>, fn: () => void) {
  const keep = { ...PARAMS.core }
  Object.assign(PARAMS.core, f)
  try { fn() } finally { Object.assign(PARAMS.core, keep) }
}

// (a) farming
test("farm: idle, healthy, crate in sight within range -> stand and shoot it with the gun, never the laser", () => {
  const b = brain()
  const o = base(b)
  const p = spot(b, o, 30, true)
  o.crates = [{ id: 1001, pos: p, hp: 300 }]
  const a = b.act(o)
  assert.equal(b.intent.split("+")[0], "farmCrate")
  assert.deepEqual(a.move, [0, 0])
  assert.equal(a.fire![1], false)
  // aim turns to the crate; once on it, the gun fires
  o.self.aim = a.aim
  o.t += 0.05
  const a2 = b.act(o)
  assert.equal(a2.fire![0], true)
  assert.equal(a2.fire![1], false)
})

test("farm: crate far away -> walk to it; hurt or flag off -> no farming", () => {
  const b = brain()
  const o = base(b)
  const p = spot(b, o, 110, true)
  o.crates = [{ id: 1002, pos: p, hp: 300 }]
  const a = b.act(o)
  assert.equal(b.intent.split("+")[0], "farmCrate")
  assert.ok(Math.hypot(a.move![0], a.move![1]) > 0.5)
  const h = brain()
  const oh = base(h, 40, 650) // 46% HP
  oh.crates = [{ id: 1002, pos: p, hp: 300 }]
  h.act(oh)
  assert.ok(!h.intent.startsWith("farm"))
  withFlags({ farmCrates: false }, () => {
    const f = brain()
    const of = base(f)
    of.crates = [{ id: 1002, pos: p, hp: 300 }]
    f.act(of)
    assert.ok(!f.intent.startsWith("farm"))
  })
})

test("farm: a drone in range -> farmDrone with the gun only; at the cube cap drones are skipped", () => {
  const b = brain()
  const o = base(b)
  const p = spot(b, o, 40, true)
  o.mechs = [{ id: 104, kind: "npc", pos: [p[0], p[1], p[2] + 2.75], vel: [0, 0, 0], aim: [0, 0], hp: 350, max_hp: 350 }]
  const a = b.act(o)
  assert.equal(b.intent.split("+")[0], "farmDrone")
  assert.equal(a.fire![1], false)
  const c = brain()
  const oc = base(c)
  oc.self.cubes = 10
  oc.mechs = o.mechs
  c.act(oc)
  assert.ok(!c.intent.startsWith("farm"))
})

test("farm: give up on a goal after farmGiveUpS and ban it", () => {
  const b = brain()
  const o = base(b)
  const p = spot(b, o, 110, true)
  o.crates = [{ id: 1003, pos: p, hp: 300 }]
  ;(b as any).farmMemory(o, 40, o.self.pos[0], o.self.pos[1], o.self.pos[2], 8)
  assert.ok(b.farmGoal(o, 40, o.self.pos[0], o.self.pos[1], o.self.pos[2], 8, 1, false, () => true))
  assert.ok(b.farmGoal(o, 40, o.self.pos[0], o.self.pos[1], o.self.pos[2], 8, 1, false, () => true))
  assert.equal(b.farmGoal(o, 40 + PARAMS.core.farmGiveUpS + 1, o.self.pos[0], o.self.pos[1], o.self.pos[2], 8, 1, false, () => true), null)
  assert.equal(b.farmGoal(o, 40 + PARAMS.core.farmGiveUpS + 2, o.self.pos[0], o.self.pos[1], o.self.pos[2], 8, 1, false, () => true), null)
})

test("farm detours: idle cube at 90 m is taken with the flag, not without", () => {
  for (const on of [true, false])
    withFlags({ farmDetours: on, farmCrates: false, farmDrones: false }, () => {
      const b = brain()
      const o = base(b)
      const p = spot(b, o, 90, true)
      o.cubes = [{ id: 5001, pos: p }]
      b.act(o)
      assert.equal(b.intent.split("+")[0] === "cube", on, String(on))
    })
})

// (b) upgrades
test("upgrade order: armor before laser_damage with the flag; old order without", () => {
  const offer = { id: 1, expires: 5, choices: [{ id: "laser_damage", name: "", desc: "" }, { id: "armor", name: "", desc: "" }, { id: "gyros", name: "", desc: "" }] } as any
  assert.equal(pickUpgrade(offer, false), 1)
  withFlags({ upgradeOrder: false }, () => assert.equal(pickUpgrade(offer, false), 0))
})

// (c) line of sight
test("LOS targets: a listed mech behind a wall at 60 m is not a target; flag off it is", () => {
  for (const on of [true, false])
    withFlags({ losTargets: on }, () => {
      const b = brain()
      const o = base(b)
      const p = spot(b, o, 60, false)
      o.mechs = [mech(3, p)]
      b.act(o)
      assert.equal(b.targetId, on ? -1 : 3, String(on))
    })
})

// (d) head aim
test("head aim: centre ray blocked but head visible -> aim pitch goes up to the head", () => {
  const pitches: number[] = []
  for (const on of [false, true])
    withFlags({ headAim: on }, () => {
      const b = brain()
      const o = base(b)
      const p = spot(b, o, 50, true)
      o.mechs = [mech(3, p, { aim: [Math.atan2(o.self.pos[1] - p[1], o.self.pos[0] - p[0]), 0] })]
      const los = b.w.los.bind(b.w)
      b.w.los = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => (Math.abs(bx - p[0]) < 0.01 && Math.abs(bz - (p[2] + 4.5)) < 0.01 ? false : los(ax, ay, az, bx, by, bz))
      const a = b.act(o)
      assert.equal(b.targetId, 3)
      pitches.push(a.aim![1])
    })
  assert.ok(pitches[1] > pitches[0] + 0.02, JSON.stringify(pitches))
})

// (e) boost
test("boost: a bullet coming at us gives a walking sidestep without boost; a charging laser aimed at us gives a boosted one", () => {
  const b = brain()
  const o = base(b)
  const [x, y, z] = o.self.pos
  o.projectiles = [{ id: 900, kind: "gun", pos: [x + 40, y, z + 4.5], vel: [-252, 0, 0] }]
  const a = b.act(o)
  assert.equal(a.boost, false)
  assert.ok(b.intent.endsWith("+dodge"))
  const l = brain()
  const ol = base(l)
  const p = spot(l, ol, 150, true)
  ol.mechs = [mech(4, p, { charging: true, aim: [Math.atan2(y - p[1], x - p[0]), 0] })]
  const al = l.act(ol)
  assert.ok(l.intent.endsWith("+laserDodge"), l.intent)
  assert.equal(al.boost, true)
  withFlags({ laserOnlyBoost: false }, () => {
    const c = brain()
    const oc = base(c)
    oc.projectiles = o.projectiles
    assert.equal(c.act(oc).boost, true) // old rule: boost on any bullet
  })
})

// (f) lose rule
test("lose rule: two visible mechs near and HP 45% -> losing (retreat to cover when there is any); finishing, end game, healthy, flag off -> not", () => {
  const mk = (hp: number, tHp: number, late = false) => {
    const b = brain()
    const o = base(b, 120, hp)
    const p1 = spot(b, o, 70, true), p2 = spot(b, o, 95, true)
    o.mechs = [mech(3, p1, { hp: tHp }), mech(4, p2)]
    if (late) (o.zone.next_radius = 60), (o.zone.radius = 120), (o.zone.center = o.self.pos.slice(0, 2)), (o.zone.next_center = o.self.pos.slice(0, 2))
    b.act(o)
    return b.loseAt === 120
  }
  assert.equal(mk(630, 1400), true)
  assert.equal(mk(630, 150), false) // finishing
  assert.equal(mk(630, 1400, true), false) // late
  assert.equal(mk(1000, 1400), false) // 71%: fine with two near
  withFlags({ loseRetreat: false }, () => assert.equal(mk(630, 1400), false))
})

test("lose rule: with cover in reach the intent is retreat, and the 1.5 s hold keeps it after the condition clears", () => {
  const b = brain()
  const g = b.w.grid
  let found: { o: any; p1: number[]; p2: number[] } | null = null
  for (let k = 0; k < 400 && !found; k++) {
    const s0 = g.nearestPass(g.idx(-60 + (k % 20) * 12, -20 + Math.floor(k / 20) * 12))
    if (s0 < 0) continue
    const o = base(b, 120, 630)
    o.self.pos = [g.cx(s0), g.cy(s0), b.w.ground(g.cx(s0), g.cy(s0))]
    if (Math.hypot(o.self.pos[0] - 41.3, o.self.pos[1] + 72.8) > 300) continue
    let p1: number[], p2: number[]
    try { (p1 = spot(b, o, 70, true)), (p2 = spot(b, o, 95, true)) } catch { continue }
    const th = [{ x: p1[0], y: p1[1], z: p1[2] }, { x: p2[0], y: p2[1], z: p2[2] }] as any
    if (findCover(b.w, o.self.pos[0], o.self.pos[1], o.self.pos[2], th, PARAMS.core.loseCoverM)) found = { o, p1, p2 }
  }
  assert.ok(found, "no test spot with cover")
  const { o, p1, p2 } = found!
  o.mechs = [mech(3, p1), mech(4, p2)]
  b.act(o)
  assert.equal(b.intent.split("+")[0], "retreat")
  o.t = 121
  o.self.hp = 1300 // condition clears; the hold keeps the retreat
  b.act(o)
  assert.equal(b.intent.split("+")[0], "retreat")
  o.t = 121.7
  b.act(o)
  assert.notEqual(b.intent.split("+")[0], "retreat")
})
