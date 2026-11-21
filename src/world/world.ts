// World model built once at hello: terrain, prism surface, walk grid, line of sight, paths.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Terrain, type GridSpec } from "./terrain.ts"
import { rasterise, type Prism } from "./solid.ts"
import { NavGrid } from "./navgrid.ts"
import { los } from "./los.ts"
import { Nav } from "./nav.ts"

const DEFAULT_SPEC: GridSpec = { minX: -513, minY: -334, step: 1, nx: 1070, ny: 724 }

export class World {
  spec: GridSpec
  terrain: Terrain
  surf: Float32Array
  grid: NavGrid
  nav: Nav
  loaded: boolean
  buildMs = 0

  constructor(terrain: Terrain, prisms: Prism[], stepUp: number, headroom: number, loaded: boolean) {
    const t0 = performance.now()
    this.spec = terrain.spec
    this.terrain = terrain
    this.surf = rasterise(terrain, prisms, headroom)
    this.grid = new NavGrid(this.spec, this.surf, stepUp)
    this.nav = new Nav(this.grid)
    this.loaded = loaded
    this.buildMs = performance.now() - t0
  }

  /** Load the map from hello.map; on any failure return an open flat field. */
  static load(dir: string, files: string[], stepUp = 1.2, headroom = 9): World {
    try {
      const wf = files.find((f) => f.endsWith("world.json")) ?? "v2/world.json"
      const w = JSON.parse(readFileSync(join(dir, wf), "utf8"))
      const t = w.terrain ?? {}
      const spec: GridSpec = { minX: t.minX ?? -513, minY: t.minY ?? -334, step: t.step ?? 1, nx: t.nx ?? 1070, ny: t.ny ?? 724 }
      const tf = files.find((f) => f.endsWith(".i16")) ?? join(wf, "..", t.file ?? "terrain.i16")
      const bytes = readFileSync(join(dir, tf))
      const terrain = Terrain.fromBytes(spec, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), t.scale ?? 0.01)
      return new World(terrain, Array.isArray(w.prisms) ? w.prisms : [], stepUp, headroom, true)
    } catch (e) {
      console.error("map load failed, playing on open ground:", e)
      return new World(Terrain.flat(DEFAULT_SPEC), [], stepUp, headroom, false)
    }
  }

  ground(x: number, y: number): number {
    return this.terrain.heightAt(x, y)
  }
  surfaceAt(x: number, y: number): number {
    const { minX, minY, nx, ny } = this.spec
    let i = Math.round(x - minX), j = Math.round(y - minY)
    if (i < 0) i = 0
    if (j < 0) j = 0
    if (i >= nx) i = nx - 1
    if (j >= ny) j = ny - 1
    return this.surf[j * nx + i]
  }
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return los(this.spec, this.surf, ax, ay, az, bx, by, bz)
  }
}
