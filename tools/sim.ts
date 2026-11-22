// Closed-loop robustness harness. Our mech is moved by our own actions over the real map (simple
// kinematics against our own height field); everyone else replays a recorded match. Not a game:
// nobody reacts to us and we take no damage except the recorded HP curve of the seat we replace.
//   node --experimental-strip-types tools/sim.ts <live.jsonl> [matchIndex|all] [seat|all]
import { gunzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { Brain } from "../src/brain.ts"
import { World } from "../src/world/world.ts"
import type { Hello, Observation } from "../src/mechfight.ts"
import { loadMatches, type Match } from "./cast.ts"
import { wrap } from "../src/vec.ts"

const KIT = process.env.MECH_KIT ?? "../internal/research/kits/mech/mechfight-kit"
const kitHello = (): Hello => {
  const lines = gunzipSync(readFileSync(`${KIT}/check/stream.jsonl.gz`)).toString("utf8").split("\n")
  return JSON.parse(lines[0])
}

export type SimResult = { seat: number; ticks: number; p50: number; p99: number; max: number; errors: number; worstStuckS: number; outsideZoneS: number; took: string[]; cubes: number; picks: number; offers: number; dist: number; final: number[] }

let sharedWorld: World | null = null

export function simulate(M: Match, seat: number, opts: { maxT?: number } = {}): SimResult {
  const hello = kitHello()
  hello.slot = seat
  hello.seed = 1000 + seat
  hello.map.dir = `${KIT}/arena`
  const cfg = hello.config
  sharedWorld ??= World.load(hello.map.dir, hello.map.files)
  const w = sharedWorld
  const brain = new Brain(hello, w)
  const H = M.h
  const kinds = H.weapon_kinds ?? ["gun", "mortar", "laser", "lightning"]
  const zones = H.zone as { center: number[]; radius: number; shrink_start: number; shrink_end: number }[]
  const phases = cfg.zone.phases
  const spawn = H.mechs.find((m: any) => m.id === seat)?.spawn ?? [0, 0, 0]
  let x = spawn[0], y = spawn[1], z = w.surfaceAt(spawn[0], spawn[1])
  let vx = 0, vy = 0, yaw = 0, pitch = 0, energy = 100, airZ = -1e9
  let cubes = 0, maxHp = cfg.mech.hp
  const weapons: any[] = [{ kind: "gun", cooldown: 0, ammo: 12, reload: 0, stats: { ...cfg.weapons.gun } }, null]
  const pickups = new Map<number, any>((H.pickups ?? []).map((p: any) => [p.id, { ...p }]))
  const cubeMap = new Map<number, number[]>()
  const crates = new Map<number, number[]>((H.crates ?? []).map((c: any) => [c.id, c.pos]))
  const seen = new Map<number, number>() // mech id -> last seen t
  let offer: any = null
  let offerN = 0, picks = 0
  const thresholds = cfg.cubes.upgrade_thresholds as number[]
  const times: number[] = []
  let errors = 0
  const took: string[] = []
  const hist: { t: number; x: number; y: number; cmd: boolean }[] = []
  let worstStuck = 0, stuckStart = -1, outside = 0, dist = 0
  let pendingEvents: any[] = []
  let alive = 16
  let prevT = -1
  let prevHp = -1
  const prevRow = new Map<number, any[]>()
  const origErr = console.error
  console.error = (...a: unknown[]) => {
    errors++
    if (errors < 4) origErr(...a)
  }
  const eyeH = cfg.mech.eye_height
  const visible = (tx: number, ty: number, tz: number, h: number) => {
    const d = Math.hypot(tx - x, ty - y)
    if (d > cfg.vision.range) return false
    if (d > cfg.vision.near_range && Math.abs(wrap(Math.atan2(ty - y, tx - x) - yaw)) > ((cfg.vision.fov_deg / 2) * Math.PI) / 180) return false
    return w.los(x, y, z + eyeH, tx, ty, tz + h / 2) || w.los(x, y, z + eyeH, tx, ty, tz + h)
  }
  const zoneAt = (t: number) => {
    let k = 0
    while (k + 1 < zones.length && t >= zones[k + 1].shrink_end) k++
    const cur = zones[k], nxt = zones[Math.min(k + 1, zones.length - 1)]
    let cx = cur.center[0], cy = cur.center[1], r = cur.radius
    if (t >= nxt.shrink_start && nxt !== cur) {
      const f = Math.min(1, (t - nxt.shrink_start) / Math.max(1e-6, nxt.shrink_end - nxt.shrink_start))
      cx += (nxt.center[0] - cx) * f
      cy += (nxt.center[1] - cy) * f
      r += (nxt.radius - r) * f
    }
    return { center: [cx, cy], radius: r, next_center: nxt.center, next_radius: nxt.radius, shrink_start: nxt.shrink_start, shrink_end: nxt.shrink_end, dps: phases[Math.min(k, phases.length - 1)].dps }
  }
  let ticks = 0
  const maxT = opts.maxT ?? 1e9
  for (const f of M.f) {
    const t = f.t / 20
    if (t > maxT) break
    for (const e of f.ev ?? []) {
      if (e.e === "weapon" && e.op === "take") pickups.delete(e.id)
      if (e.e === "weapon" && e.op === "drop" && e.kind) pickups.set(e.id, { id: e.id, kind: e.kind, pos: e.at ?? [0, 0, 0] })
      if (e.e === "cube" && e.at) cubeMap.set(e.id, e.at)
      if (e.e === "pickup") cubeMap.delete(e.id)
      if (e.e === "crate") crates.delete(e.id)
      if (e.e === "death" && e.id < 16 && e.id !== seat) alive--
    }
    const rec = f.m.find((r: any[]) => r[0] === seat)
    const hp = Math.max(1, Math.min(maxHp, rec ? (rec[6] / Math.max(1, rec[10])) * maxHp : maxHp))
    if (prevHp >= 0 && hp < prevHp - 1) {
      // recorded damage to the seat we replace: attribute it to the nearest other mech
      let by: number | null = null, bd = 1e9, bear: number | null = null
      for (const r of f.m) {
        if (r[0] === seat) continue
        const d = Math.hypot(r[1] - x, r[2] - y)
        if (d < bd) (bd = d), (by = r[0]), (bear = Math.atan2(r[2] - y, r[1] - x))
      }
      pendingEvents.push({ type: "damaged", amount: prevHp - hp, weapon: "gun", bearing: bear, by })
    }
    prevHp = hp
    const zone = zoneAt(t)
    const inZone = Math.hypot(x - zone.center[0], y - zone.center[1]) <= zone.radius
    if (!inZone) outside += 0.1
    const mechs: any[] = []
    const dtf = prevT >= 0 ? Math.max(0.05, t - prevT) : 0.1
    prevT = t
    for (const r of f.m) {
      const pr = prevRow.get(r[0])
      prevRow.set(r[0], r)
      if (r[0] === seat) continue
      const vel = pr ? [(r[1] - pr[1]) / dtf, (r[2] - pr[2]) / dtf, 0] : [0, 0, 0]
      const h = 9 * (1 + 0.05 * r[9])
      if (visible(r[1], r[2], r[3], h)) seen.set(r[0], t)
      if (t - (seen.get(r[0]) ?? -99) <= (cfg.vision.memory_s ?? 5)) {
        const ws = [r[11], r[12]].filter((s: number) => s >= 0).map((s: number) => kinds[s])
        mechs.push({ id: r[0], kind: "mech", pos: [r[1], r[2], r[3]], vel, aim: [r[4], r[5]], hp: r[6], max_hp: r[10], cubes: r[9], weapons: ws, charging: (r[8] & 4) !== 0 })
      }
    }
    for (const n of f.n ?? []) if (visible(n[1], n[2], n[3], 3.5)) mechs.push({ id: n[0], kind: "npc", pos: [n[1], n[2], n[3]], vel: [0, 0, 0], aim: [n[4], 0], hp: n[5], max_hp: 350 })
    const projectiles = (f.p ?? []).filter((p: any[]) => Math.hypot(p[2] - x, p[3] - y) < 120).map((p: any[]) => ({ id: p[0], kind: ["gun", "mortar", "npc"][p[1]] ?? "gun", pos: [p[2], p[3], p[4]], vel: [0, 0, 0] }))
    const obsPickups = [...pickups.values()].filter((p) => visible(p.pos[0], p.pos[1], p.pos[2], 1)).map((p) => ({ id: p.id, kind: p.kind, pos: p.pos }))
    const obsCubes = [...cubeMap.entries()].filter(([, at]) => visible(at[0], at[1], at[2], 1)).map(([id, at]) => ({ id, pos: at }))
    const obsCrates = [...crates.entries()].filter(([, at]) => visible(at[0], at[1], at[2], 2)).map(([id, at]) => ({ id, pos: at, hp: 300 }))
    const drops = (H.drops ?? []).filter((d: any) => t >= d.call_t).map((d: any) => ({ id: d.id, pos: d.pos, radius: d.radius, lands_in: Math.max(0, d.land_t - t), capture_s: 4, progress: 0, holder: null }))
    const obs: Observation = {
      type: "obs", tick: f.t, t, alive,
      self: { id: seat, pos: [x, y, z], vel: [vx, vy, 0], aim: [yaw, pitch], hp, max_hp: maxHp, energy, max_energy: 100, grounded: airZ < z + 0.1, cubes, upgrades: [], weapons: weapons as any, in_zone: inZone, stats: { ...cfg.mech } },
      mechs, projectiles, crates: obsCrates, cubes: obsCubes, pickups: obsPickups, sounds: [], beams: [], events: pendingEvents, zone: zone as any, offer, drops,
    } as any
    pendingEvents = []
    const s0 = performance.now()
    const a: any = brain.act(obs)
    times.push(performance.now() - s0)
    ticks++
    // --- apply the action
    if (offer && a.pick !== undefined) {
      picks++
      offer = null
    }
    if (a.take !== undefined) {
      const p = pickups.get(a.take)
      if (p && Math.hypot(p.pos[0] - x, p.pos[1] - y) <= 4 && Math.abs(p.pos[2] - z) <= 4) {
        const slot = weapons[1] ? (a.drop ?? -1) : 1
        if (slot === 1) {
          weapons[1] = p.kind === "laser" ? { kind: "laser", cooldown: 1.65, charge: 0, stats: { ...cfg.weapons.laser } } : { kind: p.kind, cooldown: 1, stats: { ...cfg.weapons[p.kind as "lightning"] } }
          pickups.delete(p.id)
          took.push(`${p.kind}@${t.toFixed(1)}`)
          pendingEvents.push({ type: "took", id: p.id, kind: p.kind, slot: 1 })
        } else pendingEvents.push({ type: "take_failed", id: a.take, reason: "full" })
      } else pendingEvents.push({ type: "take_failed", id: a.take, reason: p ? "range" : "gone" })
    }
    const g = weapons[0]
    g.cooldown = Math.max(0, g.cooldown - 0.1)
    if (g.reload > 0) {
      g.reload = Math.max(0, g.reload - 0.1)
      if (g.reload === 0) g.ammo = 12
    } else if (a.reload && g.ammo < 12) g.reload = 2.4
    else if (a.fire?.[0] && g.ammo > 0 && g.cooldown <= 0) {
      g.ammo = Math.max(0, g.ammo - (g.ammo > 0 ? 1 : 0))
      g.cooldown = 0.24
    }
    const l = weapons[1]
    let charging = false
    if (l && l.kind === "laser") {
      l.cooldown = Math.max(0, l.cooldown - 0.1)
      if (a.fire?.[1] && l.cooldown <= 0) {
        l.charge = Math.min(2.75, l.charge + 0.1)
        charging = true
        if (l.charge >= 2.75) (l.charge = 0), (l.cooldown = 1.65)
      } else if (l.charge > 0) (l.charge = 0), (l.cooldown = 1.65)
    }
    // aim slew
    const dy = wrap(a.aim[0] - yaw)
    yaw = wrap(yaw + Math.sign(dy) * Math.min(Math.abs(dy), cfg.mech.turn_rate * 0.1))
    pitch += Math.sign(a.aim[1] - pitch) * Math.min(Math.abs(a.aim[1] - pitch), cfg.mech.pitch_rate * 0.1)
    // movement
    const boosting = a.boost && energy > 0
    const sp = (boosting ? cfg.mech.boost_speed : cfg.mech.walk_speed) * (charging ? 0.5 : 1)
    const tvx = a.move[0] * sp, tvy = a.move[1] * sp
    const acc = cfg.mech.ground_accel * 0.1
    const dvx = tvx - vx, dvy = tvy - vy, dl = Math.hypot(dvx, dvy)
    if (dl > acc) (vx += (dvx / dl) * acc), (vy += (dvy / dl) * acc)
    else (vx = tvx), (vy = tvy)
    if (a.jump && a.boost && energy > 5) {
      airZ = Math.max(airZ, z) + 1
      energy -= 1.5
    } else {
      airZ = -1e9
      if (boosting && Math.hypot(vx, vy) > 1) energy = Math.max(0, energy - 1.7)
      else energy = Math.min(100, energy + 1.8)
    }
    const r = cfg.mech.radius
    const tryMove = (nx: number, ny: number) => {
      const sp2 = Math.hypot(nx - x, ny - y)
      const ux = sp2 > 1e-6 ? (nx - x) / sp2 : 0, uy = sp2 > 1e-6 ? (ny - y) / sp2 : 0
      const lead = w.surfaceAt(nx + ux * r, ny + uy * r)
      const here = Math.max(z, airZ)
      return lead - here <= cfg.mech.step_up && w.surfaceAt(nx, ny) - here <= cfg.mech.step_up
    }
    const ox = x, oy = y
    for (let s = 0; s < 4; s++) {
      const nx = x + vx * 0.025, ny = y + vy * 0.025
      if (tryMove(nx, ny)) (x = nx), (y = ny)
      else if (tryMove(nx, y)) (x = nx), (vy *= 0.5)
      else if (tryMove(x, ny)) (y = ny), (vx *= 0.5)
      else (vx = 0), (vy = 0)
    }
    z = w.surfaceAt(x, y)
    dist += Math.hypot(x - ox, y - oy)
    // cubes
    for (const [id, at] of cubeMap) {
      if (Math.hypot(at[0] - x, at[1] - y) <= 3.5 && Math.abs(at[2] - z) < 4) {
        cubeMap.delete(id)
        cubes++
        if (cubes <= 10) maxHp = cfg.mech.hp * (1 + 0.04 * cubes)
        pendingEvents.push({ type: "pickup", cubes })
        if (thresholds.includes(cubes) && !offer) {
          offerN++
          offer = { id: offerN, expires: t + 5, choices: [{ id: "armor", name: "", desc: "" }, { id: "plating", name: "", desc: "" }, { id: "laser_damage", name: "", desc: "" }] }
        }
      }
    }
    // stuck: commanded movement but < 1.5 m of progress over 3 s
    const cmd = Math.hypot(a.move[0], a.move[1]) > 0.5
    hist.push({ t, x, y, cmd })
    while (hist.length && hist[0].t < t - 3) hist.shift()
    const allCmd = hist.every((h) => h.cmd)
    if (allCmd && hist.length >= 29 && Math.hypot(x - hist[0].x, y - hist[0].y) < 1.5) {
      if (stuckStart < 0) stuckStart = hist[0].t
      worstStuck = Math.max(worstStuck, t - stuckStart)
    } else stuckStart = -1
  }
  console.error = origErr
  times.sort((a, b) => a - b)
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] ?? 0
  return { seat, ticks, p50: q(0.5), p99: q(0.99), max: q(1), errors, worstStuckS: worstStuck, outsideZoneS: outside, took, cubes, picks, offers: offerN, dist, final: [Math.round(x), Math.round(y)] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const Ms = loadMatches(process.argv[2] ?? "../internal/research/cast/live.jsonl").filter((m) => m.f.length > 1000)
  const mi = process.argv[3] ?? "0"
  const si = process.argv[4] ?? "all"
  const list = mi === "all" ? Ms : [Ms[Number(mi)]]
  let worst = 0, outsideMax = 0, errs = 0, p99max = 0, maxmax = 0, n = 0, lasers = 0
  for (const M of list) {
    const seats = si === "all" ? Array.from({ length: 16 }, (_, i) => i) : [Number(si)]
    for (const s of seats) {
      const r = simulate(M, s)
      n++
      worst = Math.max(worst, r.worstStuckS)
      outsideMax = Math.max(outsideMax, r.outsideZoneS)
      errs += r.errors
      p99max = Math.max(p99max, r.p99)
      maxmax = Math.max(maxmax, r.max)
      if (r.took.some((k) => k.startsWith("laser"))) lasers++
      console.log(`match ${M.h.seed} seat ${s}: ${r.ticks} ticks p50 ${r.p50.toFixed(2)} p99 ${r.p99.toFixed(2)} max ${r.max.toFixed(1)} ms, stuck ${r.worstStuckS.toFixed(1)} s, outside zone ${r.outsideZoneS.toFixed(1)} s, took ${r.took.join(",") || "-"}, cubes ${r.cubes}, offers ${r.offers}/${r.picks}, walked ${r.dist.toFixed(0)} m, errors ${r.errors}`)
    }
  }
  console.log(`SUMMARY runs ${n}: worst stuck ${worst.toFixed(1)} s, max outside zone ${outsideMax.toFixed(1)} s, laser taken in ${lasers}/${n}, errors ${errs}, worst p99 ${p99max.toFixed(2)} ms, worst max ${maxmax.toFixed(1)} ms`)
}
