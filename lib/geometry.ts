export interface Vec {
  x: number;
  y: number;
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Intersection of segments p1→p2 and q1→q2.
 * Returns t along p and s along q (both in [0, 1]) and the side q started on, or null.
 */
export function segmentIntersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec): { t: number; s: number; side: number } | null {
  const rx = p2.x - p1.x, ry = p2.y - p1.y;
  const sx = q2.x - q1.x, sy = q2.y - q1.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
  const t = (qpx * sy - qpy * sx) / den;
  const s = (qpx * ry - qpy * rx) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return { t, s, side: Math.sign(rx * (q1.y - p1.y) - ry * (q1.x - p1.x)) };
}

/** Projection of p onto segment a→b: parameter u ∈ [0,1], signed perpendicular offset, distance. */
export function project(p: Vec, a: Vec, b: Vec): { u: number; offset: number; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const u = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  const len = Math.sqrt(len2);
  const offset = ((p.y - a.y) * dx - (p.x - a.x) * dy) / len;
  return { u, offset, dist: Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u)) };
}

/** Centripetal-free uniform Catmull–Rom point between p1 and p2. */
export function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number, out: Vec): Vec {
  const t2 = t * t, t3 = t2 * t;
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return out;
}

/** Point at parameter u ∈ [0,1] along a Catmull–Rom spline through `pts` (endpoints duplicated). */
export function splineAt(pts: Vec[], u: number, out: Vec): Vec {
  const segs = pts.length - 1;
  const x = clamp(u, 0, 1) * segs;
  const i = Math.min(segs - 1, Math.floor(x));
  return catmullRom(pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(segs, i + 2)], x - i, out);
}
