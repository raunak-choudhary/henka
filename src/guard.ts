// Deadline guard: wall-clock is used only here.
export class Guard {
  limitMs: number
  private t0 = 0
  constructor(limitMs = 30) {
    this.limitMs = limitMs
  }
  start() {
    this.t0 = performance.now()
  }
  elapsed(): number {
    return performance.now() - this.t0
  }
  /** True when the remaining optional stages must be skipped. */
  over(): boolean {
    return performance.now() - this.t0 > this.limitMs
  }
}
