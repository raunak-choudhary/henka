import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { World } from "../src/world/world.ts"
export const KIT = new URL("../../internal/research/kits/mech/mechfight-kit/", import.meta.url).pathname
export const ARENA = KIT + "arena"
let w: World | null = null
export const world = () => (w ??= World.load(ARENA, ["v2/world.json", "v2/terrain.i16"]))
export const worldJson = () => JSON.parse(readFileSync(ARENA + "/v2/world.json", "utf8"))
export const kitStream = () => gunzipSync(readFileSync(KIT + "check/stream.jsonl.gz")).toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
