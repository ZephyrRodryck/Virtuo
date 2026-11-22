'use client';
import { useEffect, useRef } from 'react';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { clamp, lerp, segmentIntersect, smoothstep } from '@/lib/geometry';
import { FDString } from '@/lib/physics/string';
import { POINTS, SCENES, STRANDS, VIA, type Box, type SceneInput, type StageApi, type Strand } from '@/lib/site/scenes';
import { site } from '@/lib/site/store';

const COLORS = ['155,155,255', '127,178,255', '184,146,255', '111,211,196', '255,176,122', '255,143,191'];

const makeStrands = (): Strand[] =>
  Array.from({ length: STRANDS }, () => ({ pts: new Float32Array(POINTS * 2), alpha: 0, u0: 0, u1: 1, freq: 110, width: 1 }));

interface Particle { x: number; y: number; vx: number; vy: number; life: number }

/**
 * One fixed canvas behind the landing page. Every section declares a scene
 * (data-scene) whose strands are blended with its neighbour's as the section
 * boundary crosses the middle of the viewport — the same six strands travel
 * through the whole page and can be plucked anywhere.
 */
export default function Stage() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const bufA = makeStrands();
    const bufB = makeStrands();
    const out = makeStrands();
    const drawn = Array.from({ length: STRANDS }, () => new Float32Array(POINTS * 2));
    const fd = Array.from({ length: STRANDS }, () => new FDString(POINTS));
    const cooldown = new Float64Array(STRANDS);
    const particles: Particle[] = [];
    const readouts = new Map<string, string>();
    const actives = new Map<string, boolean>();
    let sections: { el: HTMLElement; scene: (typeof SCENES)[number]; anchors: Map<string, HTMLElement> }[] = [];
    let w = 0, h = 0, dpr = 1;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    let last = t0;

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    site.reducedMotion = reducedQuery.matches;
    const onReduced = () => (site.reducedMotion = reducedQuery.matches);
    reducedQuery.addEventListener('change', onReduced);

    const collect = () => {
      sections = [];
      document.querySelectorAll<HTMLElement>('[data-scene]').forEach(el => {
        const scene = SCENES.find(s => s.id === el.dataset.scene);
        if (!scene) return;
        const anchors = new Map<string, HTMLElement>();
        el.querySelectorAll<HTMLElement>('[data-anchor]').forEach(a => anchors.set(a.dataset.anchor!, a));
        sections.push({ el, scene, anchors });
      });
    };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(w < 768 ? 1.5 : 2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      collect();
    };
    resize();
    window.addEventListener('resize', resize);

    const api: StageApi = {
      excite: (i, u, amp) => fd[i]?.excite(u, amp),
      damp: (i, f) => fd[i]?.damp(f),
      setActive(name, on) {
        if (actives.get(name) === on) return;
        actives.set(name, on);
        document.querySelectorAll<HTMLElement>(`[data-anchor="${name}"]`).forEach(el => (el.dataset.on = on ? '1' : '0'));
      },
      readout(name, text) {
        if (readouts.get(name) === text) return;
        readouts.set(name, text);
        document.querySelectorAll(`[data-readout="${name}"]`).forEach(el => (el.textContent = text));
      },
      bars(name, values) {
        const els = document.querySelectorAll<HTMLElement>(`[data-bars="${name}"] > *`);
        els.forEach((el, k) => (el.style.transform = `scaleY(${Math.max(0.02, values[k] ?? 0)})`));
      },
      playNote(i, u, amp, delay = 0) {
        if (!site.sound || !audioEngine.running) return;
        const s = out[i];
        const mid = s.pts[POINTS];
        audioEngine.configure(`stage-${i}`, { freq: s.freq, t60: 2.6, brightness: 0.68, pan: clamp((mid / w) * 2 - 1, -1, 1) * 0.6 });
        audioEngine.pluck(`stage-${i}`, clamp(u, 0.05, 0.95), amp, delay);
      },
    };

    const rectOf = (el: HTMLElement): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };

    const inputFor = (sec: (typeof sections)[number], rect: Box, t: number, age: number, dt: number): SceneInput => {
      const a: Record<string, Box> = {};
      sec.anchors.forEach((el, name) => (a[name] = rectOf(el)));
      return {
        t,
        age,
        anim: site.reducedMotion ? 0 : t,
        dt,
        w,
        h,
        rect,
        a,
        progress: clamp((h - rect.y) / (rect.h + h), 0, 1),
        reduced: site.reducedMotion,
      };
    };

    // ---------- pluck detection (pointer anywhere on the page) ----------
    let lp: { x: number; y: number; t: number } | null = null;
    const p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 }, q1 = { x: 0, y: 0 }, q2 = { x: 0, y: 0 };
    const move = (x: number, y: number, time: number) => {
      const prev = lp;
      lp = { x, y, t: time };
      if (!prev) return;
      const dt = Math.max(4, Math.min(120, time - prev.t)) / 1000;
      const speed = Math.hypot(x - prev.x, y - prev.y) / dt;
      if (speed < 60) return;
      p1.x = prev.x; p1.y = prev.y; p2.x = x; p2.y = y;
      for (let i = 0; i < STRANDS; i++) {
        const s = out[i];
        if (s.alpha < 0.3 || cooldown[i] > time) continue;
        const d = drawn[i];
        const j0 = Math.floor(s.u0 * (POINTS - 1)), j1 = Math.ceil(s.u1 * (POINTS - 1));
        for (let j = j0; j < j1; j++) {
          q1.x = d[2 * j]; q1.y = d[2 * j + 1]; q2.x = d[2 * j + 2]; q2.y = d[2 * j + 3];
          const hit = segmentIntersect(p1, p2, q1, q2);
          if (!hit) continue;
          const u = (j + hit.s) / (POINTS - 1);
          const amp = clamp(speed * 0.012, 4, 20);
          fd[i].excite(u, amp * (hit.side || 1));
          api.playNote(i, u, clamp(speed / 2500, 0.2, 1));
          cooldown[i] = time + 90;
          const hx = q1.x + (q2.x - q1.x) * hit.s, hy = q1.y + (q2.y - q1.y) * hit.s;
          const nx = -(q2.y - q1.y), ny = q2.x - q1.x, nl = Math.hypot(nx, ny) || 1;
          for (let k = 0; k < 7 && particles.length < 120; k++) {
            const sgn = k % 2 ? 1 : -1, sp = 40 + Math.random() * 120;
            particles.push({ x: hx, y: hy, vx: (nx / nl) * sp * sgn + (Math.random() - 0.5) * 60, vy: (ny / nl) * sp * sgn + (Math.random() - 0.5) * 60, life: 1 });
          }
          break;
        }
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') move(e.clientX, e.clientY, e.timeStamp);
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY, e.timeStamp);
    };
    const onTouchEnd = () => (lp = null);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchstart', onTouchEnd, { passive: true });

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else cancelAnimationFrame(raf);
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---------- drawing ----------
    const drawGrid = () => {
      const step = 48;
      const off = -((window.scrollY * 0.25) % step);
      ctx.lineWidth = 1;
      for (let x = (w % step) / 2, k = 0; x < w; x += step, k++) {
        ctx.strokeStyle = k % 4 === 0 ? 'rgba(120,120,190,0.07)' : 'rgba(120,120,190,0.035)';
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      const k0 = Math.floor((window.scrollY * 0.25) / step);
      for (let y = off, k = k0; y < h; y += step, k++) {
        ctx.strokeStyle = k % 4 === 0 ? 'rgba(120,120,190,0.07)' : 'rgba(120,120,190,0.035)';
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
    };

    const drawStrand = (i: number) => {
      const s = out[i];
      const d = drawn[i];
      const pts = s.pts;
      const y = fd[i].y;
      for (let j = 0; j < POINTS; j++) {
        const a = Math.max(0, j - 1), b = Math.min(POINTS - 1, j + 1);
        const tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1];
        const tl = Math.hypot(tx, ty) || 1;
        d[2 * j] = pts[2 * j] - (ty / tl) * y[j];
        d[2 * j + 1] = pts[2 * j + 1] + (tx / tl) * y[j];
      }
      if (s.alpha < 0.01 || s.u1 - s.u0 < 0.002) return;
      const j0 = Math.floor(s.u0 * (POINTS - 1)), j1 = Math.ceil(s.u1 * (POINTS - 1));
      ctx.beginPath();
      ctx.moveTo(d[2 * j0], d[2 * j0 + 1]);
      for (let j = j0 + 1; j <= j1; j++) ctx.lineTo(d[2 * j], d[2 * j + 1]);
      const c = COLORS[i];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Soft halo + crisp core instead of shadowBlur (far cheaper to rasterise).
      ctx.strokeStyle = `rgba(${c},${s.alpha * 0.12})`;
      ctx.lineWidth = s.width + 5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${c},${s.alpha})`;
      ctx.lineWidth = s.width;
      ctx.stroke();
    };

    // ---------- frame ----------
    const frame = (now: number) => {
      // Schedule first so an exception in one scene cannot stop the loop.
      if (visible) raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const age = (now - t0) / 1000;

      // Active scene pair: the section under the viewport centre, blended with its
      // neighbour while a boundary is within ±30% of the viewport height of the centre.
      const c = h / 2, z = h * 0.3;
      const rects = sections.map(s => rectOf(s.el));
      let k = rects.findIndex(r => r.y <= c && r.y + r.h > c);
      if (k < 0) k = rects.length && rects[0].y > c ? 0 : rects.length - 1;
      let ka = k, kb = k, beta = 0;
      if (k >= 0 && rects.length) {
        const r = rects[k];
        if (k > 0 && c - r.y < z) {
          ka = k - 1; kb = k; beta = smoothstep(-z, z, c - r.y);
        } else if (k < rects.length - 1 && r.y + r.h - c < z) {
          ka = k; kb = k + 1; beta = smoothstep(-z, z, c - (r.y + r.h));
        }
      }

      if (k >= 0 && sections.length) {
        const A = sections[ka], B = sections[kb];
        const inA = inputFor(A, rects[ka], t, age, dt);
        A.scene.update?.(inA, api);
        A.scene.compute(inA, bufA);
        let inB = inA;
        if (kb !== ka) {
          inB = inputFor(B, rects[kb], t, age, dt);
          B.scene.update?.(inB, api);
          B.scene.compute(inB, bufB);
        }
        const via = kb !== ka ? VIA[`${A.scene.id}>${B.scene.id}`]?.(inB.a) : null;
        const pull = via ? 4 * beta * (1 - beta) : 0;
        for (let i = 0; i < STRANDS; i++) {
          const a = bufA[i], b = kb !== ka ? bufB[i] : bufA[i], o = out[i];
          for (let j = 0; j < POINTS * 2; j++) {
            let v = lerp(a.pts[j], b.pts[j], beta);
            if (via) v = lerp(v, j % 2 ? via.y : via.x, pull * 0.85);
            o.pts[j] = v;
          }
          o.alpha = lerp(a.alpha, b.alpha, beta);
          o.u0 = lerp(a.u0, b.u0, beta);
          o.u1 = lerp(a.u1, b.u1, beta);
          o.freq = beta < 0.5 ? a.freq : b.freq;
          o.width = lerp(a.width, b.width, beta);
        }

        for (let i = 0; i < STRANDS; i++) {
          // Visual wave speed rises with pitch (log scale) so higher strings visibly move faster.
          fd[i].step(dt, 1.4 + 0.8 * Math.log2(Math.max(30, out[i].freq) / 55), 1.3);
        }

        ctx.clearRect(0, 0, w, h);
        drawGrid();
        for (let i = STRANDS - 1; i >= 0; i--) drawStrand(i);
        ctx.globalAlpha = 1 - beta;
        if (1 - beta > 0.02) A.scene.overlay?.(ctx, inA, out);
        if (kb !== ka && beta > 0.02) {
          ctx.globalAlpha = beta;
          B.scene.overlay?.(ctx, inB, out);
        }
        ctx.globalAlpha = 1;

        for (let p = particles.length - 1; p >= 0; p--) {
          const q = particles[p];
          q.vx *= 0.92; q.vy *= 0.92;
          q.x += q.vx * dt; q.y += q.vy * dt;
          q.life -= dt * 1.4;
          if (q.life <= 0) { particles.splice(p, 1); continue; }
          ctx.fillStyle = `rgba(190,190,255,${q.life * 0.8})`;
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
        }
        api.readout('scene', `${sections[beta < 0.5 ? ka : kb].scene.id}  ·  β = ${beta.toFixed(2)}  ·  t = ${age.toFixed(1)} s`);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('touchmove', onTouch);
      window.removeEventListener('touchstart', onTouchEnd);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedQuery.removeEventListener('change', onReduced);
      audioEngine.removeWhere('stage-');
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />;
}
