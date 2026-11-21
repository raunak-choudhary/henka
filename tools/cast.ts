// Loader for recorded matches (mechreplay/1 as captured from the public cast).
import { readFileSync } from "node:fs"

export type Match = { h: any; f: any[]; r: any | null }

export function loadMatches(path: string): Match[] {
  const out: Match[] = []
  let cur: Match | null = null
  const text = readFileSync(path, "utf8")
  for (const raw of text.split("\n")) {
    const l = raw.trim()
    if (!l) continue
    let parts: string[]
    if (l.startsWith('{"at"')) {
      try {
        parts = String(JSON.parse(l).d ?? "").split("\n")
      } catch {
        continue
      }
    } else parts = [l]
    for (const x of parts) {
      if (!x) continue
      let o: any
      try {
        o = JSON.parse(x)
      } catch {
        continue
      }
      if (o.type === "header") {
        cur = { h: o, f: [], r: null }
        out.push(cur)
      } else if (o.type === "result" && cur) cur.r = o
      else if (o.type === undefined && cur && o.m) cur.f.push(o)
    }
  }
  return out
}
