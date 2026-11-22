// Mutable state shared between landing-page sections (DOM / React) and the canvas stage.
// The stage reads it every frame, so writes here never trigger React renders.

export const site = {
  sound: false,
  reducedMotion: false,
  physics: { L: 0.65, T: 72, mu: 0.0055, pluckPos: 0.22, t60: 2.4, pluckedAt: -10 },
  gesture: { progress: 0 },
  instrument: { mode: 'studio' as 'studio' | 'freehand' },
  waveguide: { excitedAt: -10 },
  cta: { arpeggioAt: -10 },
};

export const PHYSICS_LIMITS = {
  L: [0.3, 1.2],
  T: [20, 200],
  mu: [0.0005, 0.02],
  pluckPos: [0.05, 0.5],
  t60: [0.4, 6],
} as const;

/** Seconds on the clock the stage uses (performance.now). */
export const stageNow = () => performance.now() / 1000;

export function setPhysics(key: keyof typeof PHYSICS_LIMITS, value: number) {
  site.physics[key] = value;
}

export function pluckPhysics() {
  site.physics.pluckedAt = stageNow();
}

export function setInstrumentMode(mode: typeof site.instrument.mode) {
  site.instrument.mode = mode;
}
