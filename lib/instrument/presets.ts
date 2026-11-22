export type PresetId = 'guitar' | 'bass' | 'harp';

export interface Preset {
  label: string;
  /** Open-string notes, lowest first, with linear densities (kg/m). */
  strings: { note: string; freq: number; mu: number }[];
  t60: number;
  brightness: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  guitar: {
    label: 'Guitar · EADGBE',
    t60: 3.2,
    brightness: 0.72,
    strings: [
      { note: 'E2', freq: 82.41, mu: 0.0066 },
      { note: 'A2', freq: 110.0, mu: 0.0042 },
      { note: 'D3', freq: 146.83, mu: 0.0025 },
      { note: 'G3', freq: 196.0, mu: 0.0013 },
      { note: 'B3', freq: 246.94, mu: 0.0007 },
      { note: 'E4', freq: 329.63, mu: 0.0004 },
    ],
  },
  bass: {
    label: 'Bass · EADG',
    t60: 4.5,
    brightness: 0.45,
    strings: [
      { note: 'E1', freq: 41.2, mu: 0.024 },
      { note: 'A1', freq: 55.0, mu: 0.016 },
      { note: 'D2', freq: 73.42, mu: 0.01 },
      { note: 'G2', freq: 98.0, mu: 0.006 },
    ],
  },
  harp: {
    label: 'Harp · C pentatonic',
    t60: 5,
    brightness: 0.85,
    strings: [
      { note: 'C3', freq: 130.81, mu: 0.003 },
      { note: 'D3', freq: 146.83, mu: 0.0028 },
      { note: 'E3', freq: 164.81, mu: 0.0026 },
      { note: 'G3', freq: 196.0, mu: 0.0022 },
      { note: 'A3', freq: 220.0, mu: 0.002 },
      { note: 'C4', freq: 261.63, mu: 0.0016 },
      { note: 'D4', freq: 293.66, mu: 0.0014 },
      { note: 'E4', freq: 329.63, mu: 0.0012 },
    ],
  },
};

export const STRING_COLORS = ['#9b9bff', '#5ab4ff', '#b98cff', '#5fd6c0', '#ffa86b', '#ff7fb6', '#d8d870', '#8fe388'];
