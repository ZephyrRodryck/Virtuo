'use client';
import { useState } from 'react';
import { audioEngine } from '@/lib/audio/AudioEngine';
import { fundamental, modeAmplitudes, noteOf } from '@/lib/physics/string';
import { PHYSICS_LIMITS, pluckPhysics, setPhysics, site } from '@/lib/site/store';

type Key = keyof typeof PHYSICS_LIMITS;

const CONTROLS: { key: Key; label: string; fmt: (v: number) => string; step: number; hint: string }[] = [
  { key: 'L', label: 'Length L', fmt: v => `${v.toFixed(2)} m`, step: 0.01, hint: 'longer → lower' },
  { key: 'T', label: 'Tension T', fmt: v => `${v.toFixed(0)} N`, step: 1, hint: 'tighter → higher' },
  { key: 'mu', label: 'Density μ', fmt: v => `${(v * 1000).toFixed(1)} g/m`, step: 0.0005, hint: 'heavier → lower' },
  { key: 'pluckPos', label: 'Pluck point', fmt: v => `${v.toFixed(2)} L`, step: 0.01, hint: 'shapes the harmonics' },
  { key: 't60', label: 'Damping T₆₀', fmt: v => `${v.toFixed(1)} s`, step: 0.1, hint: 'time to decay 60 dB' },
];

export default function Physics() {
  const [p, setP] = useState(() => ({ ...site.physics }));
  const f0 = fundamental(p.L, p.T, p.mu);
  const A = modeAmplitudes(p.pluckPos, 8).map(Math.abs);
  const maxA = Math.max(...A);

  const set = (key: Key, v: number) => {
    setPhysics(key, v);
    setP(prev => ({ ...prev, [key]: v }));
  };

  const pluck = async () => {
    pluckPhysics();
    if (!(await audioEngine.start())) return;
    audioEngine.configure('physics', { freq: f0, t60: p.t60, brightness: 0.85, pan: -0.1, muted: false, immediate: true });
    audioEngine.pluck('physics', p.pluckPos, 0.8);
  };

  return (
    <section id="physics" data-scene="physics" className="relative px-5 sm:px-8 md:px-20 py-28">
      <p data-reveal className="font-mono-math text-[11px] tracking-[0.3em] mb-4" style={{ color: 'var(--accent)' }}>03 / THE PHYSICS OF SOUND</p>
      <h2 data-reveal="split" className="font-semibold leading-tight max-w-3xl" style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--text-1)' }} dangerouslySetInnerHTML={{ __html: 'A pluck is a sum of standing waves.' }} />
      <p data-reveal className="mt-5 max-w-xl" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
        Displace a string and it vibrates in modes yₙ = Aₙ sin(nπx/L) cos(2πnf₀t). Where you pluck decides how
        strong each mode is — pluck the middle and every even harmonic vanishes. Scroll to separate them.
      </p>

      <div className="mt-14 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-12 items-start">
        <div>
          <div data-anchor="physics-box" className="relative w-full h-[min(62vh,520px)]" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
          <p className="mt-3 font-mono-math text-[11px]" style={{ color: 'var(--text-3)' }}>
            shown in slow motion · real motion is {f0.toFixed(0)} cycles per second
          </p>
        </div>

        <div className="space-y-6">
          <div className="p-5" style={{ border: '1px solid var(--border)', background: 'rgba(4,4,10,0.6)' }}>
            <p className="font-mono-math text-[11px]" style={{ color: 'var(--text-3)' }}>MERSENNE’S LAW</p>
            <p className="font-mono-math mt-2" style={{ color: 'var(--accent)' }}>f₀ = √(T/μ) / 2L</p>
            <p className="font-mono-math text-xs mt-2" style={{ color: 'var(--text-2)' }}>
              = √({p.T.toFixed(0)} / {p.mu.toFixed(4)}) / {(2 * p.L).toFixed(2)} ={' '}
              <strong style={{ color: 'var(--text-1)' }}>{f0.toFixed(1)} Hz · {noteOf(f0).name}</strong>
            </p>
          </div>

          {CONTROLS.map(c => (
            <label key={c.key} className="block">
              <span className="flex justify-between font-mono-math text-[11px] mb-2">
                <span style={{ color: 'var(--text-2)' }}>{c.label.toUpperCase()} <span style={{ color: 'var(--text-3)' }}>· {c.hint}</span></span>
                <span style={{ color: 'var(--accent)' }}>{c.fmt(p[c.key])}</span>
              </span>
              <input type="range" className="w-full" min={PHYSICS_LIMITS[c.key][0]} max={PHYSICS_LIMITS[c.key][1]} step={c.step}
                value={p[c.key]} onChange={e => set(c.key, Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
            </label>
          ))}

          <div>
            <p className="font-mono-math text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>MODE AMPLITUDES |Aₙ|</p>
            <div className="flex items-end gap-2 h-16" aria-label="Mode amplitudes">
              {A.map((a, i) => (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full" style={{ height: `${Math.max(2, (a / maxA) * 48)}px`, background: 'var(--accent)', opacity: 0.35 + 0.65 * (a / maxA), transition: 'height 200ms' }} />
                  <span className="font-mono-math text-[10px]" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <button className="btn-primary w-full" onClick={pluck}>Pluck &amp; listen · {noteOf(f0).name}</button>
        </div>
      </div>
    </section>
  );
}
