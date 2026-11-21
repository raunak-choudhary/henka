import { test } from "node:test"
import assert from "node:assert/strict"
import { wrap, yawTo, dirOf } from "../src/vec.ts"
import { Terrain } from "../src/world/terrain.ts"
import { solveAim, errorAfterSlew, tolerance } from "../src/tactics/aim.ts"
import { zonePlan } from "../src/tactics/zone.ts"
import { pickUpgrade } from "../src/tactics/upgrades.ts"
import { Guard } from "../src/guard.ts"

test("angles", () => {
  assert.ok(Math.abs(wrap(Math.PI + 0.1) - (-Math.PI + 0.1)) < 1e-9)
  assert.ok(Math.abs(wrap(-Math.PI - 0.1) - (Math.PI - 0.1)) < 1e-9)
  assert.ok(Math.abs(yawTo(0, 0, 0, 1) - Math.PI / 2) < 1e-12)
  const d = dirOf(Math.PI / 2, 0)
  assert.ok(Math.abs(d[0]) < 1e-12 && Math.abs(d[1] - 1) < 1e-12 && d[2] === 0)
})

test("terrain bilinear equals corners and interpolates", () => {
  const spec = { minX: 0, minY: 0, step: 1, nx: 3, ny: 3 }
  const g = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8])
  const t = new Terrain(spec, g)
  assert.equal(t.heightAt(0, 0), 0)
  assert.equal(t.heightAt(1, 1), 4)
  assert.ok(Math.abs(t.heightAt(0.5, 0.5) - 2) < 1e-6)
})

test("aim: stationary target exact", () => {
  const s = solveAim(0, 0, 7, 100, 0, 4.5, 0, 0, 0, 252)
  assert.ok(Math.abs(s.yaw) < 1e-12)
  assert.ok(Math.abs(s.pitch - Math.atan2(-2.5, 100)) < 1e-9)
})

test("aim: crossing target at 11.7 m/s at 100 m intercept error < 0.3 m", () => {
  const v = 11.7, speed = 252, lat = 0.1
  const s = solveAim(0, 0, 4.5, 100, 0, 4.5, 0, v, 0, speed, lat)
  // bullet leaves after the latency along the solution; check where the target is when it arrives
  const tof = Math.hypot(s.px, s.py) / speed
  const ty = v * (lat + tof)
  const by = Math.sin(s.yaw) * speed * tof
  assert.ok(Math.abs(ty - by) < 0.3, `miss ${Math.abs(ty - by)}`)
})

test("aim: latency shifts a hitscan solution by v x 0.1 s", () => {
  const s = solveAim(0, 0, 0, 100, 0, 0, 0, 10, 0, Infinity, 0.1)
  assert.ok(Math.abs(s.py - 1) < 1e-9)
})

test("aim: slew and tolerance", () => {
  assert.equal(errorAfterSlew(0, 0, 0.3, 0, 4, 3), 0)
  assert.ok(Math.abs(errorAfterSlew(0, 0, 1, 0, 4, 3) - 0.6) < 1e-9)
  assert.ok(tolerance(2.5, 100) > 0.018 && tolerance(2.5, 100) < 0.02)
})

test("zone: must-leave time matches hand calculation", () => {
  // next circle radius 380 at (0,0), we stand 500 m out; safe point is 0.7*380 = 266 m from centre
  const z = { center: [0, 0], radius: 560, next_center: [0, 0], next_radius: 380, shrink_start: 60, shrink_end: 110, dps: 20 } as any
  const travel = (500 - 266) / 11.7 // 20.0 s
  const leaveAt = 110 - (travel * 1.4 + 6) // 76.0 s
  assert.equal(zonePlan(leaveAt - 1, 500, 0, true, z, 11.7).mustGo, false)
  assert.equal(zonePlan(leaveAt + 0.1, 500, 0, true, z, 11.7).mustGo, true)
  assert.equal(zonePlan(10, 500, 0, false, z, 11.7).mustGo, true) // outside the current circle
  assert.equal(zonePlan(100, 100, 0, true, z, 11.7).mustGo, false) // inside the next circle
  for (const [r, end] of [[240, 195], [140, 265], [70, 325], [25, 375]]) {
    const zz = { ...z, next_radius: r, shrink_end: end }
    const d = r + 50
    const tr = (d - 0.7 * r) / 11.7
    const at = end - (tr * 1.4 + 6)
    assert.equal(zonePlan(at - 0.2, d, 0, true, zz, 11.7).mustGo, false)
    assert.equal(zonePlan(at + 0.2, d, 0, true, zz, 11.7).mustGo, true)
  }
  // final phase, radius 0: go to the centre
  const z0 = { ...z, next_radius: 0, shrink_end: 415 }
  const p = zonePlan(400, 30, 0, true, z0, 11.7)
  assert.equal(p.tx, 0)
})

test("upgrades follow priority, unknown ids never crash", () => {
  const offer = (ids: string[]) => ({ id: 1, expires: 5, choices: ids.map((id) => ({ id, name: id, desc: "" })) })
  assert.equal(pickUpgrade(offer(["gyros", "armor", "plating"]), false), 2)
  assert.equal(pickUpgrade(offer(["gyros", "armor", "nanites"]), true), 2)
  assert.equal(pickUpgrade(offer(["mortar_splash", "zzz", "qqq"]), false), 1)
  assert.equal(pickUpgrade({ id: 1, expires: 1, choices: [] } as any, false), 0)
})

test("guard trips after the limit", () => {
  const g = new Guard(30)
  g.start()
  const t = performance.now()
  while (performance.now() - t < 40) {}
  assert.equal(g.over(), true)
})
