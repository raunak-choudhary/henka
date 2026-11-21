// Henka entry point: the kit wrapper drives stdin/stdout; all decisions are in Brain.
import { run, type Hello } from "./mechfight.ts"
import { Brain } from "./brain.ts"

run((hello: Hello) => {
  const t0 = performance.now()
  const brain = new Brain(hello)
  console.error(`henka: world ${brain.w.loaded ? "loaded" : "FLAT"} build ${brain.w.buildMs.toFixed(0)} ms, warm-up ${brain.warmMs.toFixed(0)} ms, ready after ${(performance.now() - t0).toFixed(0)} ms`)
  return { name: "henka", act: (obs) => brain.act(obs) }
})
