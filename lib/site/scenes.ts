// Scenes for the landing-page stage. Each scene places the same six strands (polylines of
// POINTS samples, in viewport px) according to the mathematics of its section, anchored to
// DOM elements so the geometry stays connected to the content as it scrolls.
import { clamp, lerp, smoothstep, splineAt, type Vec } from '../geometry';
import { DEFAULT_MU, bentTension, fundamental, modeAmplitudes, noteOf, snapToSemitone } from '../physics/string';
import { site } from './store';

export const STRANDS = 6;
export const POINTS = 96;

export interface Box { x: number; y: number; w: number; h: number }

export interface Strand {
  pts: Float32Array; // x0,y0,x1,y1,…
  alpha: number;
  u0: number; // visible parameter range
  u1: number;
  freq: number; // pitch when plucked (Hz)
  width: number;
}

export interface SceneInput {
  t: number; // performance.now() in seconds — the clock shared with section controls
  age: number; // seconds since the stage mounted
  anim: number; // time for decorative motion (frozen under reduced motion)
  dt: number;
  w: number;
  h: number;
  rect: Box; // section rect in viewport px
  a: Record<string, Box>; // anchors inside the section
  progress: number; // 0 when the section enters at the bottom, 1 when it leaves at the top
  reduced: boolean;
}

export interface StageApi {
  excite(i: number, u: number, amp: number): void;
  damp(i: number, factor: number): void;
  setActive(anchor: string, on: boolean): void;
  readout(name: string, text: string): void;
  bars(name: string, values: ArrayLike<number>): void;
  playNote(i: number, u: number, amp: number, delay?: number): void;
}

export interface Scene {
  id: string;
  anchors: string[];
  compute(inp: SceneInput, out: Strand[]): void;
  update?(inp: SceneInput, api: StageApi): void;
  overlay?(ctx: CanvasRenderingContext2D, inp: SceneInput, out: Strand[]): void;
}

const MONO = '10px "JetBrains Mono", ui-monospace, monospace';
const TAU = Math.PI * 2;
const center = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const ppm = (w: number) => w / 1.2; // the viewport width represents 1.2 m

function setLine(s: Strand, x0: number, y0: number, x1: number, y1: number, off?: (u: number) => number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (let j = 0; j < POINTS; j++) {
    const u = j / (POINTS - 1);
    const o = off ? off(u) : 0;
    s.pts[2 * j] = x0 + dx * u + nx * o;
    s.pts[2 * j + 1] = y0 + dy * u + ny * o;
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha = 0.7, align: CanvasTextAlign = 'left') {
  ctx.font = MONO;
  ctx.textAlign = align;
  ctx.fillStyle = `rgba(170,170,215,${alpha})`;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- 01 hero
const HERO_T = 120;
let heroPlucked = false;

const hero: Scene = {
  id: 'hero',
  anchors: ['hero-string'],
  compute(inp, out) {
    const b = inp.a['hero-string'];
    if (!b) return;
    const y = b.y + b.h / 2;
    const intro = 1 - (1 - clamp((inp.age - 0.3) / 1.6, 0, 1)) ** 3;
    const breathe = inp.reduced ? 0 : 1.2 * Math.sin(inp.anim * 1.6);
    const f = fundamental(b.w / ppm(inp.w), HERO_T, DEFAULT_MU);
    out.forEach((s, i) => {
      setLine(s, b.x, y, b.x + b.w, y, u => breathe * Math.sin(Math.PI * u));
      s.alpha = i === 0 ? 1 : 0;
      s.u0 = 0.5 - intro / 2;
      s.u1 = 0.5 + intro / 2;
      s.freq = f;
      s.width = 1.5;
    });
  },
  update(inp, api) {
    const b = inp.a['hero-string'];
    if (!b) return;
    const L = b.w / ppm(inp.w);
    const f = fundamental(L, HERO_T, DEFAULT_MU);
    api.readout('hero', `L = ${L.toFixed(2)} m   T = ${HERO_T} N   μ = 5.5 g/m   →   f₀ = ${f.toFixed(1)} Hz  (${noteOf(f).name})`);
    if (!heroPlucked && inp.age > 2 && !inp.reduced) {
      heroPlucked = true;
      api.excite(0, 0.28, 16);
    }
  },
  overlay(ctx, inp, out) {
    const s = out[0];
    if (s.u1 - s.u0 < 0.99) return;
    const n = POINTS - 1;
    for (const j of [0, n]) {
      ctx.beginPath();
      ctx.arc(s.pts[2 * j], s.pts[2 * j + 1], 3, 0, TAU);
      ctx.fillStyle = '#9b9bff';
      ctx.fill();
    }
  },
};

// ---------------------------------------------------------------- 02 concept
// One thread runs through the four stages. Past "strings" it splits into six strands,
// past "motion" it vibrates as a standing wave, past "sound" it becomes a travelling wave.
const conceptNodes = ['concept-0', 'concept-1', 'concept-2', 'concept-3'];
const conceptPath: Vec[] = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }));
const tmpA = { x: 0, y: 0 }, tmpB = { x: 0, y: 0 }, tmpC = { x: 0, y: 0 };
const conceptReveal = (p: number) => clamp((p - 0.2) / 0.38, 0, 1);

const concept: Scene = {
  id: 'concept',
  anchors: conceptNodes,
  compute(inp, out) {
    if (!conceptNodes.every(n => inp.a[n])) return;
    const nodes = conceptNodes.map(n => center(inp.a[n]));
    conceptPath[0].x = -20;
    conceptPath[0].y = nodes[0].y;
    nodes.forEach((n, k) => {
      conceptPath[k + 1].x = n.x;
      conceptPath[k + 1].y = n.y;
    });
    conceptPath[5].x = inp.w + 20;
    conceptPath[5].y = nodes[3].y;
    const reveal = conceptReveal(inp.progress);
    const t = inp.anim;
    out.forEach((s, i) => {
      for (let j = 0; j < POINTS; j++) {
        const u = j / (POINTS - 1);
        splineAt(conceptPath, u, tmpA);
        splineAt(conceptPath, Math.min(1, u + 0.003), tmpB);
        splineAt(conceptPath, Math.max(0, u - 0.003), tmpC);
        const tx = tmpB.x - tmpC.x, ty = tmpB.y - tmpC.y;
        const tl = Math.hypot(tx, ty) || 1;
        const split = smoothstep(0.38, 0.47, u);
        const motion = smoothstep(0.57, 0.66, u);
        const sound = smoothstep(0.78, 0.87, u);
        const standing = Math.sin((Math.PI * (u - 0.6)) / 0.1) * Math.cos(t * 2.6 + i * 0.7) * 10;
        const travelling = Math.sin(TAU * (u * 10) - t * 4 + i * 0.55) * 16 * ((u - 0.8) / 0.2);
        const o = split * (i - 2.5) * 7 + motion * (1 - sound) * standing + sound * travelling;
        s.pts[2 * j] = tmpA.x + (-ty / tl) * o;
        s.pts[2 * j + 1] = tmpA.y + (tx / tl) * o;
      }
      s.alpha = 0.9 - i * 0.09;
      s.u0 = 0;
      s.u1 = reveal;
      s.freq = 110 * (i + 1);
      s.width = i === 0 ? 1.5 : 1;
    });
  },
  update(inp, api) {
    const r = conceptReveal(inp.progress);
    conceptNodes.forEach((n, k) => api.setActive(n, r >= (k + 1) / 5 - 0.01));
  },
};

// ---------------------------------------------------------------- 03 physics
// The plucked string is the sum of its normal modes yₙ = Aₙ sin(nπx/L) cos(2πnf₀t) e^{-t·6.9/T60};
// scrolling separates the composite into its first four modes.
const physics: Scene = {
  id: 'physics',
  anchors: ['physics-box'],
  compute(inp, out) {
    const b = inp.a['physics-box'];
    if (!b) return;
    const P = site.physics;
    const f0 = fundamental(P.L, P.T, P.mu);
    const A = modeAmplitudes(P.pluckPos, 10);
    const since = inp.t - P.pluckedAt;
    const env = inp.reduced ? 1 : Math.max(0.35, Math.exp((-since * 6.9) / P.t60));
    const tt = inp.reduced ? 0 : since;
    const fv = 0.45 * Math.sqrt(f0 / 110); // slow-motion visual frequency
    const sep = smoothstep(0.3, 0.52, inp.progress);
    const narrow = b.w < 600; // labels move above the lines instead of to their right
    const x0 = b.x + b.w * 0.05, x1 = b.x + b.w * (narrow ? 0.95 : 0.85);
    const amp = b.h * 0.11;
    const yc = b.y + b.h * 0.2;
    out.forEach((s, i) => {
      const n = i;
      const base = i === 0 || i === 5 ? yc : lerp(yc, b.y + b.h * (0.42 + (n - 1) * 0.165), sep);
      setLine(s, x0, base, x1, base, u => {
        if (i === 0 || i === 5) {
          let y = 0;
          for (let k = 1; k <= 10; k++) y += A[k - 1] * Math.sin(k * Math.PI * u) * Math.cos(TAU * k * fv * tt);
          return -y * amp * env;
        }
        return -A[n - 1] * Math.sin(n * Math.PI * u) * Math.cos(TAU * n * fv * tt) * amp * env;
      });
      s.alpha = i === 0 ? 1 : i === 5 ? 0 : 0.2 + 0.7 * sep;
      s.u0 = 0;
      s.u1 = 1;
      s.freq = f0 * Math.max(1, n);
      s.width = i === 0 ? 1.6 : 1.1;
    });
  },
  update(inp) {
    if (!inp.reduced && inp.t - site.physics.pluckedAt > 7) site.physics.pluckedAt = inp.t;
  },
  overlay(ctx, inp, out) {
    const b = inp.a['physics-box'];
    if (!b) return;
    const P = site.physics;
    const f0 = fundamental(P.L, P.T, P.mu);
    const A = modeAmplitudes(P.pluckPos, 4);
    const sep = smoothstep(0.3, 0.52, inp.progress);
    const narrow = b.w < 600; // labels move above the lines instead of to their right
    const x0 = b.x + b.w * 0.05, x1 = b.x + b.w * (narrow ? 0.95 : 0.85);
    const px = lerp(x0, x1, P.pluckPos);
    const yc = b.y + b.h * 0.2;
    ctx.strokeStyle = 'rgba(155,155,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(px, yc - b.h * 0.15);
    ctx.lineTo(px, yc - b.h * 0.12);
    ctx.stroke();
    label(ctx, `pluck at x = ${P.pluckPos.toFixed(2)}L`, px + 6, yc - b.h * 0.12, 0.75);
    const at = (y: number): [number, number] => (narrow ? [x0, y - b.h * 0.05] : [x1 + 12, y + 3]);
    label(ctx, `y(x,t)  f₀ = ${f0.toFixed(1)} Hz`, ...(narrow ? ([x0, yc + b.h * 0.09] as [number, number]) : at(yc)), 0.85);
    for (let n = 1; n <= 4; n++) {
      const s = out[n];
      const y = s.pts[1];
      label(ctx, `n=${n}  ${(f0 * n).toFixed(0)} Hz  A=${A[n - 1].toFixed(2)}`, ...at(y), 0.15 + 0.7 * sep);
      // Nodes of mode n: sin(nπx/L) = 0.
      ctx.fillStyle = `rgba(255,176,122,${0.7 * sep})`;
      for (let k = 1; k < n; k++) ctx.fillRect(lerp(x0, x1, k / n) - 1.5, y - 1.5, 3, 3);
    }
  },
};

// ---------------------------------------------------------------- 04 gestures (pinned)
export const GESTURES = ['pinch', 'pluck', 'slide', 'strum', 'bend', 'tremolo', 'mute'] as const;
const CYCLE = 2.8;
const gestureState = { spread: 0, prevTau: 0, prevY: 0, step: -1, trail: [] as Vec[] };

function gestureStep() {
  return Math.min(GESTURES.length - 1, Math.floor(site.gesture.progress * GESTURES.length * 0.999));
}

/** Demonstration fingertip (and thumb / palm) for step k at cycle phase τ. */
function finger(k: number, tau: number, b: Box, t: number) {
  const x0 = b.x + b.w * 0.1, x1 = b.x + b.w * 0.9, yc = b.y + b.h * 0.5;
  const at = (u: number) => lerp(x0, x1, u);
  switch (GESTURES[k]) {
    case 'pinch': {
      const close = smoothstep(0.08, 0.38, tau);
      const draw = smoothstep(0.42, 0.8, tau);
      const px = lerp(x0, x1, draw);
      const gap = lerp(52, 5, close);
      return { tip: { x: px + gap * 0.5, y: yc - gap * 0.35 }, thumb: { x: px - gap * 0.5, y: yc + gap * 0.35 }, pinched: close > 0.95 };
    }
    case 'pluck': {
      const y = lerp(yc - b.h * 0.3, yc + b.h * 0.3, smoothstep(0.15, 0.5, tau));
      return { tip: { x: at(0.3) + (tau - 0.3) * 40, y } };
    }
    case 'slide': {
      const u = 0.12 + 0.5 * (0.5 - 0.5 * Math.cos(TAU * tau));
      return { tip: { x: at(u), y: yc }, thumb: { x: at(u) - 4, y: yc + 4 }, pinched: true, u };
    }
    case 'strum': {
      const y = lerp(yc - b.h * 0.38, yc + b.h * 0.38, smoothstep(0.2, 0.55, tau));
      return { tip: { x: at(0.68) - (y - yc) * 0.15, y } };
    }
    case 'bend': {
      const bend = smoothstep(0.2, 0.5, tau) * (1 - smoothstep(0.75, 0.95, tau));
      return { tip: { x: at(0.45), y: yc - bend * b.h * 0.18 }, thumb: { x: at(0.45) - 4, y: yc - bend * b.h * 0.18 + 4 }, pinched: true, bend };
    }
    case 'tremolo': {
      const on = smoothstep(0.1, 0.2, tau) * (1 - smoothstep(0.8, 0.9, tau));
      return { tip: { x: at(0.62), y: yc + Math.sin(TAU * 7 * t) * b.h * 0.09 * on - (1 - on) * b.h * 0.2 } };
    }
    default: {
      const down = smoothstep(0.35, 0.5, tau) * (1 - smoothstep(0.85, 0.98, tau));
      return { tip: { x: at(0.55), y: lerp(yc - b.h * 0.32, yc, down) }, palm: true, down };
    }
  }
}

const gesture: Scene = {
  id: 'gesture',
  anchors: ['gesture-box'],
  compute(inp, out) {
    const b = inp.a['gesture-box'];
    if (!b) return;
    const k = gestureStep();
    const tau = ((inp.reduced ? 1.4 : inp.anim) % CYCLE) / CYCLE;
    const f = finger(k, tau, b, inp.anim);
    const x0 = b.x + b.w * 0.1, x1 = b.x + b.w * 0.9, yc = b.y + b.h * 0.5;
    const spread = gestureState.spread;
    out.forEach((s, i) => {
      const y = yc + (i - 2.5) * b.h * 0.12 * spread;
      if (i === 0 && GESTURES[k] === 'bend') {
        const uc = 0.45, d = (f.bend ?? 0) * b.h * 0.18;
        setLine(s, x0, y, x1, y, u => (u < uc ? u / uc : (1 - u) / (1 - uc)) * d);
      } else setLine(s, x0, y, x1, y);
      s.alpha = i === 0 ? 1 : spread * 0.9;
      s.u0 = GESTURES[k] === 'slide' && i === 0 ? f.u ?? 0 : 0;
      s.u1 = GESTURES[k] === 'pinch' && i === 0 ? Math.max(0.001, smoothstep(0.42, 0.8, tau)) : 1;
      s.freq = 110 * [1, 1.335, 1.782, 2.378, 2.997, 4][i];
      s.width = 1.5;
    });
  },
  update(inp, api) {
    const b = inp.a['gesture-box'];
    if (!b) return;
    const g = gestureState;
    const k = gestureStep();
    if (k !== g.step) {
      g.step = k;
      g.trail.length = 0;
    }
    g.spread += ((GESTURES[k] === 'strum' ? 1 : 0) - g.spread) * (1 - Math.exp(-inp.dt * 6));
    if (inp.reduced) return;
    const tau = (inp.anim % CYCLE) / CYCLE;
    const f = finger(k, tau, b, inp.anim);
    const yc = b.y + b.h * 0.5;
    const crossed = (th: number) => (g.prevTau < th && tau >= th) || (g.prevTau > tau && tau >= th);
    switch (GESTURES[k]) {
      case 'pinch':
        if (crossed(0.82)) { api.excite(0, 0.5, 9); api.playNote(0, 0.5, 0.35); }
        break;
      case 'pluck':
        if (crossed(0.33)) { api.excite(0, 0.3, 18); api.playNote(0, 0.3, 0.7); }
        break;
      case 'slide':
        if (crossed(0.02) || crossed(0.5)) api.excite(0, Math.min(0.95, (f.u ?? 0) + 0.2), 9);
        break;
      case 'strum':
        for (let i = 0; i < STRANDS; i++) {
          const y = yc + (i - 2.5) * b.h * 0.12 * g.spread;
          if ((g.prevY - y) * (f.tip.y - y) < 0) { api.excite(i, 0.68, 11); api.playNote(i, 0.68, 0.45); }
        }
        break;
      case 'bend':
        if (crossed(0.08)) { api.excite(0, 0.7, 10); api.playNote(0, 0.7, 0.5); }
        break;
      case 'tremolo':
        if ((g.prevY - yc) * (f.tip.y - yc) < 0) { api.excite(0, 0.62, 6 * Math.sign(f.tip.y - g.prevY)); api.playNote(0, 0.62, 0.25); }
        break;
      case 'mute':
        if (crossed(0.04)) { api.excite(0, 0.3, 16); api.playNote(0, 0.3, 0.6); }
        if ((f.down ?? 0) > 0.9) api.damp(0, 0.82);
        break;
    }
    g.trail.push({ ...f.tip });
    if (g.trail.length > 18) g.trail.shift();
    g.prevTau = tau;
    g.prevY = f.tip.y;
  },
  overlay(ctx, inp) {
    const b = inp.a['gesture-box'];
    if (!b) return;
    const k = gestureStep();
    const tau = ((inp.reduced ? 1.4 : inp.anim) % CYCLE) / CYCLE;
    const f = finger(k, tau, b, inp.anim);
    const tr = gestureState.trail;
    for (let i = 1; i < tr.length; i++) {
      ctx.strokeStyle = `rgba(155,155,255,${(i / tr.length) * 0.55})`;
      ctx.lineWidth = 1 + (i / tr.length) * 1.5;
      ctx.beginPath();
      ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#e2e2f0';
    ctx.lineWidth = 1;
    const ring = (p: Vec, r: number) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r - 4, p.y); ctx.lineTo(p.x - r + 2, p.y);
      ctx.moveTo(p.x + r - 2, p.y); ctx.lineTo(p.x + r + 4, p.y);
      ctx.stroke();
    };
    if (f.palm) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = (f.down ?? 0) > 0.9 ? 'rgba(255,176,122,0.9)' : 'rgba(255,176,122,0.45)';
      ctx.beginPath();
      ctx.arc(f.tip.x, f.tip.y, b.h * 0.12, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else ring(f.tip, 7);
    if (f.thumb) {
      ctx.strokeStyle = '#e2e2f0';
      ring(f.thumb, 5);
      ctx.strokeStyle = f.pinched ? '#9b9bff' : 'rgba(155,155,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(f.thumb.x, f.thumb.y);
      ctx.lineTo(f.tip.x, f.tip.y);
      ctx.stroke();
    }
    const f0 = 110;
    const bendD = ((f.bend ?? 0) * b.h * 0.18) / ppm(inp.w);
    const bendCents = Math.round(600 * Math.log2(bentTension(72, 0.65, 0.45, bendD) / 72));
    const notes: Record<string, () => string> = {
      pinch: () => `d/s = ${(Math.hypot(f.tip.x - f.thumb!.x, f.tip.y - f.thumb!.y) / 70).toFixed(2)}  ${f.pinched ? '< 0.41 → pinch · drawing string' : '> 0.41 → open'}`,
      pluck: () => 'fingertip path ∩ string → excite at x, amplitude ∝ |v|',
      slide: () => `stop at u = ${(f.u ?? 0).toFixed(2)}  →  f = f₀/(1−u) = ${(f0 / (1 - (f.u ?? 0))).toFixed(0)} Hz`,
      strum: () => 'one sweep crosses 6 strings · plucks staggered by crossing time',
      bend: () => `pull d → L′ = Σ√(segᵢ² + d²) → T′ = T(1 + EA·ΔL/L)  +${bendCents}¢`,
      tremolo: () => 'alternating crossings ≥ 3 in 600 ms → tremolo',
      mute: () => 'open palm on string → T60: 2.4 s → 0.07 s',
    };
    label(ctx, notes[GESTURES[k]](), b.x + b.w * 0.1, b.y + b.h * 0.12, 0.85);
  },
};

// ---------------------------------------------------------------- 05 instrument
const STUDIO = [82.41, 110, 146.83, 196, 246.94, 329.63];
const FREEHAND: [number, number, number, number][] = [
  [0.06, 0.2, 0.52, 0.1], [0.2, 0.62, 0.74, 0.42], [0.56, 0.84, 0.95, 0.62],
  [0.3, 0.92, 0.6, 0.78], [0.62, 0.16, 0.93, 0.34], [0.05, 0.48, 0.28, 0.88],
];
const instrumentState = { m: 0, v: 0 };

const instrument: Scene = {
  id: 'instrument',
  anchors: ['instrument-box'],
  compute(inp, out) {
    const b = inp.a['instrument-box'];
    if (!b) return;
    const m = clamp(instrumentState.m, -0.1, 1.1);
    out.forEach((s, i) => {
      const sy = b.y + b.h * (0.84 - i * 0.136);
      const fh = FREEHAND[i];
      const x0 = lerp(b.x + b.w * 0.06, b.x + b.w * fh[0], m);
      const y0 = lerp(sy, b.y + b.h * fh[1], m);
      const x1 = lerp(b.x + b.w * 0.94, b.x + b.w * fh[2], m);
      const y1 = lerp(sy, b.y + b.h * fh[3], m);
      setLine(s, x0, y0, x1, y1);
      const L = Math.hypot(x1 - x0, y1 - y0) / ppm(inp.w);
      s.freq = m < 0.5 ? STUDIO[i] : snapToSemitone(fundamental(Math.max(0.05, L), 60, DEFAULT_MU));
      s.alpha = 0.95;
      s.u0 = 0;
      s.u1 = 1;
      s.width = 1.5 - i * 0.08;
    });
  },
  update(inp) {
    const target = site.instrument.mode === 'freehand' ? 1 : 0;
    const st = instrumentState;
    if (inp.reduced) {
      st.m = target;
      return;
    }
    // Damped spring: m'' = k(target − m) − c·m'
    const k = 90, c = 2 * 0.72 * Math.sqrt(k);
    const dt = Math.min(inp.dt, 1 / 30);
    st.v += (k * (target - st.m) - c * st.v) * dt;
    st.m += st.v * dt;
  },
  overlay(ctx, _inp, out) {
    for (const s of out) {
      const j = POINTS - 1;
      const x = s.pts[2 * j], y = s.pts[2 * j + 1];
      label(ctx, `${noteOf(s.freq).name}  ${s.freq.toFixed(0)} Hz`, x + 8, y + 3, 0.75);
      ctx.fillStyle = '#9b9bff';
      ctx.fillRect(s.pts[0] - 2, s.pts[1] - 2, 4, 4);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  },
};

// ---------------------------------------------------------------- 06 sound architecture
// A real bidirectional waveguide (the same algorithm as the audio worklet), slowed down to
// 36 cells per second so the travelling waves are visible.
const WG = 40;
const HIST = 164;
const wg = {
  R: new Float32Array(WG),
  L: new Float32Array(WG),
  hist: new Float32Array(HIST),
  lp: 0,
  acc: 0,
  lastAuto: -10,
  lastManual: -10,
  frame: 0,
  spec: new Float32Array(8),
};
const PICKUP = Math.round(WG * 0.8);

function wgExcite(pos: number) {
  for (let k = 1; k < WG - 1; k++) {
    const x = k / (WG - 1);
    const s = (x < pos ? x / pos : (1 - x) / (1 - pos)) * 0.5;
    wg.R[k] += s;
    wg.L[k] += s;
  }
}

function wgStep() {
  const atBridge = wg.R[WG - 1];
  const atNut = wg.L[0];
  for (let k = WG - 1; k > 0; k--) wg.R[k] = wg.R[k - 1];
  for (let k = 0; k < WG - 1; k++) wg.L[k] = wg.L[k + 1];
  wg.lp += 0.55 * (atBridge - wg.lp);
  wg.L[WG - 1] = -0.992 * wg.lp;
  wg.R[0] = -atNut;
  wg.hist.copyWithin(0, 1);
  wg.hist[HIST - 1] = wg.R[PICKUP] + wg.L[PICKUP];
}

const soundTrack = (b: Box, i: number) => b.y + b.h * [0.14, 0.34, 0.58, 0.86][i];

const sound: Scene = {
  id: 'sound',
  anchors: ['sound-box'],
  compute(inp, out) {
    const b = inp.a['sound-box'];
    if (!b) return;
    const x0 = b.x + b.w * 0.06, x1 = b.x + b.w * 0.94;
    const sample = (arr: Float32Array, u: number) => {
      const x = u * (arr.length - 1), k = Math.floor(x);
      return arr[k] + ((arr[Math.min(arr.length - 1, k + 1)] - arr[k]) * (x - k));
    };
    out.forEach((s, i) => {
      if (i > 3) {
        setLine(s, x0, soundTrack(b, 2), x1, soundTrack(b, 2));
        s.alpha = 0;
      } else {
        const scale = b.h * [0.1, 0.1, 0.14, 0.09][i];
        setLine(s, x0, soundTrack(b, i), x1, soundTrack(b, i), u => {
          if (i === 0) return -sample(wg.R, u) * scale;
          if (i === 1) return -sample(wg.L, u) * scale;
          if (i === 2) return -(sample(wg.R, u) + sample(wg.L, u)) * scale;
          return -sample(wg.hist, u) * scale;
        });
        s.alpha = [0.65, 0.65, 1, 0.85][i];
      }
      s.u0 = 0;
      s.u1 = 1;
      s.freq = 110;
      s.width = i === 2 ? 1.7 : 1.1;
    });
  },
  update(inp, api) {
    if (site.waveguide.excitedAt > wg.lastManual) {
      wg.lastManual = site.waveguide.excitedAt;
      wgExcite(0.25);
    } else if (!inp.reduced && inp.t - Math.max(wg.lastAuto, wg.lastManual) > 7) {
      wg.lastAuto = inp.t;
      wgExcite(0.25);
    }
    if (inp.reduced) return;
    wg.acc += Math.min(inp.dt, 0.05) * 36;
    while (wg.acc >= 1) {
      wg.acc -= 1;
      wgStep();
    }
    // Spectrum of the pickup signal at the harmonics of the loop period P = 2·WG cells.
    if (++wg.frame % 6 === 0) {
      const P = 2 * WG + 1;
      let max = 1e-6;
      for (let k = 1; k <= 8; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < HIST; n++) {
          const ph = (TAU * k * n) / P;
          re += wg.hist[n] * Math.cos(ph);
          im -= wg.hist[n] * Math.sin(ph);
        }
        wg.spec[k - 1] = Math.hypot(re, im);
        max = Math.max(max, wg.spec[k - 1]);
      }
      for (let k = 0; k < 8; k++) wg.spec[k] = Math.min(1, wg.spec[k] / Math.max(max, 6));
      api.bars('spectrum', wg.spec);
    }
  },
  overlay(ctx, inp) {
    const b = inp.a['sound-box'];
    if (!b) return;
    const x0 = b.x + b.w * 0.06, x1 = b.x + b.w * 0.94;
    label(ctx, 'R(x,t) →  right-going', x0, soundTrack(b, 0) - b.h * 0.07, 0.75);
    label(ctx, '← L(x,t)  left-going', x0, soundTrack(b, 1) - b.h * 0.07, 0.75);
    label(ctx, 'y(x,t) = R + L   string displacement', x0, soundTrack(b, 2) - b.h * 0.1, 0.9);
    label(ctx, 'out[n] at pickup   (time →)', x0, soundTrack(b, 3) - b.h * 0.07, 0.75);
    label(ctx, '−1 · nut', x0, soundTrack(b, 2) + b.h * 0.12, 0.55);
    label(ctx, 'bridge · −g·H(z)', x1, soundTrack(b, 2) + b.h * 0.12, 0.55, 'right');
    const px = lerp(x0, x1, PICKUP / (WG - 1));
    ctx.strokeStyle = 'rgba(255,176,122,0.6)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(px, soundTrack(b, 2) - b.h * 0.06);
    ctx.lineTo(px, soundTrack(b, 3) - b.h * 0.05);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const x of [x0, x1]) {
      ctx.fillStyle = '#9b9bff';
      ctx.fillRect(x - 1, soundTrack(b, 0) - 6, 2, soundTrack(b, 2) - soundTrack(b, 0) + 12);
    }
  },
};

// ---------------------------------------------------------------- 07 enter
const PENTA = [130.81, 146.83, 164.81, 196, 220, 261.63];
const ctaState = { last: -10, queue: [] as { at: number; i: number }[] };

function chord(c: Vec, r: number, i: number, rot: number) {
  const a1 = rot + (i * Math.PI) / 3 + Math.PI / 12;
  const a2 = a1 + Math.PI * (0.42 + i * 0.09);
  return [c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r, c.x + Math.cos(a2) * r, c.y + Math.sin(a2) * r] as const;
}

const cta: Scene = {
  id: 'cta',
  anchors: ['cta-ring'],
  compute(inp, out) {
    const b = inp.a['cta-ring'];
    if (!b) return;
    const c = center(b);
    const r = Math.min(b.w, b.h) / 2;
    const rot = inp.anim * 0.035;
    out.forEach((s, i) => {
      const [x0, y0, x1, y1] = chord(c, r, i, rot);
      setLine(s, x0, y0, x1, y1);
      s.alpha = 0.5;
      s.u0 = 0;
      s.u1 = 1;
      s.freq = PENTA[STRANDS - 1 - i];
      s.width = 1.3;
    });
  },
  update(inp, api) {
    if (site.cta.arpeggioAt > ctaState.last) {
      ctaState.last = site.cta.arpeggioAt;
      for (let i = 0; i < STRANDS; i++) {
        ctaState.queue.push({ at: inp.t + i * 0.14, i: STRANDS - 1 - i });
        api.playNote(STRANDS - 1 - i, 0.3, 0.6, i * 0.14);
      }
    }
    ctaState.queue = ctaState.queue.filter(q => {
      if (q.at > inp.t) return true;
      api.excite(q.i, 0.3, 12);
      return false;
    });
  },
  overlay(ctx, inp) {
    const b = inp.a['cta-ring'];
    if (!b) return;
    const c = center(b);
    const r = Math.min(b.w, b.h) / 2;
    ctx.strokeStyle = 'rgba(155,155,255,0.18)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(155,155,255,0.3)';
    for (let d = 0; d < 360; d += 15) {
      const a = (d * Math.PI) / 180;
      const l = d % 90 === 0 ? 10 : 4;
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      ctx.lineTo(c.x + Math.cos(a) * (r + l), c.y + Math.sin(a) * (r + l));
      ctx.stroke();
    }
  },
};

export const SCENES: Scene[] = [hero, concept, physics, gesture, instrument, sound, cta];

/** Transitions that pass through a convergence point instead of interpolating directly. */
export const VIA: Record<string, (b: Record<string, Box>) => Vec | null> = {
  'gesture>instrument': a => (a['instrument-box'] ? center(a['instrument-box']) : null),
};
