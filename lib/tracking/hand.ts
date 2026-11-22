import type { Vec } from '../geometry';

export type HandId = 'Left' | 'Right' | 'Pointer';

/** One hand (or the mouse/touch pointer) in canvas pixels, ready for gesture logic. */
export interface HandPose {
  id: HandId;
  landmarks: Vec[] | null; // 21 points (camera hands only)
  tip: Vec; // index fingertip — plucks
  thumb: Vec;
  pinchPoint: Vec;
  palm: Vec;
  scale: number; // wrist → middle-finger knuckle, px
  pinchRatio: number; // thumb–index distance / scale
  pinching: boolean;
  open: boolean; // all four fingers extended → palm mute
  time: number;
}

export interface PinchCalibration {
  pinched: number;
  open: number;
}

export const DEFAULT_CALIBRATION: PinchCalibration = { pinched: 0.2, open: 0.95 };

/** Hysteresis thresholds between the user's measured pinched and open thumb–index ratios. */
export function pinchThresholds(c: PinchCalibration) {
  const span = Math.max(0.2, c.open - c.pinched);
  return { enter: c.pinched + 0.3 * span, exit: c.pinched + 0.5 * span };
}

const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];
const PALM = [0, 5, 9, 13, 17];

/** Index-finger chain and connections between the 21 MediaPipe hand landmarks. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Derives pinch/open/palm features from 21 landmarks in canvas pixels. */
export function poseFromLandmarks(
  id: HandId,
  lm: Vec[],
  wasPinching: boolean,
  cal: PinchCalibration,
  time: number,
): HandPose {
  const d = (a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const scale = Math.max(1, d(0, 9));
  const pinchRatio = d(4, 8) / scale;
  const { enter, exit } = pinchThresholds(cal);
  const pinching = wasPinching ? pinchRatio < exit : pinchRatio < enter;
  let extended = 0;
  for (let i = 0; i < 4; i++) if (d(0, TIPS[i]) > d(0, PIPS[i]) * 1.12) extended++;
  const palm = { x: 0, y: 0 };
  for (const i of PALM) {
    palm.x += lm[i].x / PALM.length;
    palm.y += lm[i].y / PALM.length;
  }
  return {
    id,
    landmarks: lm,
    tip: lm[8],
    thumb: lm[4],
    pinchPoint: { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 },
    palm,
    scale,
    pinchRatio,
    pinching,
    open: extended === 4 && !pinching,
    time,
  };
}

/** Pointer (mouse / touch) mapped onto the same gesture model: button = pinch, Shift = open palm. */
export function poseFromPointer(p: Vec, down: boolean, open: boolean, time: number): HandPose {
  return {
    id: 'Pointer',
    landmarks: null,
    tip: p,
    thumb: p,
    pinchPoint: p,
    palm: p,
    scale: 70,
    pinchRatio: down ? 0 : 1,
    pinching: down,
    open,
    time,
  };
}

/** Maps a normalised video coordinate (already mirrored) to canvas px for an object-fit: cover video. */
export function coverMap(nx: number, ny: number, vw: number, vh: number, W: number, H: number): Vec {
  const s = Math.max(W / vw, H / vh);
  return { x: (W - vw * s) / 2 + nx * vw * s, y: (H - vh * s) / 2 + ny * vh * s };
}
