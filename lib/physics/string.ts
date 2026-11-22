// Physics of an ideal stretched string, shared by the site visuals and the instrument.

/** Linear mass density used for new strings (kg/m) — roughly a wound steel string. */
export const DEFAULT_MU = 0.0055;
/** EA/T: axial stiffness relative to tension. Sets how strongly a sideways pull raises pitch. */
export const STRETCH_RATIO = 140;

/** Mersenne's law: f₀ = (1 / 2L) · √(T / μ). */
export function fundamental(L: number, T: number, mu: number): number {
  return Math.sqrt(T / mu) / (2 * L);
}

/** Tension needed for a string of length L and density μ to sound at f. */
export function tensionFor(f: number, L: number, mu: number): number {
  return mu * (2 * L * f) ** 2;
}

/** Wave speed c = √(T / μ). */
export function waveSpeed(T: number, mu: number): number {
  return Math.sqrt(T / mu);
}

/**
 * Tension after pulling the string sideways by d (m) at fraction u of its length.
 * The string is stretched to L' = √((uL)² + d²) + √(((1-u)L)² + d²), and Hooke's law gives
 * T' = T + EA·(L' − L)/L.
 */
export function bentTension(T: number, L: number, u: number, d: number): number {
  const stretched = Math.hypot(u * L, d) + Math.hypot((1 - u) * L, d);
  return T * (1 + STRETCH_RATIO * (stretched - L) / L);
}

/**
 * Modal amplitudes of a string plucked into a triangle of unit height at position p:
 * Aₙ = 2 sin(nπp) / (n²π² p(1−p)). A pluck at a node of mode n leaves that mode silent.
 */
export function modeAmplitudes(p: number, count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n++) {
    out.push((2 * Math.sin(n * Math.PI * p)) / (n * n * Math.PI * Math.PI * p * (1 - p)));
  }
  return out;
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function midiOf(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

export function freqOfMidi(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

/** Note name with octave and the deviation in cents, e.g. { name: 'A4', cents: -3 }. */
export function noteOf(f: number): { name: string; cents: number } {
  const m = midiOf(f);
  const r = Math.round(m);
  return { name: NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents: Math.round((m - r) * 100) };
}

export function snapToSemitone(f: number): number {
  return freqOfMidi(Math.round(midiOf(f)));
}

/**
 * Finite-difference string for visual-rate simulation (fixed ends):
 * y[i]ⁿ⁺¹ = (2y[i]ⁿ − y[i]ⁿ⁻¹ + r²(y[i+1]ⁿ − 2y[i]ⁿ + y[i−1]ⁿ)) · (1 − γΔt), r = cΔt/Δx.
 * Buffers are preallocated; `step` sub-steps to keep the Courant number below 0.9.
 */
export class FDString {
  readonly n: number;
  y: Float32Array;
  prev: Float32Array;
  private next: Float32Array;

  constructor(n = 96) {
    this.n = n;
    this.y = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
  }

  /** Adds a displacement bump with zero initial velocity at u ∈ [0, 1]. */
  excite(u: number, amp: number, width = 0.07) {
    const n = this.n;
    for (let i = 1; i < n - 1; i++) {
      const d = (i / (n - 1) - u) / width;
      const v = amp * Math.exp(-d * d) * Math.sin((Math.PI * i) / (n - 1));
      this.y[i] += v;
      this.prev[i] += v;
    }
  }

  /** speed in string-lengths per second; damping γ in 1/s. */
  step(dt: number, speed: number, damping: number) {
    const n = this.n;
    const dx = 1 / (n - 1);
    const sub = Math.max(1, Math.ceil((speed * dt) / dx / 0.9));
    const h = dt / sub;
    const r2 = ((speed * h) / dx) ** 2;
    const damp = 1 - damping * h;
    for (let s = 0; s < sub; s++) {
      const { y, prev, next } = this;
      for (let i = 1; i < n - 1; i++) {
        next[i] = (2 * y[i] - prev[i] + r2 * (y[i + 1] - 2 * y[i] + y[i - 1])) * damp;
      }
      this.prev = y;
      this.y = next;
      this.next = prev;
    }
  }

  damp(factor: number) {
    for (let i = 0; i < this.n; i++) {
      this.y[i] *= factor;
      this.prev[i] *= factor;
    }
  }

  /** Linear interpolation of displacement at u ∈ [0, 1]. */
  at(u: number): number {
    const x = Math.min(0.999999, Math.max(0, u)) * (this.n - 1);
    const i = Math.floor(x);
    return this.y[i] + (this.y[i + 1] - this.y[i]) * (x - i);
  }

  peak(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.y[i]));
    return m;
  }
}
