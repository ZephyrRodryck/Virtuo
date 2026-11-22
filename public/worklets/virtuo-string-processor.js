// VIRTUO string voices: bidirectional digital waveguide (d'Alembert solution of
// the 1-D wave equation y_tt = c² y_xx) running at audio rate.
// Displacement y(x) = R(x) + L(x): a right-going wave R (nut → bridge) and a
// left-going wave L (bridge → nut), with inverting reflections at both fixed ends
// and a frequency-dependent loss filter at the bridge.
// The same delay-line state is sampled to draw the string on screen.

const SIZE = 8192; // power of two; supports fundamentals down to ~6 Hz at 48 kHz
const MASK = SIZE - 1;
export const SHAPE_POINTS = 33;

function readFrac(buf, idx) {
  const i0 = Math.floor(idx);
  const f = idx - i0;
  return buf[i0 & MASK] * (1 - f) + buf[(i0 + 1) & MASK] * f;
}

export class WaveguideString {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.R = new Float32Array(SIZE);
    this.L = new Float32Array(SIZE);
    this.w = 0; // index of the newest written sample
    this.lp = 0;
    this.dcX = 0;
    this.dcY = 0;
    this.freq = 220;
    this.t60 = 3; // seconds for -60 dB
    this.brightness = 0.7; // one-pole loss filter coefficient (1 = no high-frequency loss)
    this.muted = false;
    this.pickup = 0.82;
    this.panL = Math.SQRT1_2;
    this.panR = Math.SQRT1_2;
    this.sleeping = true;
    this.quiet = 0;
    this.env = new Float32Array(SHAPE_POINTS);
    this.setFrequency(220, true);
  }

  loopDelay(freq) {
    const a = this.muted ? 0.25 : this.brightness;
    // Round-trip delay = 2(M + 1) (read-before-write adds one sample per line)
    // + group delay of the one-pole loss filter at DC ((1-a)/a).
    return Math.max(2, (this.sr / freq - (1 - a) / a) / 2 - 1);
  }

  setFrequency(freq, immediate = false) {
    this.freq = Math.min(4000, Math.max(20, freq));
    this.targetM = Math.min(SIZE / 2 - 4, this.loopDelay(this.freq));
    if (immediate || this.M === undefined) this.M = this.targetM;
  }

  setDamping(t60) {
    this.t60 = Math.max(0.05, t60);
  }

  setMuted(muted) {
    this.muted = muted;
    this.setFrequency(this.freq);
  }

  setPan(pan) {
    const p = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
    this.panL = Math.cos(p);
    this.panR = Math.sin(p);
  }

  // Displacement at normalised position x (0 = nut, 1 = bridge).
  displacement(x) {
    const k = x * this.M;
    return readFrac(this.R, this.w - k) + readFrac(this.L, this.w - (this.M - k));
  }

  // Adds a triangular displacement (zero initial velocity) peaking at `pos`.
  // The shape is split equally between the two travelling waves.
  pluck(pos, amp) {
    const M = this.M;
    const p = Math.min(0.97, Math.max(0.03, pos));
    const n = Math.floor(M);
    for (let k = 1; k < n; k++) {
      const x = k / M;
      const s = (x < p ? x / p : (1 - x) / (1 - p)) * amp * 0.5;
      this.R[(this.w - k) & MASK] += s;
      this.L[(this.w - Math.round(M - k)) & MASK] += s;
    }
    this.sleeping = false;
    this.quiet = 0;
  }

  render(outL, outR, n) {
    if (this.sleeping) return;
    const loss = Math.pow(10, -3 / (this.freq * (this.muted ? 0.07 : this.t60)));
    const a = this.muted ? 0.25 : this.brightness;
    const glide = 1 - Math.exp(-1 / (0.012 * this.sr));
    const R = this.R, L = this.L;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      this.M += (this.targetM - this.M) * glide;
      const M = this.M;
      const atBridge = readFrac(R, this.w - M);
      const atNut = readFrac(L, this.w - M);
      this.lp += a * (atBridge - this.lp);
      this.w = (this.w + 1) & MASK;
      L[this.w] = -loss * this.lp;
      R[this.w] = -atNut;

      const kp = this.pickup * M;
      const y = readFrac(R, this.w - kp) + readFrac(L, this.w - (M - kp));
      const out = y - this.dcX + 0.995 * this.dcY; // DC blocker
      this.dcX = y;
      this.dcY = out;
      outL[i] += out * this.panL;
      outR[i] += out * this.panR;
      const ay = out < 0 ? -out : out;
      if (ay > peak) peak = ay;
    }
    // Sleep once the string has decayed below audibility for ~0.25 s.
    if (peak < 1e-5) {
      this.quiet += n;
      if (this.quiet > this.sr * 0.25) {
        this.sleeping = true;
        this.R.fill(0);
        this.L.fill(0);
        this.lp = 0;
        this.env.fill(0);
      }
    } else {
      this.quiet = 0;
    }
  }

  // Instantaneous shape + decaying peak envelope at SHAPE_POINTS positions.
  sampleShape(out, offset, envDecay) {
    for (let j = 0; j < SHAPE_POINTS; j++) {
      const y = this.sleeping ? 0 : this.displacement(j / (SHAPE_POINTS - 1));
      const ay = Math.abs(y);
      this.env[j] = Math.max(this.env[j] * envDecay, ay);
      out[offset + j] = y;
      out[offset + SHAPE_POINTS + j] = this.env[j];
    }
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class VirtuoStringProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.voices = new Map();
      this.pending = [];
      this.master = 0.8;
      this.block = 0;
      this.postEvery = Math.max(1, Math.round(sampleRate / 128 / 60));
      this.port.onmessage = e => this.handle(e.data);
    }

    voice(id) {
      let v = this.voices.get(id);
      if (!v) {
        v = new WaveguideString(sampleRate);
        this.voices.set(id, v);
      }
      return v;
    }

    apply(msg) {
      const v = this.voice(msg.id);
      if (msg.freq !== undefined) v.setFrequency(msg.freq, msg.immediate);
      if (msg.t60 !== undefined) v.setDamping(msg.t60);
      if (msg.brightness !== undefined) v.brightness = Math.min(1, Math.max(0.05, msg.brightness));
      if (msg.pan !== undefined) v.setPan(msg.pan);
      if (msg.muted !== undefined && msg.muted !== v.muted) v.setMuted(msg.muted);
    }

    handle(msg) {
      switch (msg.type) {
        case 'set':
          this.apply(msg);
          break;
        case 'pluck':
          if (msg.when && msg.when > currentTime) this.pending.push(msg);
          else this.voice(msg.id).pluck(msg.pos, msg.amp);
          break;
        case 'remove':
          this.voices.delete(msg.id);
          break;
        case 'clear':
          this.voices.clear();
          this.pending.length = 0;
          break;
        case 'master':
          this.master = msg.gain;
          break;
      }
    }

    process(_inputs, outputs) {
      const out = outputs[0];
      const outL = out[0];
      const outR = out[1] || out[0];
      const n = outL.length;

      if (this.pending.length) {
        this.pending = this.pending.filter(m => {
          if (m.when > currentTime) return true;
          this.voice(m.id).pluck(m.pos, m.amp);
          return false;
        });
      }

      for (const v of this.voices.values()) v.render(outL, outR, n);
      const g = this.master;
      for (let i = 0; i < n; i++) {
        outL[i] = Math.tanh(outL[i] * g);
        if (outR !== outL) outR[i] = Math.tanh(outR[i] * g);
      }

      if (++this.block % this.postEvery === 0 && this.voices.size) {
        const ids = [];
        const data = new Float32Array(this.voices.size * SHAPE_POINTS * 2);
        let i = 0;
        for (const [id, v] of this.voices) {
          ids.push(id);
          v.sampleShape(data, i * SHAPE_POINTS * 2, 0.9);
          i++;
        }
        this.port.postMessage({ type: 'shapes', ids, data }, [data.buffer]);
      }
      return true;
    }
  }
  registerProcessor('virtuo-string', VirtuoStringProcessor);
}
