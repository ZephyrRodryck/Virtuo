'use client';
import Link from 'next/link';
import { useState } from 'react';
import { setInstrumentMode, site } from '@/lib/site/store';

const MODES = {
  studio: {
    title: 'Studio',
    desc: 'Tuned strings in a fixed layout, like looking down at a fretboard. Each string’s tension is solved so it sounds its note at the given length.',
    features: ['Guitar EADGBE, Bass EADG and pentatonic Harp presets', 'Slide and bend on any string', 'Strum, tremolo and palm mute'],
  },
  freehand: {
    title: 'Freehand',
    desc: 'Draw strings anywhere, at any angle. Length sets the pitch; move an endpoint and the note follows. Snap to the nearest semitone or play between them.',
    features: ['Up to 12 strings, each its own voice', 'One-hand or two-hand string drawing', 'Drag endpoints to retune live'],
  },
} as const;

type Mode = keyof typeof MODES;

export default function Instrument() {
  const [mode, setMode] = useState<Mode>(site.instrument.mode);
  const m = MODES[mode];
  const choose = (next: Mode) => {
    setInstrumentMode(next);
    setMode(next);
  };

  return (
    <section id="instrument" data-scene="instrument" className="relative min-h-[100svh] px-5 sm:px-8 md:px-20 py-28 flex flex-col justify-center">
      <p data-reveal className="font-mono-math text-[11px] tracking-[0.3em] mb-4" style={{ color: 'var(--accent)' }}>05 / THE INSTRUMENT</p>
      <h2 data-reveal="split" className="font-semibold leading-tight" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--text-1)' }} dangerouslySetInnerHTML={{ __html: 'One string. Or twelve.' }} />

      <div className="mt-14 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-12 items-center">
        <div>
          <div className="inline-flex" role="group" aria-label="Instrument mode" style={{ border: '1px solid var(--border)' }}>
            {(Object.keys(MODES) as Mode[]).map(k => (
              <button key={k} onClick={() => choose(k)} aria-pressed={mode === k}
                className="font-mono-math text-[11px] tracking-[0.2em] uppercase px-5 py-3 transition-colors"
                style={{ color: mode === k ? 'var(--accent)' : 'var(--text-3)', background: mode === k ? 'var(--surface)' : 'transparent' }}>
                {MODES[k].title}
              </button>
            ))}
          </div>
          <p className="mt-8 leading-relaxed max-w-md" style={{ color: 'var(--text-2)' }}>{m.desc}</p>
          <ul className="mt-6 space-y-2">
            {m.features.map(f => (
              <li key={f} className="text-sm flex gap-3" style={{ color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--accent)' }}>—</span>{f}
              </li>
            ))}
          </ul>
          <p className="mt-6 font-mono-math text-[11px]" style={{ color: 'var(--text-3)' }}>
            The strings on the right are playable: sweep across them.
          </p>
          <Link href="/instrument" className="btn-primary inline-block mt-8">Open the instrument →</Link>
        </div>
        <div data-anchor="instrument-box" className="relative w-full aspect-[4/3] max-h-[70vh]" />
      </div>
    </section>
  );
}
