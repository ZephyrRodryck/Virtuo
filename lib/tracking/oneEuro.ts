// One Euro filter (Casiez et al. 2012): low lag when moving fast, low jitter when still.
export class OneEuro {
  private x = NaN;
  private dx = 0;
  private t = 0;

  constructor(private minCutoff = 1.2, private beta = 0.02, private dCutoff = 1) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timeMs: number): number {
    if (Number.isNaN(this.x)) {
      this.x = value;
      this.t = timeMs;
      return value;
    }
    const dt = Math.max(1e-3, (timeMs - this.t) / 1000);
    this.t = timeMs;
    const dxRaw = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = NaN;
    this.dx = 0;
  }
}
