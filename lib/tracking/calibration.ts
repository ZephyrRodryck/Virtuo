import { DEFAULT_CALIBRATION, type PinchCalibration } from './hand';

const HOLD_FRAMES = 24; // ≈0.8 s at 30 fps
const KEY = 'virtuo.calibration';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const std = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

/**
 * Two-step pinch calibration: hold an open hand, then hold a pinch. Each step completes
 * once the thumb–index/hand-size ratio has been held steadily for HOLD_FRAMES frames.
 */
export class Calibrator {
  step: 'open' | 'pinch' | 'done' = 'open';
  progress = 0;
  result: PinchCalibration = { ...DEFAULT_CALIBRATION };
  private samples: number[] = [];

  /** Feed one frame (ratio of the most confident hand, or null if none). Returns true when the step changed. */
  feed(ratio: number | null, fingersExtended: boolean): boolean {
    if (this.step === 'done') return false;
    const ok =
      ratio !== null &&
      (this.step === 'open' ? ratio > 0.55 && fingersExtended : ratio < 0.5);
    if (!ok) {
      this.samples = [];
      this.progress = 0;
      return false;
    }
    this.samples.push(ratio!);
    if (this.samples.length > HOLD_FRAMES) this.samples.shift();
    const steady = std(this.samples) < (this.step === 'open' ? 0.08 : 0.05);
    this.progress = steady ? this.samples.length / HOLD_FRAMES : this.progress * 0.9;
    if (this.samples.length < HOLD_FRAMES || !steady) return false;

    if (this.step === 'open') {
      this.result.open = median(this.samples);
      this.step = 'pinch';
    } else {
      this.result.pinched = median(this.samples);
      if (this.result.open - this.result.pinched < 0.25) this.result = { ...DEFAULT_CALIBRATION };
      this.step = 'done';
      saveCalibration(this.result);
    }
    this.samples = [];
    this.progress = 0;
    return true;
  }
}

export function loadCalibration(): PinchCalibration | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v.open === 'number' && typeof v.pinched === 'number' ? v : null;
  } catch {
    return null;
  }
}

function saveCalibration(c: PinchCalibration) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable (private mode) — calibration still applies for this session */
  }
}
