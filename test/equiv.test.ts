// With the post-7a3fce0 behaviour flags off, the bot must act exactly as 7a3fce0 (board 4.58) did.
// Golden hash: every action 7a3fce0 returns over the kit stream, numbers rounded to 1e-6.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { Brain } from "../src/brain.ts"
import { PARAMS } from "../src/config.ts"
import { kitStream, ARENA } from "./helpers.ts"

const GOLDEN_7A3FCE0 = "8adf1e16dd1a8ecb01ae1ae16850fa9e2c30f5e0"
const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)

function kitHash(): { n: number; hex: string } {
  const lines = kitStream()
  const hello = lines[0]
  hello.map.dir = ARENA
  const b = new Brain(hello)
  const h = createHash("sha1")
  let n = 0
  for (const o of lines.slice(1)) if (o.type === "obs") (h.update(JSON.stringify(b.act(o), round)), n++)
  return { n, hex: h.digest("hex") }
}

test("flags off (rimHold, idleStay, stalk): actions identical to 7a3fce0 on the kit stream", () => {
  const keep = { r: PARAMS.common.rimHold, i: PARAMS.common.idleStay, s: PARAMS.squad.stalk }
  PARAMS.common.rimHold = false
  PARAMS.common.idleStay = false
  PARAMS.squad.stalk = false
  try {
    const { n, hex } = kitHash()
    assert.equal(n, 300)
    assert.equal(hex, GOLDEN_7A3FCE0)
  } finally {
    PARAMS.common.rimHold = keep.r
    PARAMS.common.idleStay = keep.i
    PARAMS.squad.stalk = keep.s
  }
})
