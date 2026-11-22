import { audioEngine, SHAPE_POINTS } from '../audio/AudioEngine';
import type { Vec } from '../geometry';
import { noteOf } from '../physics/string';
import { HAND_CONNECTIONS, pinchThresholds, type PinchCalibration } from '../tracking/hand';
import type { InstrumentController, VString } from './InstrumentController';

const MONO = '11px "JetBrains Mono", ui-monospace, monospace';

/** Displacement samples along the vibrating segment: worklet state when audio runs, FD fallback otherwise. */
function shapeOf(s: VString): { inst: ArrayLike<number>; env: ArrayLike<number> | null; n: number } {
  const sh = audioEngine.running ? audioEngine.shape(s.id) : undefined;
  if (sh) return { inst: sh.inst, env: sh.env, n: SHAPE_POINTS };
  return { inst: s.fd.y, env: null, n: s.fd.n };
}

function drawString(ctx: CanvasRenderingContext2D, c: InstrumentController, s: VString) {
  const start = c.contact(s);
  const dx = s.b.x - start.x, dy = s.b.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const scale = Math.min(46, len * 0.09);
  const { inst, env, n } = shapeOf(s);

  // Silent part between nut and finger.
  if (s.stop) {
    ctx.strokeStyle = 'rgba(160,160,210,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(start.x, start.y);
    ctx.stroke();
  }

  // Peak envelope: how a fast-vibrating string looks to the eye.
  if (env) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), e = env[i] * scale;
      const x = start.x + dx * u + nx * e, y = start.y + dy * u + ny * e;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const u = i / (n - 1), e = -env[i] * scale;
      ctx.lineTo(start.x + dx * u + nx * e, start.y + dy * u + ny * e);
    }
    ctx.closePath();
    ctx.fillStyle = s.color + '22';
    ctx.fill();
  }

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), y = inst[i] * scale;
    const px = start.x + dx * u + nx * y, py = start.y + dy * u + ny * y;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = s.muted ? 'rgba(160,160,190,0.5)' : s.color;
  ctx.lineWidth = s.muted ? 1 : 1.6;
  ctx.stroke();

  for (const p of [s.a, s.b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.fixed ? 2.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
  }
  if (s.stop) {
    ctx.beginPath();
    ctx.arc(start.x, start.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const note = noteOf(s.freq);
  ctx.font = MONO;
  ctx.fillStyle = s.muted ? 'rgba(160,160,190,0.6)' : 'rgba(226,226,240,0.85)';
  const lx = s.b.x + (s.b.x >= s.a.x ? 10 : -10);
  ctx.textAlign = s.b.x >= s.a.x ? 'left' : 'right';
  ctx.fillText(`${note.name}${s.muted ? ' · muted' : ''}`, lx, s.b.y - 4);
  ctx.fillStyle = 'rgba(140,140,180,0.7)';
  ctx.fillText(`${s.freq.toFixed(1)} Hz`, lx, s.b.y + 10);
  ctx.textAlign = 'left';
}

function crosshair(ctx: CanvasRenderingContext2D, p: Vec, r: number) {
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y);
  ctx.lineTo(p.x + r, p.y);
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x, p.y + r);
  ctx.stroke();
}

export function renderInstrument(ctx: CanvasRenderingContext2D, c: InstrumentController, cal: PinchCalibration) {
  ctx.clearRect(0, 0, c.w, c.h);

  for (const s of c.strings) drawString(ctx, c, s);

  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(200,200,255,0.8)';
  ctx.lineWidth = 1.2;
  for (const d of c.drafts) {
    ctx.beginPath();
    ctx.moveTo(d.a.x, d.a.y);
    ctx.lineTo(d.b.x, d.b.y);
    ctx.stroke();
    const L = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) / c.ppm;
    ctx.font = MONO;
    ctx.fillStyle = 'rgba(200,200,255,0.9)';
    ctx.fillText(`L = ${L.toFixed(2)} m`, (d.a.x + d.b.x) / 2 + 8, (d.a.y + d.b.y) / 2 - 8);
  }
  ctx.setLineDash([]);

  const { enter } = pinchThresholds(cal);
  for (const st of c.hands.values()) {
    const pose = st.pose;
    if (!pose) continue;

    // Fingertip motion trail.
    if (st.trail.length > 1) {
      for (let i = 1; i < st.trail.length; i++) {
        ctx.strokeStyle = `rgba(150,150,255,${(i / st.trail.length) * 0.6})`;
        ctx.lineWidth = 1 + (i / st.trail.length) * 1.5;
        ctx.beginPath();
        ctx.moveTo(st.trail[i - 1].x, st.trail[i - 1].y);
        ctx.lineTo(st.trail[i].x, st.trail[i].y);
        ctx.stroke();
      }
    }

    if (pose.landmarks) {
      const lm = pose.landmarks;
      ctx.strokeStyle = 'rgba(226,226,240,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, j] of HAND_CONNECTIONS) {
        ctx.moveTo(lm[i].x, lm[i].y);
        ctx.lineTo(lm[j].x, lm[j].y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(226,226,240,0.7)';
      for (const p of lm) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);

      // Pinch meter between thumb and index tips.
      ctx.strokeStyle = pose.pinching ? '#9b9bff' : 'rgba(155,155,255,0.45)';
      ctx.lineWidth = pose.pinching ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(pose.thumb.x, pose.thumb.y);
      ctx.lineTo(pose.tip.x, pose.tip.y);
      ctx.stroke();
      ctx.font = MONO;
      ctx.fillStyle = pose.pinching ? '#c8c8ff' : 'rgba(170,170,210,0.8)';
      ctx.fillText(
        `${pose.id[0]} · d/s ${pose.pinchRatio.toFixed(2)}${pose.pinching ? ' pinch' : ` > ${enter.toFixed(2)}`}`,
        pose.palm.x + pose.scale * 0.6,
        pose.palm.y + pose.scale * 0.6,
      );
    }

    ctx.strokeStyle = pose.pinching ? '#ffffff' : 'rgba(200,200,255,0.8)';
    ctx.lineWidth = 1;
    crosshair(ctx, pose.pinching ? pose.pinchPoint : pose.tip, pose.pinching ? 9 : 6);
    ctx.beginPath();
    ctx.arc(pose.tip.x, pose.tip.y, pose.pinching ? 12 : 8, 0, Math.PI * 2);
    ctx.stroke();

    if (pose.open) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = st.muting.size ? 'rgba(255,168,107,0.9)' : 'rgba(255,168,107,0.4)';
      ctx.beginPath();
      ctx.arc(pose.palm.x, pose.palm.y, pose.scale * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
